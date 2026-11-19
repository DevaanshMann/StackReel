import CoreGraphics
import CoreText
import Foundation
import StackReelPlan

struct TextTexture: Sendable {
  let image: CGImage
  // Text and pill bounds inside the bitmap. Transparent space for stroke and shadow does not
  // move the overlay's anchor.
  let bounds: CGRect
}

enum TextRasterizer {
  private struct Line {
    let layout: CTLine
    let width: CGFloat
    let baselineFromTop: CGFloat
  }

  private struct StyleKey: Hashable {
    let text: String
    let style: Layer.TextStyle
  }

  static func textures(for plan: RenderPlan) throws -> [String: TextTexture] {
    var cache: [StyleKey: TextTexture] = [:]
    var textures: [String: TextTexture] = [:]
    for layer in plan.layers {
      guard case .text(let text) = layer.content, !text.text.isEmpty else { continue }
      let key = StyleKey(text: text.text, style: text.style)
      let texture: TextTexture
      if let existing = cache[key] {
        texture = existing
      } else {
        guard let rendered = draw(text, canvas: plan.canvas) else {
          throw VideoComposition.RenderError.unableToRasterizeText(layerID: layer.timing.id)
        }
        texture = rendered
        cache[key] = texture
      }
      textures[layer.timing.id] = texture
    }
    return textures
  }

  private static func draw(_ overlay: Layer.Text, canvas: Canvas) -> TextTexture? {
    let style = overlay.style
    let padding = CGFloat(style.background?.paddingPx ?? 0)
    let strokeWidth = CGFloat(style.stroke?.widthPx ?? 0)
    let blur = CGFloat(style.shadow?.blurPx ?? 0)
    let offset = CGSize(
      width: style.shadow?.offsetXPx ?? 0, height: -(style.shadow?.offsetYPx ?? 0))
    let radius = CGFloat(style.background?.cornerRadiusPx ?? 0)
    let size = CGFloat(style.sizePx)
    guard size.isFinite, size > 0,
      [padding, strokeWidth, blur, radius].allSatisfy({ $0.isFinite && $0 >= 0 }),
      offset.width.isFinite, offset.height.isFinite,
      let fillColor = StackReelVideoCompositor.rgbaColor(style.color)
    else { return nil }

    // Reserve space for the visual overflow without shifting the text block's anchor.
    let margin = ceil(
      2 + size / 4 + strokeWidth + 3 * blur + max(abs(offset.width), abs(offset.height)))
    guard margin + padding < 8192 else { return nil }

    var font = CTFontCreateWithName(style.font as CFString, size, nil)
    if (CTFontCopyPostScriptName(font) as String).caseInsensitiveCompare(style.font)
      != .orderedSame,
      let fallback = CTFontCreateUIFontForLanguage(.system, size, nil)
    {
      font = fallback
    }
    var attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): fillColor,
    ]
    if let stroke = style.stroke, strokeWidth > 0 {
      guard let color = StackReelVideoCompositor.rgbaColor(stroke.color) else { return nil }
      attributes[NSAttributedString.Key(kCTStrokeColorAttributeName as String)] = color
      attributes[NSAttributedString.Key(kCTStrokeWidthAttributeName as String)] =
        -100 * strokeWidth / size
    }

    guard
      let (lines, width, height) = layout(
        overlay.text, font: font, attributes: attributes,
        width: max(1, CGFloat(canvas.width) - 2 * padding),
        heightLimit: 16_384 - 2 * (margin + padding))
    else { return nil }
    let bounds = CGRect(
      x: margin, y: margin, width: width + 2 * padding, height: height + 2 * padding)
    let pixelWidth = ceil(bounds.maxX + margin)
    let pixelHeight = ceil(bounds.maxY + margin)
    guard pixelWidth > 0, pixelHeight > 0, pixelWidth <= 16_384, pixelHeight <= 16_384,
      pixelWidth * pixelHeight <= 8192 * 8192,
      let context = CGContext(
        data: nil, width: Int(pixelWidth), height: Int(pixelHeight), bitsPerComponent: 8,
        bytesPerRow: 0, space: StackReelVideoCompositor.sRGB,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }

    if let background = style.background {
      guard let color = StackReelVideoCompositor.rgbaColor(background.color) else { return nil }
      let corner = min(radius, min(bounds.width, bounds.height) / 2)
      context.setFillColor(color)
      context.addPath(
        CGPath(roundedRect: bounds, cornerWidth: corner, cornerHeight: corner, transform: nil))
      context.fillPath()
    }

    let shadowColor = style.shadow.flatMap { StackReelVideoCompositor.rgbaColor($0.color) }
    if style.shadow != nil && shadowColor == nil { return nil }
    if let shadowColor {
      context.setShadow(offset: offset, blur: blur, color: shadowColor)
      context.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    context.setAllowsFontSmoothing(false)
    context.textMatrix = .identity
    for line in lines {
      let gap = width - line.width
      let indent: CGFloat
      switch style.align {
      case .left: indent = 0
      case .center: indent = gap / 2
      case .right: indent = gap
      }
      context.textPosition = CGPoint(
        x: bounds.minX + padding + indent, y: bounds.maxY - padding - line.baselineFromTop)
      CTLineDraw(line.layout, context)
    }
    if shadowColor != nil { context.endTransparencyLayer() }
    return context.makeImage().map { TextTexture(image: $0, bounds: bounds) }
  }

  private static func layout(
    _ text: String, font: CTFont, attributes: [NSAttributedString.Key: Any], width: CGFloat,
    heightLimit: CGFloat
  ) -> (lines: [Line], width: CGFloat, height: CGFloat)? {
    let fontAscent = CTFontGetAscent(font)
    let fontDescent = CTFontGetDescent(font)
    let fontLeading = CTFontGetLeading(font)
    var lines: [Line] = []
    var widest: CGFloat = 1
    var height: CGFloat = 0
    var nextTop: CGFloat = 0
    for paragraph in text.split(omittingEmptySubsequences: false, whereSeparator: { $0.isNewline })
    {
      let value = NSAttributedString(string: String(paragraph), attributes: attributes)
      let typesetter = CTTypesetterCreateWithAttributedString(value)
      let characters = value.string as NSString
      var start = 0
      repeat {
        let count = CTTypesetterSuggestLineBreak(typesetter, start, Double(width))
        let length =
          count > 0 || start == value.length
          ? count : characters.rangeOfComposedCharacterSequence(at: start).length
        let line =
          value.length == 0
          ? CTLineCreateWithAttributedString(value)
          : CTTypesetterCreateLine(typesetter, CFRange(location: start, length: length))
        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var leading: CGFloat = 0
        let advance = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        let visibleWidth = max(0, advance - CTLineGetTrailingWhitespaceWidth(line))
        let baseline = nextTop + max(fontAscent, ascent)
        height = baseline + max(fontDescent, descent)
        guard height <= heightLimit else { return nil }
        lines.append(Line(layout: line, width: visibleWidth, baselineFromTop: baseline))
        widest = max(widest, visibleWidth)
        nextTop = max(nextTop + 1, height + max(0, fontLeading, leading))
        start += length
      } while start < value.length
    }
    return (lines, ceil(widest), max(1, ceil(height)))
  }
}
