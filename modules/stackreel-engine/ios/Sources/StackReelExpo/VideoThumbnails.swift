@preconcurrency import AVFoundation
import ImageIO
import UniformTypeIdentifiers

enum VideoThumbnails {
  enum RequestError: LocalizedError {
    case tooManyFrames

    var errorDescription: String? { "Request up to eight video thumbnails at a time." }
  }

  static func generate(for url: URL, timesUs: [Double]) async throws -> [String?] {
    guard timesUs.count <= 8 else { throw RequestError.tooManyFrames }
    guard !timesUs.isEmpty else { return [] }
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      return Array(repeating: nil, count: timesUs.count)
    }
    let range = try await track.load(.timeRange)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 192, height: 192)
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    var frames: [String?] = []
    for timeUs in timesUs {
      try Task.checkCancellation()
      guard let microseconds = Int64(exactly: timeUs), microseconds >= 0 else {
        frames.append(nil)
        continue
      }
      let time = CMTime(value: microseconds, timescale: 1_000_000)
      guard range.containsTime(time) else {
        frames.append(nil)
        continue
      }
      // Keep one decoded frame in memory at a time and preserve failed samples in place.
      let frame: String? = await withCheckedContinuation { continuation in
        generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { _, image, _, result, _ in
          continuation.resume(returning: result == .succeeded ? image.flatMap(jpegDataURI) : nil)
        }
      }
      frames.append(frame)
    }
    return frames
  }

  private static func jpegDataURI(_ image: CGImage) -> String? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    let properties = [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary
    CGImageDestinationAddImage(destination, image, properties)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return "data:image/jpeg;base64," + data.base64EncodedString()
  }
}
