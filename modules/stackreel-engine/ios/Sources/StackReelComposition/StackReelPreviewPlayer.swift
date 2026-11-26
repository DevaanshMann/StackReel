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
  /// Receives player item failures on the main actor.
  public var onPlaybackError: (@MainActor (Error) -> Void)?

  let player: AVPlayer
  private var observers: Observers?
  private var wantsPlayback = false
  private var pendingSeek: (id: UUID, target: CMTime)?

  private let renderedFile: URL?

  /// Prepares a preview for display, including a private rendered movie on iOS 27.0 Simulator.
  public static func prepare(composition: VideoComposition) async throws -> StackReelPreviewPlayer {
    #if os(iOS) && targetEnvironment(simulator)
      let version = ProcessInfo.processInfo.operatingSystemVersion
      if version.majorVersion == 27 && version.minorVersion == 0 {
        // This runtime accepts the composition until a display is attached, then fails with
        // -12784 before requesting a frame, even with Apple's built-in compositor.
        let file = try await ExportCache.previews.nextOutputURL()
        // Keep the movie and video track clocks precise enough for a seek to the exact plan end.
        // The timeline uses either microseconds or the canvas frame rate.
        let scale = composition.timelineDuration.timescale
        let movieTimeScale = scale * max(1, VideoCompositionBuilder.timescale / scale)
        try await composition.writeMP4(to: file, movieTimeScale: movieTimeScale)
        let preview = StackReelPreviewPlayer(
          item: AVPlayerItem(url: file), duration: composition.timelineDuration, renderedFile: file)
        try Task.checkCancellation()
        return preview
      }
    #endif
    return try StackReelPreviewPlayer(composition: composition)
  }

  public convenience init(composition: VideoComposition) throws {
    let render = try composition.makeRenderComposition()
    let item = AVPlayerItem(asset: render.asset)
    item.videoComposition = render.videoComposition
    item.audioMix = composition.audioMix
    self.init(item: item, duration: composition.timelineDuration, renderedFile: nil)
  }

  private init(item: AVPlayerItem, duration: CMTime, renderedFile: URL?) {
    self.duration = duration
    self.renderedFile = renderedFile
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
    let status = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      guard item.status == .failed else { return }
      let error = item.error ?? CocoaError(.fileReadUnknown)
      Task { @MainActor in self?.onPlaybackError?(error) }
    }
    let failure = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: nil
    ) { [weak self] notification in
      let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
        ?? CocoaError(.fileReadUnknown)
      Task { @MainActor in self?.onPlaybackError?(error) }
    }
    observers = Observers(
      player: player, position: position, notifications: [end, failure], status: status)
  }

  deinit {
    if let renderedFile { try? FileManager.default.removeItem(at: renderedFile) }
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
    let notifications: [NSObjectProtocol]
    let status: NSKeyValueObservation

    init(
      player: AVPlayer, position: Any, notifications: [NSObjectProtocol], status: NSKeyValueObservation
    ) {
      self.player = player
      self.position = position
      self.notifications = notifications
      self.status = status
    }

    deinit {
      player.removeTimeObserver(position)
      for notification in notifications { NotificationCenter.default.removeObserver(notification) }
      status.invalidate()
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
