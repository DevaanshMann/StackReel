// Older SDKs import loadTracks as nonisolated without annotating its AVAssetTrack results.
@preconcurrency import AVFoundation
import StackReelPlan

/// The video tracks and timing a compositor needs to look up frames by render-plan layer ID.
public struct VideoComposition {
  public struct Clip {
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
}

public enum VideoCompositionBuilder {
  public enum BuildError: Error, Equatable {
    case invalidPlanDuration
    case invalidLayerTiming(layerID: String)
    case duplicateLayer(layerID: String)
    case invalidSourceTiming(layerID: String)
    case nonFileURL(assetURI: String)
    case missingVideoTrack(assetURI: String)
    case sourceRangeOutsideTrack(layerID: String)
    case tooManyOverlappingClips(trackID: String)
    case unableToAddVideoTrack
  }

  private static let timescale: CMTimeScale = 1_000_000

  private struct SourceVideo {
    // AVAssetTrack holds a weak reference to its asset.
    let asset: AVURLAsset
    let track: AVAssetTrack
    let timeRange: CMTimeRange
    let preferredTransform: CGAffineTransform
  }

  private struct Lane {
    let track: AVMutableCompositionTrack
    var endUs: Int64
  }

  /// Resolves the plan's video asset identifiers to local files. Each logical track owns up to two
  /// composition tracks so an outgoing and incoming clip can be decoded at the same time.
  public static func build(
    _ plan: RenderPlan,
    assetURL: (String) throws -> URL,
    isolation: isolated (any Actor)? = #isolation
  ) async throws -> VideoComposition {
    guard plan.durationUs > 0 else { throw BuildError.invalidPlanDuration }
    let composition = AVMutableComposition()
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
      guard source.sourceStartUs >= 0, source.sourceStartUs < source.sourceEndUs,
        source.rate.isFinite, source.rate > 0
      else {
        throw BuildError.invalidSourceTiming(layerID: timing.id)
      }

      let media: SourceVideo
      if let cached = sources[source.assetUri] {
        media = cached
      } else {
        let url = try assetURL(source.assetUri)
        guard url.isFileURL else { throw BuildError.nonFileURL(assetURI: source.assetUri) }
        let asset = AVURLAsset(
          url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
          throw BuildError.missingVideoTrack(assetURI: source.assetUri)
        }
        let (timeRange, preferredTransform) = try await track.load(.timeRange, .preferredTransform)
        media = SourceVideo(
          asset: asset, track: track, timeRange: timeRange, preferredTransform: preferredTransform)
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

    return VideoComposition(
      composition: composition, timelineDuration: time(plan.durationUs), clipsByLayerID: clips)
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

    let availableUs = source.sourceEndUs - source.sourceStartUs
    let passDurationUs = (Double(availableUs) / source.rate).rounded()
    var cursorUs = timing.startUs
    repeat {
      try Task.checkCancellation()
      let remainingUs = timing.endUs - cursorUs
      let playedUs = boundedDuration(passDurationUs, limit: remainingUs)
      let consumedUs =
        passDurationUs <= Double(remainingUs)
        ? availableUs : boundedDuration(Double(playedUs) * source.rate, limit: availableUs)
      let range = CMTimeRange(
        start: insertStart, end: min(insertEnd, time(source.sourceStartUs + consumedUs)))
      let destination = time(cursorUs)
      try lane.insertTimeRange(range, of: media.track, at: destination)
      let playedDuration = time(playedUs)
      if range.duration != playedDuration {
        lane.scaleTimeRange(
          CMTimeRange(start: destination, duration: range.duration), toDuration: playedDuration)
      }
      cursorUs += playedUs
    } while cursorUs < timing.endUs && source.afterEnd == .loop

    return VideoComposition.Clip(
      trackID: lane.trackID, preferredTransform: media.preferredTransform,
      playableTimeRange: CMTimeRange(start: time(timing.startUs), end: time(cursorUs)),
      holdTimeRange: cursorUs < timing.endUs
        ? CMTimeRange(start: time(cursorUs), end: time(timing.endUs)) : nil)
  }

  private static func time(_ us: Int64) -> CMTime {
    CMTime(value: us, timescale: timescale)
  }

  private static func boundedDuration(_ duration: Double, limit: Int64) -> Int64 {
    let rounded = duration.rounded()
    return rounded >= Double(limit) ? limit : max(1, Int64(rounded))
  }
}
