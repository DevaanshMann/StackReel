import CoreImage
import ImageIO
import StackReelPlan

struct ImageTexture: Sendable {
  let bitmap: CGImage
  let orientation: CGImagePropertyOrientation

  var orientedImage: CIImage {
    CIImage(cgImage: bitmap).oriented(orientation)
  }

  static func loadLayers(_ layers: [Layer], assetURL: (String) throws -> URL) throws
    -> [String: ImageTexture]
  {
    var byIdentifier: [String: ImageTexture] = [:]
    var byURL: [URL: ImageTexture] = [:]
    var byLayerID: [String: ImageTexture] = [:]
    for layer in layers {
      let identifier: String
      switch layer.content {
      case .image(_, let image): identifier = image.assetUri
      case .sticker(let sticker): identifier = sticker.asset
      case .video, .text: continue
      }

      try Task.checkCancellation()
      if let cached = byIdentifier[identifier] {
        byLayerID[layer.timing.id] = cached
        continue
      }
      let url = try assetURL(identifier)
      guard url.isFileURL else {
        throw VideoCompositionBuilder.BuildError.nonFileURL(assetURI: identifier)
      }
      let file = url.standardizedFileURL
      let texture = try byURL[file] ?? load(file, identifier: identifier)
      byURL[file] = texture
      byIdentifier[identifier] = texture
      byLayerID[layer.timing.id] = texture
    }
    return byLayerID
  }

  private static func load(_ url: URL, identifier: String) throws -> ImageTexture {
    let decodeError = VideoCompositionBuilder.BuildError.unableToDecodeImage(assetURI: identifier)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw decodeError }
    let count = CGImageSourceGetCount(source)
    guard count <= 1 else {
      throw VideoCompositionBuilder.BuildError.unsupportedMultiImageAsset(assetURI: identifier)
    }
    let options = [kCGImageSourceShouldCacheImmediately: true] as CFDictionary
    guard count == 1, let bitmap = CGImageSourceCreateImageAtIndex(source, 0, options),
      CGImageSourceGetStatusAtIndex(source, 0) == .statusComplete
    else { throw decodeError }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let orientation =
      (properties?[kCGImagePropertyOrientation] as? UInt32)
      .flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up
    return ImageTexture(bitmap: bitmap, orientation: orientation)
  }

  func image(for sticker: Layer.Sticker, timing: Layer.Timing, canvas: Canvas, at timeUs: Double)
    -> CIImage?
  {
    let image = orientedImage
    let bounds = image.extent
    let baseScale = sticker.widthPx / bounds.width
    let size = CGSize(width: sticker.widthPx, height: bounds.height * baseScale)
    let animation = OverlayFrame(sticker.animation, timing: timing, at: timeUs, size: size)
    let opacity = timing.opacity * animation.opacity
    guard animation.scale > 0, opacity > 0 else { return nil }
    return
      image
      .transformed(
        by: animation.transform(
          bounds: bounds, placement: sticker.placement, canvas: canvas, baseScale: baseScale)
      )
      .withOpacity(opacity)
  }
}
