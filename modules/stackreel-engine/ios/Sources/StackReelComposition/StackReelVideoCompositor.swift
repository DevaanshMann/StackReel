import AVFoundation
// Older SDKs omit Sendable on CIContext, which supports concurrent renders.
@preconcurrency import CoreImage
import Metal
import StackReelPlan

extension VideoComposition {
  public enum RenderError: Error, Equatable {
    case invalidCanvas
    case noVideoLayers
    case unsupportedLayer(layerID: String)
    case unsupportedHold(layerID: String)
    case unsupportedTextAnimation(layerID: String)
    case unableToRasterizeText(layerID: String)
    case unsupportedStickerAnimation(layerID: String)
    case invalidStickerPlacement(layerID: String)
    case unsupportedTransition(transitionID: String)
    case unableToCopyAsset
    case unableToExtendAsset
  }

  /// Creates the paired AVFoundation asset and video composition for video-backed plans.
  public func makeRenderComposition() throws -> (
    asset: AVComposition, videoComposition: AVVideoComposition
  ) {
    let canvas = renderPlan.canvas
    guard canvas.width > 0, canvas.height > 0, let fps = CMTimeScale(exactly: canvas.fps), fps > 0,
      StackReelVideoCompositor.backgroundColor(canvas.background) != nil
    else { throw RenderError.invalidCanvas }
    guard !clipsByLayerID.isEmpty else { throw RenderError.noVideoLayers }
    for layer in renderPlan.layers {
      let id = layer.timing.id
      switch layer.content {
      case .video where clipsByLayerID[id]?.holdTimeRange != nil:
        throw RenderError.unsupportedHold(layerID: id)
      case .sticker(let sticker):
        let placement = sticker.placement
        guard sticker.widthPx.isFinite, sticker.widthPx > 0, placement.xPx.isFinite,
          placement.yPx.isFinite, placement.rotationDeg.isFinite
        else { throw RenderError.invalidStickerPlacement(layerID: id) }
        let animation = sticker.animation
        if (animation.in == .typewriter && animation.inDurationUs > 0)
          || (animation.out == .typewriter && animation.outDurationUs > 0)
        {
          throw RenderError.unsupportedStickerAnimation(layerID: id)
        }
      case .video, .image, .text:
        break
      }
    }
    if let transition = renderPlan.transitions.first(where: {
      $0.type != .crossfade && $0.type != .slide
    }) {
      throw RenderError.unsupportedTransition(transitionID: transition.id)
    }

    let video = AVMutableVideoComposition()
    video.instructions = try StackReelVideoInstruction.schedule(
      renderPlan, clipsByLayerID: clipsByLayerID,
      textTexturesByLayerID: TextRasterizer.textures(for: renderPlan),
      imageTexturesByLayerID: imageTexturesByLayerID)
    video.customVideoCompositorClass = StackReelVideoCompositor.self
    video.renderSize = CGSize(width: canvas.width, height: canvas.height)
    video.frameDuration = CMTime(value: 1, timescale: fps)
    video.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid

    guard let asset = composition.mutableCopy() as? AVMutableComposition
    else { throw RenderError.unableToCopyAsset }
    try extendVideoTrack(asset, frameDuration: video.frameDuration)
    guard let snapshot = asset.copy() as? AVComposition else { throw RenderError.unableToCopyAsset }
    return (asset: snapshot, videoComposition: video)
  }

  private func extendVideoTrack(_ asset: AVMutableComposition, frameDuration: CMTime) throws {
    guard
      let track = asset.tracks.filter({ $0.mediaType == .video })
        .max(by: { $0.timeRange.end < $1.timeRange.end })
    else { throw RenderError.unableToExtendAsset }
    let end = track.timeRange.end
    // A microsecond of frame-boundary rounding does not need a source-backed trailing edit.
    guard timelineDuration - end > VideoCompositionBuilder.time(1) else { return }
    guard
      let last = track.segments.last, let sourceURL = last.sourceURL
    else { throw RenderError.unableToExtendAsset }

    // AVFoundation drops trailing empty edits. A source-backed edit keeps the asset alive while
    // the compositor draws background. The instructions never request this edit's frames.
    let source = last.timeMapping.source
    let timingSegment = AVCompositionTrackSegment(
      url: sourceURL, trackID: last.sourceTrackID,
      sourceTimeRange: CMTimeRange(
        start: source.start, duration: min(source.duration, frameDuration)),
      targetTimeRange: CMTimeRange(start: end, end: timelineDuration))
    let segments = track.segments + [timingSegment]
    try track.validateSegments(segments)
    track.segments = segments
  }
}

