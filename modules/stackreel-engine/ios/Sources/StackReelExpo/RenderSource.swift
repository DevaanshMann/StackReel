@preconcurrency import AVFoundation
import Foundation
import StackReelComposition
import StackReelPlan

private struct RenderSource: Decodable {
  let plan: RenderPlan
  let assets: [String: String]

  func localAssets() throws -> [String: URL] {
    let files = try assets.mapValues(LocalMedia.fileURL)
    var identifiers = Set(plan.audio.map(\.source.assetUri))
    for layer in plan.layers {
      switch layer.content {
      case .video(_, let video): identifiers.insert(video.source.assetUri)
      case .image(_, let image): identifiers.insert(image.assetUri)
      case .sticker(let sticker): identifiers.insert(sticker.asset)
      case .text: break
      }
    }
    if let missing = identifiers.subtracting(files.keys).sorted().first {
      throw BridgeError.missingAsset(missing)
    }
    return files
  }
}

enum BridgeError: LocalizedError {
  case nonLocalFile(String)
  case missingAsset(String)
  case missingVideo
  case invalidVideoMetadata

  var errorDescription: String? {
    switch self {
    case .nonLocalFile(let uri): "Expected an absolute local file URL, got \(uri)."
    case .missingAsset(let id): "No local file URL was supplied for asset \(id)."
    case .missingVideo: "The file has no video track."
    case .invalidVideoMetadata: "The video track has invalid dimensions or timing."
    }
  }

  static func message(for error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? String(describing: error)
  }
}

enum LocalMedia {
  static func fileURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL, url.path.hasPrefix("/"),
      url.host == nil || url.host == "" || url.host?.lowercased() == "localhost",
      url.user == nil, url.password == nil, url.port == nil,
      url.query == nil, url.fragment == nil
    else { throw BridgeError.nonLocalFile(uri) }
    return url
  }

  @concurrent static func probeVideo(_ uri: String) async throws -> [String: Double] {
    let asset = AVURLAsset(
      url: try fileURL(uri), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw BridgeError.missingVideo
    }

    let (size, transform, range) = try await track.load(
      .naturalSize, .preferredTransform, .timeRange)
    let orientedSize = CGRect(origin: .zero, size: size).applying(transform).standardized.size
    let start = range.start.convertScale(1_000_000, method: .roundHalfAwayFromZero)
    let duration = range.duration.convertScale(1_000_000, method: .roundHalfAwayFromZero)
    guard orientedSize.width.isFinite, orientedSize.width > 0,
      orientedSize.height.isFinite, orientedSize.height > 0,
      start.isNumeric, duration.isNumeric, duration.value > 0
    else { throw BridgeError.invalidVideoMetadata }

    return [
      "width": Double(orientedSize.width),
      "height": Double(orientedSize.height),
      "startUs": Double(start.value),
      "durationUs": Double(duration.value),
    ]
  }

  @concurrent static func probeAudio(_ uri: String) async throws -> [String: Double] {
    try await AudioProbe.metadata(for: fileURL(uri))
  }

  // Transfer the finished composition to its sole owner, or use it locally for export.
  @concurrent static func composition(_ source: String) async throws -> sending VideoComposition {
    try Task.checkCancellation()
    let input = try JSONDecoder().decode(RenderSource.self, from: Data(source.utf8))
    let files = try input.localAssets()
    let composition = try await VideoCompositionBuilder.build(input.plan) { identifier in
      guard let file = files[identifier] else { throw BridgeError.missingAsset(identifier) }
      return file
    }
    try Task.checkCancellation()
    return composition
  }

  @concurrent static func export(
    _ source: String, progress: @escaping @Sendable (Double) -> Void
  ) async throws -> URL {
    let composition = try await composition(source)
    let files = FileManager.default
    let cache = try files.url(
      for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let exports = cache.appendingPathComponent("StackReelExports", isDirectory: true)
    try files.createDirectory(at: exports, withIntermediateDirectories: true)
    let output = exports.appendingPathComponent("\(UUID().uuidString).mp4", isDirectory: false)
    try await composition.exportMP4(to: output, progress: progress)
    return output
  }
}
