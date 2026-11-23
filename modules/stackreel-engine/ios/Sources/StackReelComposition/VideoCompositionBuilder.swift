// Older SDKs import loadTracks as nonisolated without annotating its AVAssetTrack results.
@preconcurrency import AVFoundation
import StackReelPlan

/// An AVFoundation composition and the timing needed to render the plan.
public struct VideoComposition {
  public struct Clip: Sendable {
    public let trackID: CMPersistentTrackID
    /// Rotation and translation from the source track, applied before the plan's media transform.
    public let preferredTransform: CGAffineTransform
    public let playableTimeRange: CMTimeRange
    /// The timeline interval that should reuse the last playable frame.
    public let holdTimeRange: CMTimeRange?
  }

  public let composition: AVMutableComposition
  /// Includes any time after the last video sample, such as a final overlay or held frame.
  public let timelineDuration: CMTime
  public let clipsByLayerID: [String: Clip]
  /// Apply this mix to the player or reader using the render asset's audio tracks.
  public let audioMix: AVAudioMix?
  let renderPlan: RenderPlan
  let imageTexturesByLayerID: [String: ImageTexture]

  /// Builds the instructions for a custom compositor using the same plan as the source tracks.
  public func makeVideoInstructions() throws -> [StackReelVideoInstruction] {
    try StackReelVideoInstruction.schedule(
      renderPlan, clipsByLayerID: clipsByLayerID, imageTexturesByLayerID: imageTexturesByLayerID)
  }
}

public enum VideoCompositionBuilder {
  public enum BuildError: Error, Equatable {
    case invalidPlanDuration
    case invalidLayerTiming(layerID: String)
    case duplicateLayer(layerID: String)
    case invalidSourceTiming(layerID: String)
    case nonFileURL(assetURI: String)
    case missingVideoTrack(assetURI: String)
    case missingAudioTrack(assetURI: String)
    case unableToDecodeImage(assetURI: String)
    case unsupportedMultiImageAsset(assetURI: String)
    case sourceRangeOutsideTrack(layerID: String)
    case tooManyOverlappingClips(trackID: String)
    case unableToAddVideoTrack
    case invalidAudioEntry(id: String)
    case unableToAddAudioTrack
    case unableToCreateGainTap(OSStatus)
  }

  static let timescale: CMTimeScale = 1_000_000

  private struct SourceVideo {
    let track: AVAssetTrack
    let timeRange: CMTimeRange
    let preferredTransform: CGAffineTransform
  }

  private struct Lane {
    let track: AVMutableCompositionTrack
    var endUs: Int64
  }

  /// Resolves media and sticker identifiers to local files. Each logical video track owns up to two
  /// composition tracks so an outgoing and incoming clip can be decoded at the same time.
  public static func build(
    _ plan: RenderPlan,
    assetURL: (String) throws -> URL,
    isolation: isolated (any Actor)? = #isolation
  ) async throws -> VideoComposition {
    guard plan.durationUs > 0 else { throw BuildError.invalidPlanDuration }
    let composition = AVMutableComposition()
    // Keep assets alive while inserting edits from their tracks.
    var assets: [String: AVURLAsset] = [:]
    var lanesByTrack: [String: [Lane]] = [:]
    var sources: [String: SourceVideo] = [:]
    var clips: [String: VideoComposition.Clip] = [:]

    for layer in plan.layers.sorted(by: { $0.timing.startUs < $1.timing.startUs }) {
      guard case .video(_, let video) = layer.content else { continue }
      try Task.checkCancellation()
      let timing = layer.timing
      let source = video.source
      guard timing.startUs >= 0, timing.startUs < timing.endUs, timing.endUs <= plan.durationUs
      else {
        throw BuildError.invalidLayerTiming(layerID: timing.id)
      }
      guard clips[timing.id] == nil else { throw BuildError.duplicateLayer(layerID: timing.id) }
      guard valid(source) else {
        throw BuildError.invalidSourceTiming(layerID: timing.id)
      }

      let media: SourceVideo
      if let cached = sources[source.assetUri] {
        media = cached
      } else {
        let asset = try localAsset(source.assetUri, assets: &assets, assetURL: assetURL)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
          throw BuildError.missingVideoTrack(assetURI: source.assetUri)
        }
        let (timeRange, preferredTransform) = try await track.load(.timeRange, .preferredTransform)
        media = SourceVideo(
          track: track, timeRange: timeRange, preferredTransform: preferredTransform)
        sources[source.assetUri] = media
      }

      var lanes = lanesByTrack[timing.trackId, default: []]
      let laneIndex: Int
      if let freeLane = lanes.firstIndex(where: { $0.endUs <= timing.startUs }) {
        laneIndex = freeLane
      } else {
        guard lanes.count < 2 else {
          throw BuildError.tooManyOverlappingClips(trackID: timing.trackId)
        }
        guard
          let track = composition.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else {
          throw BuildError.unableToAddVideoTrack
        }
        track.naturalTimeScale = timescale
        laneIndex = lanes.count
        lanes.append(Lane(track: track, endUs: 0))
      }

      let lane = lanes[laneIndex].track
      clips[timing.id] = try insert(source, timing: timing, media: media, into: lane)
      // A held frame still occupies a lane for the rest of this layer's timeline interval.
      lanes[laneIndex].endUs = timing.endUs
      lanesByTrack[timing.trackId] = lanes
    }

