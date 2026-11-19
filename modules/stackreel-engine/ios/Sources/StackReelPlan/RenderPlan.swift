public struct RenderPlan: Codable {
  public static let currentVersion = 1

  public let renderPlanVersion: Int
  public let templateId: String
  public let canvas: Canvas
  public let durationUs: Int64
  public let layers: [Layer]
  public let transitions: [Transition]
  public let audio: [AudioEntry]
  public let warnings: [PlanWarning]

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    renderPlanVersion = try container.decode(Int.self, forKey: .renderPlanVersion)
    guard renderPlanVersion == Self.currentVersion else {
      throw DecodingError.dataCorruptedError(
        forKey: .renderPlanVersion, in: container,
        debugDescription:
          "Unsupported render plan version \(renderPlanVersion); expected \(Self.currentVersion)"
      )
    }
    templateId = try container.decode(String.self, forKey: .templateId)
    canvas = try container.decode(Canvas.self, forKey: .canvas)
    durationUs = try container.decode(Int64.self, forKey: .durationUs)
    layers = try container.decode([Layer].self, forKey: .layers)
    transitions = try container.decode([Transition].self, forKey: .transitions)
    audio = try container.decode([AudioEntry].self, forKey: .audio)
    warnings = try container.decode([PlanWarning].self, forKey: .warnings)
  }
}

public struct Canvas: Codable, Sendable {
  public let width: Int
  public let height: Int
  public let fps: Int
  public let background: String
}

public struct SourceTiming: Codable, Sendable {
  public enum AfterEnd: String, Codable, Sendable {
    case hold, loop
  }

  public enum FitMode: String, Codable, Sendable {
    case trim, freeze, slow, loop
  }

  public let assetUri: String
  public let sourceStartUs: Int64
  public let sourceEndUs: Int64
  public let rate: Double
  public let afterEnd: AfterEnd
  public let fitMode: FitMode
}

public struct Transition: Codable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case crossfade, slide, spin
    case whipPan = "whip-pan"
    case zoomPunch = "zoom-punch"
  }

  public enum Direction: String, Codable, Sendable {
    case left, right, up, down
  }

  public let id: String
  public let trackId: String
  public let z: Int
  public let type: Kind
  public let direction: Direction?
  public let startUs: Int64
  public let endUs: Int64
  public let fromLayerId: String?
  public let toLayerId: String

  private enum CodingKeys: String, CodingKey {
    case id, trackId, z, type, direction, startUs, endUs, fromLayerId, toLayerId
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    trackId = try container.decode(String.self, forKey: .trackId)
    z = try container.decode(Int.self, forKey: .z)
    type = try container.decode(Kind.self, forKey: .type)
    direction = try container.decodeIfPresent(Direction.self, forKey: .direction)
    startUs = try container.decode(Int64.self, forKey: .startUs)
    endUs = try container.decode(Int64.self, forKey: .endUs)
    // The key is required. A null value means the transition starts from the background.
    fromLayerId = try container.decode(String?.self, forKey: .fromLayerId)
    toLayerId = try container.decode(String.self, forKey: .toLayerId)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(trackId, forKey: .trackId)
    try container.encode(z, forKey: .z)
    try container.encode(type, forKey: .type)
    try container.encodeIfPresent(direction, forKey: .direction)
    try container.encode(startUs, forKey: .startUs)
    try container.encode(endUs, forKey: .endUs)
    try container.encode(fromLayerId, forKey: .fromLayerId)
    try container.encode(toLayerId, forKey: .toLayerId)
  }
}

public struct AudioEntry: Codable {
  public enum Kind: String, Codable {
    case video, audio, music
  }

  public struct Ducking: Codable {
    public struct Region: Codable {
      public let startUs: Int64
      public let endUs: Int64
    }

    public let gainDb: Double
    public let rampUs: Int64
    public let regions: [Region]
  }

  public let id: String
  public let kind: Kind
  public let slotId: String
  public let startUs: Int64
  public let endUs: Int64
  public let source: SourceTiming
  public let gainDb: Double
  public let fadeInUs: Int64
  public let fadeOutUs: Int64
  public let ducking: Ducking?
}
