import AVFoundation

#if os(iOS)
  import UIKit
#endif

/// Playback controls for a video-backed render plan.
@MainActor
public final class StackReelPreviewPlayer {
  public let duration: CMTime
  public var currentTime: CMTime { boundedTime(player.currentTime()) ?? .zero }
  /// Restarts playback at the beginning when it reaches the end of the plan.
  public var isLooping = false
  /// Receives periodic playback positions and the position after a completed seek on the main actor.
  public var onPositionChange: (@MainActor (CMTime) -> Void)?

  let player: AVPlayer
  private var observers: Observers?
  private var wantsPlayback = false
  private var pendingSeek: (id: UUID, target: CMTime)?

  public init(composition: VideoComposition) throws {
    let render = try composition.makeRenderComposition()
    duration = composition.timelineDuration
    let item = AVPlayerItem(asset: render.asset)
    item.videoComposition = render.videoComposition
    item.audioMix = composition.audioMix
    item.forwardPlaybackEndTime = duration
    item.seekingWaitsForVideoCompositionRendering = true
    player = AVPlayer(playerItem: item)
    player.actionAtItemEnd = .pause

    let position = player.addPeriodicTimeObserver(
      forInterval: CMTime(value: 1, timescale: 30), queue: .main
    ) { [weak self] time in
      MainActor.assumeIsolated {
        guard let self, self.pendingSeek == nil, let position = self.boundedTime(time) else {
          return
        }
        self.onPositionChange?(position)
      }
    }
    let end = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: nil
    ) { [weak self] _ in
      Task { @MainActor in self?.didReachEnd() }
    }
    observers = Observers(player: player, position: position, end: end)
  }

  /// Starts or resumes playback, rewinding first if the preview is at its end.
  public func play() {
    wantsPlayback = true
    if (pendingSeek?.target ?? currentTime) == duration {
      seek(to: .zero)
    } else if pendingSeek == nil {
      player.play()
    }
  }

  public func pause() {
    wantsPlayback = false
    player.pause()
  }

  /// Seeks within the timeline. Seeking to its end pauses playback.
  /// The completion receives false for invalid times and superseded or interrupted seeks.
  public func seek(to time: CMTime, completion: (@MainActor (Bool) -> Void)? = nil) {
    guard let target = boundedTime(time) else {
      completion?(false)
      return
    }
    let id = UUID()
    pendingSeek = (id, target)
    player.pause()
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
      Task { @MainActor in
        guard let self, self.pendingSeek?.id == id else {
          completion?(false)
          return
        }
        self.pendingSeek = nil
        if !finished || target == self.duration { self.wantsPlayback = false }
        if finished {
          if self.wantsPlayback { self.player.play() }
          self.onPositionChange?(self.currentTime)
        }
        completion?(finished)
      }
    }
  }

  private func boundedTime(_ time: CMTime) -> CMTime? {
    guard time.isNumeric, time.epoch == 0 else { return nil }
    return min(max(time, .zero), duration)
  }

  private func didReachEnd() {
    guard pendingSeek == nil, wantsPlayback, currentTime == duration else { return }
    if isLooping {
      seek(to: .zero)
    } else {
      wantsPlayback = false
    }
  }

  private final class Observers {
    let player: AVPlayer
    let position: Any
    let end: NSObjectProtocol

    init(player: AVPlayer, position: Any, end: NSObjectProtocol) {
      self.player = player
      self.position = position
      self.end = end
    }

    deinit {
      player.removeTimeObserver(position)
      NotificationCenter.default.removeObserver(end)
    }
  }
}

#if os(iOS)
  /// A UIKit surface that displays a native preview.
  public final class StackReelPreviewView: UIView {
    public override class var layerClass: AnyClass { AVPlayerLayer.self }

    public var preview: StackReelPreviewPlayer? {
      didSet { (layer as? AVPlayerLayer)?.player = preview?.player }
    }
  }
#endif
