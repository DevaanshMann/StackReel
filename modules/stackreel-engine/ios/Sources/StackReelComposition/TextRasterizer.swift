import CoreGraphics
import CoreText
import Foundation
import StackReelPlan

struct TextTexture: Sendable {
  let image: CGImage
  // Text and pill bounds inside the bitmap. Transparent space for stroke and shadow does not
  // move the overlay's anchor.
  let bounds: CGRect
  fileprivate let typewriter: TextRasterizer.Typewriter?

  func bitmap(reveal progress: CGFloat) -> CGImage? {
    guard progress < 1, let typewriter else { return image }
    return typewriter.bitmap(progress: progress)
  }
}

enum TextRasterizer {
  fileprivate struct Line {
    let layout: CTLine
    let width: CGFloat
    let baselineFromTop: CGFloat
    let paragraphStart: Int
  }

  private struct StyleKey: Hashable {
    let text: String
    let style: Layer.TextStyle

    init(_ overlay: Layer.Text) {
      text = overlay.text
      style = overlay.style
    }
  }

  static func textures(for plan: RenderPlan) throws -> [String: TextTexture] {
    let animatedStyles = Set(
      plan.layers.compactMap { layer -> StyleKey? in
        guard case .text(let text) = layer.content,
          (text.animation.in == .typewriter && text.animation.inDurationUs > 0)
            || (text.animation.out == .typewriter && text.animation.outDurationUs > 0)
        else { return nil }
        return StyleKey(text)
      })
    var cache: [StyleKey: TextTexture] = [:]
    var textures: [String: TextTexture] = [:]
    for layer in plan.layers {
      guard case .text(let text) = layer.content, !text.text.isEmpty else { continue }
      let key = StyleKey(text)
      let texture: TextTexture
      if let existing = cache[key] {
        texture = existing
      } else {
        guard
          let rendered = draw(text, canvas: plan.canvas, typewriter: animatedStyles.contains(key))
        else {
          throw VideoComposition.RenderError.unableToRasterizeText(layerID: layer.timing.id)
        }
        texture = rendered
        cache[key] = texture
      }
      textures[layer.timing.id] = texture
    }
    return textures
  }

  private static func draw(_ overlay: Layer.Text, canvas: Canvas, typewriter: Bool) -> TextTexture?
  {
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
      pixelWidth * pixelHeight <= 8192 * 8192
    else { return nil }

    let background = style.background.flatMap { StackReelVideoCompositor.rgbaColor($0.color) }
    let shadow = style.shadow.flatMap { StackReelVideoCompositor.rgbaColor($0.color) }
    guard style.background == nil || background != nil, style.shadow == nil || shadow != nil
    else { return nil }
    let raster = Raster(
      width: Int(pixelWidth), height: Int(pixelHeight), bounds: bounds, background: background,
      corner: min(radius, min(bounds.width, bounds.height) / 2), shadow: shadow,
      shadowOffset: offset, shadowBlur: blur)

    let positionedLines = lines.map { line -> (Line, CGPoint) in
      let gap = width - line.width
      let indent: CGFloat
      switch style.align {
      case .left: indent = 0
      case .center: indent = gap / 2
      case .right: indent = gap
      }
      return (
        line,
        CGPoint(
          x: bounds.minX + padding + indent, y: bounds.maxY - padding - line.baselineFromTop)
      )
    }
    guard
      let image = raster.draw({ context in
        for (line, origin) in positionedLines {
          context.textPosition = origin
          CTLineDraw(line.layout, context)
        }
      })
    else { return nil }

    let reveal =
      typewriter
      ? Typewriter(text: overlay.text, raster: raster, positionedLines: positionedLines) : nil
    return TextTexture(image: image, bounds: bounds, typewriter: reveal)
  }

  fileprivate struct Raster {
    let width: Int
    let height: Int
    let bounds: CGRect
    let background: CGColor?
    let corner: CGFloat
    let shadow: CGColor?
    let shadowOffset: CGSize
    let shadowBlur: CGFloat

    func draw(_ drawText: (CGContext) -> Void) -> CGImage? {
      guard
        let context = CGContext(
          data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
          space: StackReelVideoCompositor.sRGB,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return nil }
      if let background {
        context.setFillColor(background)
        context.addPath(
          CGPath(roundedRect: bounds, cornerWidth: corner, cornerHeight: corner, transform: nil))
        context.fillPath()
      }
      if let shadow {
        context.setShadow(offset: shadowOffset, blur: shadowBlur, color: shadow)
        context.beginTransparencyLayer(auxiliaryInfo: nil)
      }
      context.setAllowsFontSmoothing(false)
      context.textMatrix = .identity
      drawText(context)
      if shadow != nil { context.endTransparencyLayer() }
      return context.makeImage()
    }
  }

