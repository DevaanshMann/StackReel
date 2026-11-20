// Older SDKs omit Sendable on some Core Image types.
@preconcurrency import CoreImage
import StackReelPlan

extension TextTexture {
  func image(for text: Layer.Text, timing: Layer.Timing, canvas: Canvas, at timeUs: Double)
    throws -> CIImage?
  {
    let animation = TextFrame(text.animation, timing: timing, at: timeUs, size: bounds.size)
    let opacity = max(0, min(1, timing.opacity * animation.opacity))
    guard animation.scale > 0, opacity > 0 else { return nil }
    guard let bitmap = bitmap(reveal: animation.reveal) else {
      throw VideoComposition.RenderError.unableToRasterizeText(layerID: timing.id)
    }
    let fraction = anchorFraction(text.placement.anchor)
    let anchor = CGPoint(
      x: bounds.minX + fraction.x * bounds.width,
      y: bounds.minY + fraction.y * bounds.height)
    // RenderPlan positions use a top-left origin and clockwise angles.
    let angle = -CGFloat(text.placement.rotationDeg) * .pi / 180
    let transform = CGAffineTransform(translationX: -anchor.x, y: -anchor.y)
      .concatenating(CGAffineTransform(scaleX: animation.scale, y: animation.scale))
      .concatenating(CGAffineTransform(rotationAngle: angle))
      .concatenating(
        CGAffineTransform(
          translationX: CGFloat(text.placement.xPx) + animation.offset.x,
          y: CGFloat(canvas.height) - CGFloat(text.placement.yPx) + animation.offset.y))
    let image = CIImage(cgImage: bitmap).transformed(by: transform)
    if opacity >= 1 { return image }
    return image.applyingFilter(
      "CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: opacity)])
  }

  private func anchorFraction(_ anchor: Layer.Placement.Anchor) -> CGPoint {
    switch anchor {
    case .topLeft: return CGPoint(x: 0, y: 1)
    case .top: return CGPoint(x: 0.5, y: 1)
    case .topRight: return CGPoint(x: 1, y: 1)
    case .left: return CGPoint(x: 0, y: 0.5)
    case .center: return CGPoint(x: 0.5, y: 0.5)
    case .right: return CGPoint(x: 1, y: 0.5)
    case .bottomLeft: return CGPoint(x: 0, y: 0)
    case .bottom: return CGPoint(x: 0.5, y: 0)
    case .bottomRight: return CGPoint(x: 1, y: 0)
    }
  }
}

private struct TextFrame {
  var opacity: CGFloat = 1
  var scale: CGFloat = 1
  var offset: CGPoint = .zero
  var reveal: CGFloat = 1

  init(_ animation: Layer.Animation, timing: Layer.Timing, at timeUs: Double, size: CGSize) {
    let elapsed = timeUs - Double(timing.startUs)
    let remaining = Double(timing.endUs) - timeUs
    let inDuration = Double(animation.inDurationUs)
    let outDuration = Double(animation.outDurationUs)
    if inDuration > 0, elapsed < inDuration {
      apply(animation.in, progress: max(0, elapsed / inDuration), slideSign: -1, size: size)
    } else if outDuration > 0, remaining < outDuration {
      apply(animation.out, progress: max(0, remaining / outDuration), slideSign: 1, size: size)
    }
  }

  private mutating func apply(
    _ name: Layer.Animation.Name, progress: CGFloat, slideSign: CGFloat, size: CGSize
  ) {
    let travel = slideSign * (1 - progress)
    switch name {
    case .none: break
    case .typewriter: reveal = progress
    case .fade: opacity = progress
    case .scale: scale = progress
    case .pop:
      // Ease back toward full size after a small overshoot.
      let t = progress - 1
      scale = 1 + 2.7 * t * t * t + 1.7 * t * t
    case .bounce: scale = bounce(progress)
    case .slideUp: offset.y = travel * size.height
    case .slideDown: offset.y = -travel * size.height
    case .slideLeft: offset.x = -travel * size.width
    case .slideRight: offset.x = travel * size.width
    }
  }

  private func bounce(_ progress: CGFloat) -> CGFloat {
    let t = progress * 2.75
    if t < 1 { return t * t }
    if t < 2 { return (t - 1.5) * (t - 1.5) + 0.75 }
    if t < 2.5 { return (t - 2.25) * (t - 2.25) + 0.9375 }
    return (t - 2.625) * (t - 2.625) + 0.984375
  }
}
