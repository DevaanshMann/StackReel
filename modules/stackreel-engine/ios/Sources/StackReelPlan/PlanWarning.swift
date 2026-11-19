public struct PlanWarning: Codable {
  public enum ShortClipPolicy: String, Codable {
    case freeze, slow, loop
  }

  public enum Detail: Equatable {
    case missingSlot(slotId: String)
    case assetInfoMissing(slotId: String, assetUri: String)
    case emptyTrim(slotId: String, layerId: String)
    case clipTooShort(
      slotId: String, layerId: String, neededUs: Int64, availableUs: Int64, policy: ShortClipPolicy)
    case minSpeedReached(slotId: String, layerId: String, minSpeed: Double)
    case itemTooShort(trackId: String, itemIndex: Int)
  }

  public let message: String
  public let detail: Detail

  private enum Kind: String, Codable {
    case missingSlot = "missing-slot"
    case assetInfoMissing = "asset-info-missing"
    case emptyTrim = "empty-trim"
    case clipTooShort = "clip-too-short"
    case minSpeedReached = "min-speed-reached"
    case itemTooShort = "item-too-short"
  }

  private enum CodingKeys: String, CodingKey {
    case type, message, slotId, assetUri, layerId, neededUs, availableUs, policy, minSpeed, trackId,
      itemIndex
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    message = try container.decode(String.self, forKey: .message)
    switch try container.decode(Kind.self, forKey: .type) {
    case .missingSlot:
      detail = try .missingSlot(slotId: container.decode(String.self, forKey: .slotId))
    case .assetInfoMissing:
      detail = try .assetInfoMissing(
        slotId: container.decode(String.self, forKey: .slotId),
        assetUri: container.decode(String.self, forKey: .assetUri)
      )
    case .emptyTrim:
      detail = try .emptyTrim(
        slotId: container.decode(String.self, forKey: .slotId),
        layerId: container.decode(String.self, forKey: .layerId)
      )
    case .clipTooShort:
      detail = try .clipTooShort(
        slotId: container.decode(String.self, forKey: .slotId),
        layerId: container.decode(String.self, forKey: .layerId),
        neededUs: container.decode(Int64.self, forKey: .neededUs),
        availableUs: container.decode(Int64.self, forKey: .availableUs),
        policy: container.decode(ShortClipPolicy.self, forKey: .policy)
      )
    case .minSpeedReached:
      detail = try .minSpeedReached(
        slotId: container.decode(String.self, forKey: .slotId),
        layerId: container.decode(String.self, forKey: .layerId),
        minSpeed: container.decode(Double.self, forKey: .minSpeed)
      )
    case .itemTooShort:
      detail = try .itemTooShort(
        trackId: container.decode(String.self, forKey: .trackId),
        itemIndex: container.decode(Int.self, forKey: .itemIndex)
      )
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(message, forKey: .message)
    switch detail {
    case .missingSlot(let slotId):
      try container.encode(Kind.missingSlot, forKey: .type)
      try container.encode(slotId, forKey: .slotId)
    case .assetInfoMissing(let slotId, let assetUri):
      try container.encode(Kind.assetInfoMissing, forKey: .type)
      try container.encode(slotId, forKey: .slotId)
      try container.encode(assetUri, forKey: .assetUri)
    case .emptyTrim(let slotId, let layerId):
      try container.encode(Kind.emptyTrim, forKey: .type)
      try container.encode(slotId, forKey: .slotId)
      try container.encode(layerId, forKey: .layerId)
    case .clipTooShort(let slotId, let layerId, let neededUs, let availableUs, let policy):
      try container.encode(Kind.clipTooShort, forKey: .type)
      try container.encode(slotId, forKey: .slotId)
      try container.encode(layerId, forKey: .layerId)
      try container.encode(neededUs, forKey: .neededUs)
      try container.encode(availableUs, forKey: .availableUs)
      try container.encode(policy, forKey: .policy)
    case .minSpeedReached(let slotId, let layerId, let minSpeed):
      try container.encode(Kind.minSpeedReached, forKey: .type)
      try container.encode(slotId, forKey: .slotId)
      try container.encode(layerId, forKey: .layerId)
      try container.encode(minSpeed, forKey: .minSpeed)
    case .itemTooShort(let trackId, let itemIndex):
      try container.encode(Kind.itemTooShort, forKey: .type)
      try container.encode(trackId, forKey: .trackId)
      try container.encode(itemIndex, forKey: .itemIndex)
    }
  }
}
