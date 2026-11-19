// Older SDKs import loadTracks as nonisolated without annotating its AVAssetTrack results.
@preconcurrency import AVFoundation
import StackReelPlan

enum AudioCompositionBuilder {
  private struct Source {
    let track: AVAssetTrack
    let range: CMTimeRange
  }

  private struct Lane {
    let track: AVMutableCompositionTrack
    let parameters: AVMutableAudioMixInputParameters
    var endUs: Int64
  }

  static func build(
    _ plan: RenderPlan, into composition: AVMutableComposition,
    assets: inout [String: AVURLAsset], assetURL: (String) throws -> URL,
    isolation: isolated (any Actor)? = #isolation
  ) async throws -> AVAudioMix? {
    typealias BuildError = VideoCompositionBuilder.BuildError
    var sources: [String: Source] = [:]
    var silentAssets: Set<String> = []
    // A gain tap applies to a whole composition track. Only reuse lanes with the same boost.
    var lanesByBoost: [Double: [Lane]] = [:]
    for entry in plan.audio.sorted(by: { ($0.startUs, $0.id) < ($1.startUs, $1.id) }) {
      try Task.checkCancellation()
      guard entry.startUs >= 0, entry.endUs > entry.startUs, entry.endUs <= plan.durationUs,
        entry.gainDb.isFinite, entry.gainDb <= 12, entry.fadeInUs >= 0, entry.fadeOutUs >= 0,
        VideoCompositionBuilder.valid(entry.source),
        entry.ducking.map({ $0.rampUs >= 0 && $0.gainDb.isFinite && $0.gainDb <= 0 }) ?? true
      else { throw BuildError.invalidAudioEntry(id: entry.id) }
      if entry.gainDb <= -60 { continue }

      let uri = entry.source.assetUri
      if sources[uri] == nil && !silentAssets.contains(uri) {
        let asset = try VideoCompositionBuilder.localAsset(uri, assets: &assets, assetURL: assetURL)
        if let track = try await asset.loadTracks(withMediaType: .audio).first {
          sources[uri] = Source(track: track, range: try await track.load(.timeRange))
        } else {
          silentAssets.insert(uri)
        }
      }
      guard let source = sources[uri] else {
        if entry.kind == .video { continue }
        throw BuildError.missingAudioTrack(assetURI: uri)
      }

      var edits: [CMTimeMapping] = []
      try VideoCompositionBuilder.forEachSourceEdit(
        entry.source, startUs: entry.startUs, endUs: entry.endUs
      ) { edit in
        // Embedded audio can start late or run out before its video. Keep its source offset
        // in the scaled edit so the available samples stay in sync with the picture.
        let available = edit.source.intersection(source.range)
        guard available.duration.isNumeric, available.duration > .zero else { return }
        let start = CMTimeMapTimeFromRangeToRange(
          available.start, fromRange: edit.source, toRange: edit.target)
        let end = CMTimeMapTimeFromRangeToRange(
          available.end, fromRange: edit.source, toRange: edit.target)
        if end > start {
          edits.append(
            CMTimeMapping(source: available, target: CMTimeRange(start: start, end: end)))
        }
      }
      guard !edits.isEmpty else { continue }

      let boost = max(0, entry.gainDb)
      var lanes = lanesByBoost[boost, default: []]
      let laneIndex: Int
      if let free = lanes.firstIndex(where: { $0.endUs <= entry.startUs }) {
        laneIndex = free
      } else {
        guard
          let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw BuildError.unableToAddAudioTrack }
        track.naturalTimeScale = VideoCompositionBuilder.timescale
        let parameters = AVMutableAudioMixInputParameters(track: track)
        if boost > 0 {
          parameters.audioTapProcessor = try AudioGainTap.make(multiplier: pow(10, boost / 20))
        }
        laneIndex = lanes.count
        lanes.append(Lane(track: track, parameters: parameters, endUs: 0))
      }
      let lane = lanes[laneIndex]
      for edit in edits {
        try VideoCompositionBuilder.insert(
          edit.source, of: source.track, into: lane.track, at: edit.target)
      }
      AudioEnvelope(entry).apply(to: lane.parameters)
      lanes[laneIndex].endUs = entry.endUs
      lanesByBoost[boost] = lanes
    }

    let parameters = lanesByBoost.values.flatMap { $0.map(\.parameters) }
    guard !parameters.isEmpty else { return nil }
    let mix = AVMutableAudioMix()
    mix.inputParameters = parameters.sorted { $0.trackID < $1.trackID }
    return mix.copy() as? AVAudioMix
  }
}