  // Core Text layout objects and the single cached partial bitmap are accessed under the lock.
  fileprivate final class Typewriter: @unchecked Sendable {
    private struct RevealLine {
      let layout: CTLine
      let origin: CGPoint
      let start: Int
      let end: Int
      let runs: [Run]

      init(_ line: Line, origin: CGPoint) {
        layout = line.layout
        self.origin = origin
        let range = CTLineGetStringRange(layout)
        start = line.paragraphStart + range.location
        end = start + range.length
        runs = (CTLineGetGlyphRuns(layout) as! [CTRun]).filter { CTRunGetGlyphCount($0) > 0 }.map {
          Run($0, paragraphStart: line.paragraphStart)
        }
      }

      func draw(through visibleEnd: Int, in context: CGContext) {
        if end <= visibleEnd {
          context.textMatrix = .identity
          context.textPosition = origin
          CTLineDraw(layout, context)
        } else {
          for run in runs { run.draw(through: visibleEnd, origin: origin, in: context) }
        }
      }
    }

    private struct Run {
      let layout: CTRun
      let glyphEnds: [Int]

      init(_ run: CTRun, paragraphStart: Int) {
        layout = run
        let glyphCount = CTRunGetGlyphCount(run)
        var indices = [CFIndex](repeating: 0, count: glyphCount)
        CTRunGetStringIndices(run, CFRange(location: 0, length: glyphCount), &indices)
        // Glyphs can share a string index or appear out of logical order. Use the end of each
        // cluster so a ligature appears only once all of its characters have been revealed.
        let runRange = CTRunGetStringRange(run)
        let runEnd = runRange.location + runRange.length
        let starts = Set(indices).sorted()
        let ends = Dictionary(uniqueKeysWithValues: zip(starts, starts.dropFirst() + [runEnd]))
        glyphEnds = indices.map { paragraphStart + ends[$0, default: runEnd] }
      }

      func draw(through visibleEnd: Int, origin: CGPoint, in context: CGContext) {
        var first = 0
        while first < glyphEnds.count {
          guard glyphEnds[first] <= visibleEnd else {
            first += 1
            continue
          }
          var end = first + 1
          while end < glyphEnds.count, glyphEnds[end] <= visibleEnd { end += 1 }
          context.saveGState()
          context.textMatrix = .identity
          context.textPosition = origin
          CTRunDraw(layout, context, CFRange(location: first, length: end - first))
          context.restoreGState()
          first = end
        }
      }
    }

    private let raster: Raster
    private let lines: [RevealLine]
    private let characterEnds: [Int]
    private let lock = NSLock()
    private var cached: (count: Int, image: CGImage)?

    fileprivate init(text: String, raster: Raster, positionedLines: [(Line, CGPoint)]) {
      self.raster = raster
      lines = positionedLines.map { RevealLine($0.0, origin: $0.1) }
      var end = 0
      characterEnds = text.map { character in
        end += character.utf16.count
        return end
      }
    }

    func bitmap(progress: CGFloat) -> CGImage? {
      let count = Int(CGFloat(characterEnds.count) * progress)
      let visibleEnd = count > 0 ? characterEnds[count - 1] : 0
      return lock.withLock {
        if let cached, cached.count == count { return cached.image }
        guard
          let image = raster.draw({ context in
            for line in lines {
              guard line.start < visibleEnd else { break }
              line.draw(through: visibleEnd, in: context)
            }
          })
        else { return nil }
        cached = (count, image)
        return image
      }
    }
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
    var paragraphStart = 0
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
        lines.append(
          Line(
            layout: line, width: visibleWidth, baselineFromTop: baseline,
            paragraphStart: paragraphStart))
        widest = max(widest, visibleWidth)
        nextTop = max(nextTop + 1, height + max(0, fontLeading, leading))
        start += length
      } while start < value.length
      paragraphStart += value.length
      if paragraph.endIndex < text.endIndex {
        paragraphStart += text[paragraph.endIndex].utf16.count
      }
    }
    return (lines, ceil(widest), max(1, ceil(height)))
  }
}