    let mix = try await AudioCompositionBuilder.build(
      plan, into: composition, assets: &assets, assetURL: assetURL)
    let imageTextures =
      clips.isEmpty ? [:] : try ImageTexture.loadLayers(plan.layers, assetURL: assetURL)
    return VideoComposition(
      composition: composition, timelineDuration: timelineEnd(for: plan), clipsByLayerID: clips,
      audioMix: mix, renderPlan: plan, imageTexturesByLayerID: imageTextures)
  }

  private static func timelineEnd(for plan: RenderPlan) -> CMTime {
    let end = time(plan.durationUs)
    guard let fps = CMTimeScale(exactly: plan.canvas.fps), fps > 0 else { return end }
    let frame = end.convertScale(fps, method: .roundHalfAwayFromZero)
    // A rounded-up frame boundary can ask the reader for one sample at the exclusive end.
    guard frame.convertScale(timescale, method: .roundHalfAwayFromZero) == end else { return end }
    return min(end, frame)
  }

  private static func insert(
    _ source: SourceTiming, timing: Layer.Timing, media: SourceVideo,
    into lane: AVMutableCompositionTrack
  ) throws -> VideoComposition.Clip {
    let sourceStart = time(source.sourceStartUs)
    let sourceEnd = time(source.sourceEndUs)
    let mediaStart = media.timeRange.start
    let mediaEnd = media.timeRange.end
    // The plan records source times to the nearest microsecond. Intersect with the track at its
    // native timescale so rounding at the boundary never inserts past the real media.
    let insertStart = max(sourceStart, mediaStart)
    let insertEnd = min(sourceEnd, mediaEnd)
    guard mediaStart.isNumeric, mediaEnd.isNumeric,
      sourceStart >= mediaStart.convertScale(timescale, method: .roundHalfAwayFromZero),
      sourceEnd <= mediaEnd.convertScale(timescale, method: .roundHalfAwayFromZero),
      insertStart < insertEnd
    else {
      throw BuildError.sourceRangeOutsideTrack(layerID: timing.id)
    }

    let cursorUs = try forEachSourceEdit(source, startUs: timing.startUs, endUs: timing.endUs) {
      edit in
      let range = CMTimeRange(
        start: insertStart, end: min(insertEnd, edit.source.end))
      try insert(range, of: media.track, into: lane, at: edit.target)
    }

    return VideoComposition.Clip(
      trackID: lane.trackID, preferredTransform: media.preferredTransform,
      playableTimeRange: CMTimeRange(start: time(timing.startUs), end: time(cursorUs)),
      holdTimeRange: cursorUs < timing.endUs
        ? CMTimeRange(start: time(cursorUs), end: time(timing.endUs)) : nil)
  }

  static func localAsset(
    _ uri: String, assets: inout [String: AVURLAsset], assetURL: (String) throws -> URL
  ) throws -> AVURLAsset {
    if let asset = assets[uri] { return asset }
    let url = try assetURL(uri)
    guard url.isFileURL else { throw BuildError.nonFileURL(assetURI: uri) }
    let asset = AVURLAsset(
      url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    assets[uri] = asset
    return asset
  }

  static func valid(_ source: SourceTiming) -> Bool {
    source.sourceStartUs >= 0 && source.sourceStartUs < source.sourceEndUs
      && source.rate.isFinite && source.rate > 0
  }

  static func insert(
    _ source: CMTimeRange, of track: AVAssetTrack, into lane: AVMutableCompositionTrack,
    at target: CMTimeRange
  ) throws {
    // Frame boundaries are rounded independently to microseconds in the plan. Rescaling
    // an otherwise normal-speed edit by that rounding error can skip a frame in AVFoundation.
    if source.duration != target.duration,
      CMTimeAbsoluteValue(source.duration - target.duration) <= time(1)
    {
      let duration = min(source.duration, target.duration)
      try lane.insertTimeRange(
        CMTimeRange(start: source.start, duration: duration), of: track, at: target.start)
      return
    }
    try lane.insertTimeRange(source, of: track, at: target.start)
    if source.duration != target.duration {
      lane.scaleTimeRange(
        CMTimeRange(start: target.start, duration: source.duration), toDuration: target.duration)
    }
  }

  @discardableResult
  static func forEachSourceEdit(
    _ source: SourceTiming, startUs: Int64, endUs: Int64, _ insert: (CMTimeMapping) throws -> Void
  ) throws -> Int64 {
    let availableUs = source.sourceEndUs - source.sourceStartUs
    let passDurationUs = (Double(availableUs) / source.rate).rounded()
    var cursorUs = startUs
    repeat {
      try Task.checkCancellation()
      let remainingUs = endUs - cursorUs
      let playedUs = boundedDuration(passDurationUs, limit: remainingUs)
      let consumedUs =
        passDurationUs <= Double(remainingUs)
        ? availableUs : boundedDuration(Double(playedUs) * source.rate, limit: availableUs)
      try insert(
        CMTimeMapping(
          source: CMTimeRange(start: time(source.sourceStartUs), duration: time(consumedUs)),
          target: CMTimeRange(start: time(cursorUs), duration: time(playedUs))))
      cursorUs += playedUs
    } while cursorUs < endUs && source.afterEnd == .loop
    return cursorUs
  }

  static func time(_ us: Int64) -> CMTime {
    CMTime(value: us, timescale: timescale)
  }

  private static func boundedDuration(_ duration: Double, limit: Int64) -> Int64 {
    let rounded = duration.rounded()
    return rounded >= Double(limit) ? limit : max(1, Int64(rounded))
  }
}