final class StackReelVideoCompositor: NSObject, AVVideoCompositing {
  private enum FrameError: Error {
    case invalidInstruction
    case missingFrame(layerID: String)
    case unableToAllocateOutput
  }

  static let sRGB = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
  private let context: CIContext = {
    let options: [CIContextOption: Any] = [
      .cacheIntermediates: false,
      .workingColorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)
        ?? StackReelVideoCompositor.sRGB,
    ]
    if let device = MTLCreateSystemDefaultDevice() {
      return CIContext(mtlDevice: device, options: options)
    }
    return CIContext(options: options)
  }()

  // AVFoundation supplies RGB source buffers already converted from the decoder's native format.
  var sourcePixelBufferAttributes: [String: any Sendable]? {
    [kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA]]
  }

  var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] {
    [
      kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
      kCVPixelBufferMetalCompatibilityKey as String: true,
    ]
  }

  // Each request supplies its own render context and completes before returning.
  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    do {
      guard let instruction = request.videoCompositionInstruction as? StackReelVideoInstruction,
        let background = Self.backgroundColor(instruction.canvas.background)
      else { throw FrameError.invalidInstruction }
      guard let output = request.renderContext.newPixelBuffer()
      else { throw FrameError.unableToAllocateOutput }
      let bounds = CGRect(
        x: 0, y: 0, width: instruction.canvas.width, height: instruction.canvas.height)
      let timeUs = request.compositionTime.seconds * 1_000_000
      var result = CIImage(color: background).cropped(to: bounds)

      for layer in instruction.layers {
        let id = layer.timing.id
        switch layer.content {
        case .text(let text):
          if let texture = instruction.textTexturesByLayerID[id],
            let overlay = try texture.image(
              for: text, timing: layer.timing, canvas: instruction.canvas, at: timeUs)
          {
            result = overlay.composited(over: result)
          }
          continue
        case .sticker(let sticker):
          guard let texture = instruction.imageTexturesByLayerID[id]
          else { throw FrameError.invalidInstruction }
          if let overlay = texture.image(
            for: sticker, timing: layer.timing, canvas: instruction.canvas, at: timeUs)
          {
            result = overlay.composited(over: result)
          }
          continue
        case .video, .image:
          break
        }
        if instruction.transitions.contains(where: { $0.fromLayerId == id }) { continue }
        let incoming = try image(for: layer, in: instruction, request: request, timeUs: timeUs)
        if let transition = instruction.transitions.first(where: { $0.toLayerId == id }) {
          let outgoing: CIImage?
          if let fromID = transition.fromLayerId {
            guard let from = instruction.layers.first(where: { $0.timing.id == fromID })
            else { throw FrameError.invalidInstruction }
            outgoing = try image(for: from, in: instruction, request: request, timeUs: timeUs)
          } else {
            outgoing = nil
          }
          let progress =
            (timeUs - Double(transition.startUs))
            / Double(transition.endUs - transition.startUs)
          result = try composite(
            transition, incoming: incoming, outgoing: outgoing, over: result,
            bounds: bounds, progress: max(0, min(1, progress)))
        } else {
          result = incoming.composited(over: result)
        }
      }

      context.render(result, to: output, bounds: bounds, colorSpace: Self.sRGB)
      request.finish(withComposedVideoFrame: output)
    } catch {
      request.finish(with: error)
    }
  }

  private func composite(
    _ transition: Transition, incoming: CIImage, outgoing: CIImage?, over background: CIImage,
    bounds: CGRect, progress: CGFloat
  ) throws -> CIImage {
    switch transition.type {
    case .crossfade:
      return (outgoing?.composited(over: background) ?? background).applyingFilter(
        "CIDissolveTransition",
        parameters: [
          kCIInputTargetImageKey: incoming.composited(over: background),
          kCIInputTimeKey: progress,
        ])
    case .slide:
      let travel: CGPoint
      // Positive y points up in Core Image.
      switch transition.direction ?? .left {
      case .left: travel = CGPoint(x: -bounds.width, y: 0)
      case .right: travel = CGPoint(x: bounds.width, y: 0)
      case .up: travel = CGPoint(x: 0, y: bounds.height)
      case .down: travel = CGPoint(x: 0, y: -bounds.height)
      }
      // Snap the shared edge once so filtering the two clips cannot expose a seam between them.
      let x = (progress * travel.x).rounded()
      let y = (progress * travel.y).rounded()
      let base =
        outgoing?.cropped(to: bounds)
        .transformed(by: CGAffineTransform(translationX: x, y: y))
        .composited(over: background) ?? background
      return incoming.cropped(to: bounds)
        .transformed(by: CGAffineTransform(translationX: x - travel.x, y: y - travel.y))
        .composited(over: base)
    case .whipPan, .zoomPunch, .spin:
      throw FrameError.invalidInstruction
    }
  }

  private func image(
    for layer: Layer, in instruction: StackReelVideoInstruction,
    request: AVAsynchronousVideoCompositionRequest, timeUs: Double
  ) throws -> CIImage {
    let id = layer.timing.id
    let source: CIImage
    let media: Layer.Media
    let preferredTransform: CGAffineTransform
    switch layer.content {
    case .video(let geometry, _):
      guard let input = instruction.videoInputsByLayerID[id], !input.usesHeldFrame
      else { throw FrameError.invalidInstruction }
      guard let buffer = request.sourceFrame(byTrackID: input.clip.trackID)
      else { throw FrameError.missingFrame(layerID: id) }
      source = CIImage(cvPixelBuffer: buffer)
      media = geometry
      preferredTransform = input.clip.preferredTransform
    case .image(let geometry, _):
      guard let texture = instruction.imageTexturesByLayerID[id]
      else { throw FrameError.invalidInstruction }
      source = texture.orientedImage
      media = geometry
      preferredTransform = .identity
    case .sticker, .text:
      throw FrameError.invalidInstruction
    }

    // The plan and preferred transform operate from the top left. Core Image uses the bottom left.
    let toDisplay = CGAffineTransform(
      a: 1, b: 0, c: 0, d: -1, tx: -source.extent.minX, ty: source.extent.maxY
    ).concatenating(preferredTransform)
    let displayBounds = source.extent.applying(toDisplay)
    let oriented = source.transformed(
      by: toDisplay.concatenating(
        CGAffineTransform(translationX: -displayBounds.minX, y: -displayBounds.minY)))
    let crop = media.cropPx
    let matrix = media.transform.elements
    let toCanvas = CGAffineTransform(
      a: matrix[0], b: matrix[3], c: matrix[1], d: matrix[4], tx: matrix[2], ty: matrix[5]
    ).concatenating(
      CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: CGFloat(instruction.canvas.height)))
    let projected =
      oriented
      .cropped(to: CGRect(x: crop.x, y: crop.y, width: crop.width, height: crop.height))
      .transformed(by: toCanvas)

    var opacity = layer.timing.opacity
    if media.fadeInUs > 0 {
      opacity *= min(1, (timeUs - Double(layer.timing.startUs)) / Double(media.fadeInUs))
    }
    if media.fadeOutUs > 0 {
      opacity *= min(1, (Double(layer.timing.endUs) - timeUs) / Double(media.fadeOutUs))
    }
    return projected.withOpacity(opacity)
  }

  static func backgroundColor(_ hex: String) -> CIColor? {
    rgbaColor(hex).map { CIColor(cgColor: $0) }
  }

  static func rgbaColor(_ hex: String) -> CGColor? {
    let digits = hex.dropFirst()
    guard hex.hasPrefix("#"), digits.count == 6 || digits.count == 8,
      let parsed = UInt32(digits, radix: 16)
    else { return nil }
    let rgba = digits.count == 6 ? (parsed << 8) | 0xFF : parsed
    let components = [24, 16, 8, 0].map { CGFloat((rgba >> $0) & 0xFF) / 255 }
    return CGColor(colorSpace: sRGB, components: components)
  }
}
