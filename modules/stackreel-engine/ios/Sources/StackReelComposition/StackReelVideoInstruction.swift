import AVFoundation
import StackReelPlan

/// The pieces a custom compositor needs to draw any frame in a half-open timeline range.
public final class StackReelVideoInstruction: NSObject, AVVideoCompositionInstructionProtocol,
  Sendable
{
  public struct VideoInput: Sendable {
    public let clip: VideoComposition.Clip
    /// Use the last frame of the clip's playable range during this instruction.
    public let usesHeldFrame: Bool
  }

  public enum ScheduleError: Error, Equatable {
    case invalidPlanDuration
    case invalidLayerTiming(layerID: String)
    case duplicateLayer(layerID: String)
    case missingVideoClip(layerID: String)
    case invalidTransition(transitionID: String)
  }

  public let timeRange: CMTimeRange
  public let canvas: Canvas
  /// Ordered back to front.
  public let layers: [Layer]
  public let transitions: [Transition]
  public let videoInputsByLayerID: [String: VideoInput]
  public let containsTweening: Bool
  public let enablePostProcessing = false
  public let passthroughTrackID = kCMPersistentTrackID_Invalid
  let textTexturesByLayerID: [String: TextTexture]
  let imageTexturesByLayerID: [String: ImageTexture]

  /// An empty array requests no video frames, for example during an overlay-only interval.
  public var requiredSourceTrackIDs: [NSValue]? {
    sourceTrackIDs.map { NSNumber(value: $0) }
  }

  private let sourceTrackIDs: [CMPersistentTrackID]

  private init(
    timeRange: CMTimeRange, canvas: Canvas, layers: [Layer], transitions: [Transition],
    videoInputsByLayerID: [String: VideoInput], textTexturesByLayerID: [String: TextTexture],
    imageTexturesByLayerID: [String: ImageTexture]
  ) {
    self.timeRange = timeRange
    self.canvas = canvas
    self.layers = layers
    self.transitions = transitions
    self.videoInputsByLayerID = videoInputsByLayerID
    self.textTexturesByLayerID = textTexturesByLayerID
    self.imageTexturesByLayerID = imageTexturesByLayerID
    sourceTrackIDs = Set(
      videoInputsByLayerID.values.filter { !$0.usesHeldFrame }.map(\.clip.trackID)
    ).sorted()
    // Request a frame at every output tick in gaps, even when the background remains constant.
    containsTweening =
      sourceTrackIDs.isEmpty || !transitions.isEmpty
      || layers.contains { layer in
        switch layer.content {
        case .video(let media, _), .image(let media, _):
          return media.fadeInUs > 0 || media.fadeOutUs > 0
        case .text(let text):
          return text.animation.inDurationUs > 0 || text.animation.outDurationUs > 0
        case .sticker(let sticker):
          return sticker.animation.inDurationUs > 0 || sticker.animation.outDurationUs > 0
        }
      }
  }

  private enum Event {
    case startLayer(Int)
    case endLayer(Int)
    case startTransition(Int)
    case endTransition(Int)
  }

  static func schedule(
    _ plan: RenderPlan, clipsByLayerID: [String: VideoComposition.Clip],
    textTexturesByLayerID: [String: TextTexture] = [:],
    imageTexturesByLayerID: [String: ImageTexture] = [:]
  ) throws -> [StackReelVideoInstruction] {
    guard plan.durationUs > 0 else { throw ScheduleError.invalidPlanDuration }
    var events: [Int64: [Event]] = [0: [], plan.durationUs: []]
    var layerTiming: [String: Layer.Timing] = [:]
    let layers = plan.layers.sorted {
      ($0.timing.z, $0.timing.itemIndex, $0.timing.id)
        < ($1.timing.z, $1.timing.itemIndex, $1.timing.id)
    }
    let transitions = plan.transitions.sorted {
      ($0.z, $0.startUs, $0.id) < ($1.z, $1.startUs, $1.id)
    }

    for (index, layer) in layers.enumerated() {
      let timing = layer.timing
      guard timing.startUs >= 0, timing.startUs < timing.endUs, timing.endUs <= plan.durationUs
      else { throw ScheduleError.invalidLayerTiming(layerID: timing.id) }
      guard layerTiming.updateValue(timing, forKey: timing.id) == nil
      else { throw ScheduleError.duplicateLayer(layerID: timing.id) }
      events[timing.startUs, default: []].append(.startLayer(index))
      events[timing.endUs, default: []].append(.endLayer(index))

      if case .video = layer.content {
        guard let clip = clipsByLayerID[timing.id]
        else { throw ScheduleError.missingVideoClip(layerID: timing.id) }
        if let hold = clip.holdTimeRange {
          let startUs = hold.start.convertScale(
            VideoCompositionBuilder.timescale, method: .roundHalfAwayFromZero
          ).value
          if events[startUs] == nil { events[startUs] = [] }
        }
      }
    }

    for (index, transition) in transitions.enumerated() {
      func coversTransition(_ id: String) -> Bool {
        guard let timing = layerTiming[id], timing.trackId == transition.trackId else {
          return false
        }
        return timing.startUs <= transition.startUs && transition.endUs <= timing.endUs
      }
      guard transition.startUs < transition.endUs, coversTransition(transition.toLayerId),
        transition.fromLayerId != transition.toLayerId,
        transition.fromLayerId.map(coversTransition) ?? true
      else { throw ScheduleError.invalidTransition(transitionID: transition.id) }
      events[transition.startUs, default: []].append(.startTransition(index))
      events[transition.endUs, default: []].append(.endTransition(index))
    }

    let boundaries = events.keys.sorted()
    var activeLayers: Set<Int> = []
    var activeTransitions: Set<Int> = []
    var instructions: [StackReelVideoInstruction] = []
    for (startUs, endUs) in zip(boundaries, boundaries.dropFirst()) {
      for event in events[startUs, default: []] {
        switch event {
        case .startLayer(let index): activeLayers.insert(index)
        case .endLayer(let index): activeLayers.remove(index)
        case .startTransition(let index): activeTransitions.insert(index)
        case .endTransition(let index): activeTransitions.remove(index)
        }
      }
      let start = VideoCompositionBuilder.time(startUs)
      let visibleLayers = activeLayers.sorted().map { layers[$0] }
      var videoInputs: [String: VideoInput] = [:]
      for layer in visibleLayers {
        let id = layer.timing.id
        if let clip = clipsByLayerID[id] {
          videoInputs[id] = VideoInput(
            clip: clip, usesHeldFrame: clip.holdTimeRange?.containsTime(start) ?? false)
        }
      }
      instructions.append(
        StackReelVideoInstruction(
          timeRange: CMTimeRange(start: start, end: VideoCompositionBuilder.time(endUs)),
          canvas: plan.canvas, layers: visibleLayers,
          transitions: activeTransitions.sorted().map { transitions[$0] },
          videoInputsByLayerID: videoInputs, textTexturesByLayerID: textTexturesByLayerID,
          imageTexturesByLayerID: imageTexturesByLayerID))
    }
    return instructions
  }
}
