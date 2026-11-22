import ExpoModulesCore
import Foundation

public final class StackReelEngineModule: Module {
  private static let moduleName = "StackReelEngine"
  private static let progressEvent = "onExportProgress"
  private let exports = ExportJobs()

  public func definition() -> ModuleDefinition {
    Name(Self.moduleName)
    Events(Self.progressEvent)

    OnCreate { _ = ExportCache.shared }

    AsyncFunction("probeVideo") { (uri: String) async throws -> [String: Double] in
      try await LocalMedia.probeVideo(uri)
    }

    AsyncFunction("probeAudio") { (uri: String) async throws -> [String: Double] in
      try await LocalMedia.probeAudio(uri)
    }

    AsyncFunction("exportMP4") {
      [exports, weak appContext] (source: String, exportId: String, promise: Promise) in
      MainActor.assumeIsolated {
        exports.start(source: source, id: exportId, promise: promise) {
          [weak appContext] fraction in
          guard let appContext, let runtime = try? appContext.runtime else { return }
          // Match Expo's promise priority so progress reaches JS before the export settles.
          runtime.schedule(priority: .immediate) { [weak appContext] in
            let module =
              appContext?.moduleRegistry.get(moduleWithName: Self.moduleName)
              as? StackReelEngineModule
            module?.emitInline(
              event: Self.progressEvent,
              payload: ExportProgress(exportId: exportId, progress: fraction))
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("cancelExport") { [exports] (exportId: String) in
      MainActor.assumeIsolated { exports.cancel(id: exportId) }
    }.runOnQueue(.main)

    OnDestroy { [exports] in
      Task { @MainActor in exports.cancelAll() }
    }

    View(EnginePreviewView.self) {
      Events("onReady", "onPositionChange", "onError")

      Prop("source") { (view: EnginePreviewView, source: String?) in view.source = source }
      Prop("playing", false) { (view: EnginePreviewView, playing: Bool) in view.playing = playing }
      Prop("looping", false) { (view: EnginePreviewView, looping: Bool) in view.looping = looping }

      AsyncFunction("seekTo") { (view: EnginePreviewView, seconds: Double, promise: Promise) in
        MainActor.assumeIsolated { view.seek(to: seconds, promise: promise) }
      }.runOnQueue(.main)
    }
  }
}

private struct ExportProgress: Record {
  @Field var exportId: String = ""
  @Field var progress: Double = 0
}

@MainActor
private final class ExportJobs {
  private var jobs: [String: Task<Void, Never>] = [:]

  nonisolated init() {}

  deinit {
    for job in jobs.values { job.cancel() }
  }

  func start(
    source: String, id: String, promise: Promise, report: @escaping @MainActor (Double) -> Void
  ) {
    guard jobs[id] == nil else {
      promise.reject("ERR_DUPLICATE_EXPORT", "An export with ID \(id) is already active.")
      return
    }

    // Reserve the ID until the encode and all of its progress have finished.
    jobs[id] = Task { [weak self] in
      defer { self?.jobs.removeValue(forKey: id) }
      let (updates, continuation) = AsyncStream<Double>.makeStream(
        bufferingPolicy: .bufferingNewest(1))
      let reporter = Task { @MainActor [weak self] in
        for await fraction in updates {
          guard self?.jobs[id]?.isCancelled == false else { return }
          report(fraction)
        }
      }

      let result: Result<URL, Error>
      do {
        result = .success(
          try await LocalMedia.export(source) { fraction in
            if fraction < 1 { continuation.yield(fraction) }
          })
      } catch {
        result = .failure(error)
      }

      continuation.finish()
      await reporter.value

      switch result {
      case .success(let output) where !Task.isCancelled:
        report(1)
        promise.resolve(["uri": output.absoluteString])
      case .success(let output):
        try? FileManager.default.removeItem(at: output)
        promise.reject("ERR_EXPORT_CANCELLED", "The export was cancelled.")
      case .failure(let error):
        if Task.isCancelled || error is CancellationError {
          promise.reject("ERR_EXPORT_CANCELLED", "The export was cancelled.")
        } else {
          promise.reject("ERR_EXPORT_FAILED", BridgeError.message(for: error))
        }
      }
    }
  }

  func cancel(id: String) {
    jobs[id]?.cancel()
  }

  func cancelAll() {
    for job in jobs.values { job.cancel() }
  }
}
