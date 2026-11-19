public struct Layer: Codable {
  public struct Timing: Codable {
    public let id: String
    public let trackId: String
    public let itemIndex: Int
    public let z: Int
    public let startUs: Int64
    public let endUs: Int64
    public let opacity: Double
  }

  public enum Content {
    case video(Media, Video)
    case image(Media, Image)
    case text(Text)
    case sticker(Sticker)
  }

  public let timing: Timing
  public let content: Content

  private enum Kind: String, Codable {
    case video, image, text, sticker
  }

  private enum CodingKeys: String, CodingKey {
    case kind
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decode(Kind.self, forKey: .kind)
    timing = try Timing(from: decoder)
    switch kind {
    case .video:
      content = try .video(Media(from: decoder), Video(from: decoder))
    case .image:
      content = try .image(Media(from: decoder), Image(from: decoder))
    case .text:
      content = try .text(Text(from: decoder))
    case .sticker:
      content = try .sticker(Sticker(from: decoder))
    }
  }

  // The wire format puts timing, the kind tag and its payload in the same JSON object.
  public func encode(to encoder: Encoder) throws {
    try timing.encode(to: encoder)
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch content {
    case .video(let media, let video):
      try container.encode(Kind.video, forKey: .kind)
      try media.encode(to: encoder)
      try video.encode(to: encoder)
    case .image(let media, let image):
      try container.encode(Kind.image, forKey: .kind)
      try media.encode(to: encoder)
      try image.encode(to: encoder)
    case .text(let text):
      try container.encode(Kind.text, forKey: .kind)
      try text.encode(to: encoder)
    case .sticker(let sticker):
      try container.encode(Kind.sticker, forKey: .kind)
      try sticker.encode(to: encoder)
    }
  }

  public struct Media: Codable {
    public enum Fit: String, Codable {
      case cover, contain, fill
    }

    public struct Size: Codable {
      public let width: Double
      public let height: Double
    }

    public struct Rect: Codable {
      public let x: Double
      public let y: Double
      public let width: Double
      public let height: Double
    }

    public struct Transform: Codable {
      /// Row-major 3×3 matrix mapping source pixels to canvas pixels.
      public let elements: [Double]

      public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        elements = try container.decode([Double].self)
        guard elements.count == 9 else {
          throw DecodingError.dataCorruptedError(
            in: container, debugDescription: "Expected nine elements in the media transform"
          )
        }
      }

      public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(elements)
      }
    }

    public let slotId: String
    public let fit: Fit
    public let sourceSize: Size
    public let cropPx: Rect
    public let transform: Transform
    public let fadeInUs: Int64
    public let fadeOutUs: Int64
  }

  public struct Video: Codable {
    public let source: SourceTiming
    public let gainDb: Double
  }

  public struct Image: Codable {
    public let assetUri: String
  }

  public struct Text: Codable {
    public let text: String
    public let style: TextStyle
    public let placement: Placement
    public let animation: Animation
  }

  public struct Sticker: Codable {
    public let asset: String
    public let widthPx: Double
    public let placement: Placement
    public let animation: Animation
  }

  public struct Placement: Codable {
    public enum Anchor: String, Codable {
      case top, left, center, right, bottom
      case topLeft = "top-left"
      case topRight = "top-right"
      case bottomLeft = "bottom-left"
      case bottomRight = "bottom-right"
    }

    public let xPx: Double
    public let yPx: Double
    public let anchor: Anchor
    public let rotationDeg: Double
  }

  public struct Animation: Codable {
    public enum Name: String, Codable {
      case none, fade, pop, scale, typewriter, bounce
      case slideUp = "slide-up"
      case slideDown = "slide-down"
      case slideLeft = "slide-left"
      case slideRight = "slide-right"
    }

    public let `in`: Name
    public let out: Name
    public let inDurationUs: Int64
    public let outDurationUs: Int64
  }

  public struct TextStyle: Codable {
    public enum Alignment: String, Codable {
      case left, center, right
    }

    public struct Stroke: Codable {
      public let color: String
      public let widthPx: Double
    }

    public struct Shadow: Codable {
      public let color: String
      public let blurPx: Double
      public let offsetXPx: Double
      public let offsetYPx: Double
    }

    public struct Background: Codable {
      public let color: String
      public let paddingPx: Double
      public let cornerRadiusPx: Double
    }

    public let font: String
    public let sizePx: Double
    public let color: String
    public let align: Alignment
    public let stroke: Stroke?
    public let shadow: Shadow?
    public let background: Background?
  }
}
