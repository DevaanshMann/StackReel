import AVFoundation
import ExpoModulesCore
import StackReelComposition
import UIKit

final class EnginePreviewView: ExpoView {
  let onReady = EventDispatcher()
  let onPositionChange = EventDispatcher()
  let onError = EventDispatcher()

  var source: String? {
    didSet {
      guard source != oldValue else { return }
      clearPreview()
      loadPreview()
    }
  }

  var playing = false {
    didSet {
      if playing != oldValue { updatePlayback() }
    }
  }

  var looping = false {
    didSet { surface.preview?.isLooping = looping }
  }

  private let surface = StackReelPreviewView(frame: .zero)
  private var requestID: UUID?
  private var loadTask: Task<Void, Never>?
  private var pendingSeek: (id: UUID, promise: Promise)?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    surface.isUserInteractionEnabled = false
    addSubview(surface)
  }

  deinit { loadTask?.cancel() }

  override func layoutSubviews() {
    super.layoutSubviews()
    surface.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      clearPreview()
    } else if requestID == nil {
      loadPreview()
    }
  }

  func seek(to seconds: Double, promise: Promise) {
    guard seconds.isFinite else {
      promise.reject("ERR_PREVIEW_SEEK", "Seek time must be finite.")
      return
    }
    guard let preview = surface.preview else {
      promise.reject("ERR_PREVIEW_SEEK", "The preview is not ready.")
      return
    }
    pendingSeek?.promise.reject("ERR_PREVIEW_SEEK", "The seek was superseded.")
    let id = UUID()
    pendingSeek = (id, promise)

    let target =
      seconds >= preview.duration.seconds
      ? preview.duration : CMTime(seconds: max(0, seconds), preferredTimescale: 1_000_000)
    preview.seek(to: target) { [weak self] finished in
      guard let self, self.pendingSeek?.id == id else { return }
      self.pendingSeek = nil
      if finished {
        promise.resolve()
      } else {
        promise.reject("ERR_PREVIEW_SEEK", "The seek was interrupted.")
      }
    }
  }

  private func loadPreview() {
    guard window != nil, let source else { return }
    let id = UUID()
    requestID = id
    loadTask = Task { @MainActor [weak self] in
      do {
        let composition = try await LocalMedia.composition(source)
        guard let self, self.requestID == id, !Task.isCancelled else { return }
        self.loadTask = nil
        let preview = try StackReelPreviewPlayer(composition: composition)
        preview.isLooping = self.looping
        preview.onPositionChange = { [weak self] time in
          guard let self, self.requestID == id else { return }
          self.onPositionChange(["positionSeconds": time.seconds])
        }
        preview.onPlaybackError = { [weak self] error in
          self?.failPreview(id: id, error: error)
        }
        self.surface.preview = preview
        self.onReady(["durationSeconds": preview.duration.seconds])
        self.updatePlayback()
      } catch {
        guard !Task.isCancelled else { return }
        self?.failPreview(id: id, error: error)
      }
    }
  }

  private func failPreview(id: UUID, error: Error) {
    guard requestID == id else { return }
    clearPreview()
    onError(["message": BridgeError.message(for: error)])
  }

  private func clearPreview() {
    requestID = nil
    loadTask?.cancel()
    loadTask = nil
    pendingSeek?.promise.reject("ERR_PREVIEW_SEEK", "The preview was unloaded.")
    pendingSeek = nil
    surface.preview?.pause()
    surface.preview = nil
  }

  private func updatePlayback() {
    if playing { surface.preview?.play() } else { surface.preview?.pause() }
  }
}
