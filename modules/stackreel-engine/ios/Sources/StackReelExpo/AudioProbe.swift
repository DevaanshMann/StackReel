@preconcurrency import AVFoundation
import Foundation

enum AudioProbe {
  enum ProbeError: LocalizedError {
    case missingTrack
    case unplayableTrack
    case invalidTimeRange

    var errorDescription: String? {
      switch self {
      case .missingTrack: "The file has no audio track."
      case .unplayableTrack: "The first audio track cannot be played on this device."
      case .invalidTimeRange: "The first audio track has no usable microsecond range."
      }
    }
  }

  static func metadata(for url: URL, isolation: isolated (any Actor)? = #isolation) async throws
    -> [String: Double]
  {
    let asset = AVURLAsset(
      url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw ProbeError.missingTrack
    }
    let (playable, range) = try await track.load(.isPlayable, .timeRange)
    guard playable else { throw ProbeError.unplayableTrack }
    return try metadata(for: range)
  }

  static func metadata(for range: CMTimeRange) throws -> [String: Double] {
    guard range.isValid, range.start.isNumeric, range.start.epoch == 0,
      range.duration.isNumeric, range.duration.value > 0
    else { throw ProbeError.invalidTimeRange }

    // Round the bounds inward so the resulting source trim stays within the track.
    let start = max(range.start, .zero).convertScale(
      1_000_000, method: .roundTowardPositiveInfinity)
    let end = range.end.convertScale(1_000_000, method: .roundTowardNegativeInfinity)
    let maxSafeInteger: Int64 = (1 << 53) - 1
    guard start.isNumeric, end.isNumeric, start.value < end.value, end.value <= maxSafeInteger
    else { throw ProbeError.invalidTimeRange }

    return ["startUs": Double(start.value), "durationUs": Double(end.value - start.value)]
  }
}
