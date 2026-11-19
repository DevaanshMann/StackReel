import AVFoundation
import CoreImage
import Metal
import StackReelPlan

extension VideoComposition {
  public enum RenderError: Error, Equatable {
    case invalidCanvas
    case noVideoLayers
    case unsupportedLayer(layerID: String)
    case unsupportedHold(layerID: String)
    case unsupportedTransition(transitionID: String)
    case unableToCopyAsset
    case unableToExtendAsset
  }

  /// Creates the paired AVFoundation asset and video composition for video cuts and crossfades.
  public func makeRenderComposition() throws -> (
    asset: AVComposition, videoComposition: AVVideoComposition
  ) {
    let canvas = renderPlan.canvas
    guard canvas.width > 0, canvas.height > 0, let fps = CMTimeScale(exactly: canvas.fps), fps > 0,
      StackReelVideoCompositor.backgroundColor(canvas.background) != nil
    else { throw RenderError.invalidCanvas }
    for layer in renderPlan.layers {
      guard case .video = layer.content
      else { throw RenderError.unsupportedLayer(layerID: layer.timing.id) }
      if clipsByLayerID[layer.timing.id]?.holdTimeRange != nil {
        throw RenderError.unsupportedHold(layerID: layer.timing.id)
      }
    }
    guard !clipsByLayerID.isEmpty else { throw RenderError.noVideoLayers }
    if let transition = renderPlan.transitions.first(where: { $0.type != .crossfade }) {
      throw RenderError.unsupportedTransition(transitionID: transition.id)
    }

    let video = AVMutableVideoComposition()
    video.instructions = try makeVideoInstructions()
    video.customVideoCompositorClass = StackReelVideoCompositor.self
    video.renderSize = CGSize(width: canvas.width, height: canvas.height)
    video.frameDuration = CMTime(value: 1, timescale: fps)
    video.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid

    guard let asset = composition.mutableCopy() as? AVMutableComposition
    else { throw RenderError.unableToCopyAsset }
    if asset.duration < timelineDuration {
      try extendAsset(asset, frameDuration: video.frameDuration)
    }
    guard let snapshot = asset.copy() as? AVComposition else { throw RenderError.unableToCopyAsset }
    return (asset: snapshot, videoComposition: video)
  }

  private func extendAsset(_ asset: AVMutableComposition, frameDuration: CMTime) throws {
    let end = asset.duration
    guard
      let track = asset.tracks.first(where: { $0.mediaType == .video && $0.timeRange.end == end }),
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

  private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
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
        if instruction.transitions.contains(where: { $0.fromLayerId == id }) { continue }
        let incoming = try image(for: layer, in: instruction, request: request, timeUs: timeUs)
        if let transition = instruction.transitions.first(where: { $0.toLayerId == id }) {
          var outgoing = result
          if let fromID = transition.fromLayerId {
            guard let from = instruction.layers.first(where: { $0.timing.id == fromID })
            else { throw FrameError.invalidInstruction }
            outgoing = try image(for: from, in: instruction, request: request, timeUs: timeUs)
              .composited(over: result)
          }
          let progress =
            (timeUs - Double(transition.startUs))
            / Double(transition.endUs - transition.startUs)
          result = outgoing.applyingFilter(
            "CIDissolveTransition",
            parameters: [
              kCIInputTargetImageKey: incoming.composited(over: result),
              kCIInputTimeKey: max(0, min(1, progress)),
            ])
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

  private func image(
    for layer: Layer, in instruction: StackReelVideoInstruction,
    request: AVAsynchronousVideoCompositionRequest, timeUs: Double
  ) throws -> CIImage {
    let id = layer.timing.id
    guard case .video(let media, _) = layer.content,
      let input = instruction.videoInputsByLayerID[id], !input.usesHeldFrame
    else { throw FrameError.invalidInstruction }
    guard let buffer = request.sourceFrame(byTrackID: input.clip.trackID)
    else { throw FrameError.missingFrame(layerID: id) }
    let source = CIImage(cvPixelBuffer: buffer)

    // The plan and preferred transform operate from the top left. Core Image uses the bottom left.
    let toDisplay = CGAffineTransform(
      a: 1, b: 0, c: 0, d: -1, tx: -source.extent.minX, ty: source.extent.maxY
    ).concatenating(input.clip.preferredTransform)
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
    if opacity >= 1 { return projected }
    return projected.applyingFilter(
      "CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: max(0, opacity))])
  }

  static func backgroundColor(_ hex: String) -> CIColor? {
    let digits = hex.dropFirst()
    guard hex.hasPrefix("#"), digits.count == 6 || digits.count == 8,
      let parsed = UInt32(digits, radix: 16)
    else { return nil }
    let rgba = digits.count == 6 ? (parsed << 8) | 0xFF : parsed
    let components = [24, 16, 8, 0].map { CGFloat((rgba >> $0) & 0xFF) / 255 }
    guard let color = CGColor(colorSpace: sRGB, components: components) else { return nil }
    return CIColor(cgColor: color)
  }
}
