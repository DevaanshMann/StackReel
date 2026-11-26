// Older SDKs import loadTracks as nonisolated without annotating its AVAssetTrack results.
@preconcurrency import AVFoundation
import StackReelPlan
import XCTest

@testable import StackReelComposition

final class StackReelPreviewPlayerTests: XCTestCase {
  @MainActor
  func testUsesCustomVideoCompositionAndAudioMix() async throws {
    let preview = try await StackReelPreviewPlayer(composition: makeComposition(withAudio: true))
    let item = try XCTUnwrap(preview.player.currentItem)
    let assetDuration = try await item.asset.load(.duration)
    XCTAssertEqual(preview.duration, CMTime(value: 2_013_457, timescale: 1_000_000))
    XCTAssertEqual(assetDuration, preview.duration)
    XCTAssertEqual(item.forwardPlaybackEndTime, preview.duration)
    let video = try XCTUnwrap(item.videoComposition)
    XCTAssertTrue(video.customVideoCompositorClass == StackReelVideoCompositor.self)
    XCTAssertEqual(video.renderSize, CGSize(width: 32, height: 48))
    let audioTracks = try await item.asset.loadTracks(withMediaType: .audio)
    XCTAssertEqual(audioTracks.count, 1)
    XCTAssertEqual(item.audioMix?.inputParameters.map(\.trackID), audioTracks.map(\.trackID))
  }

  @MainActor
  func testPreparedPreviewPlaysComposedFramesAndIncludesSound() async throws {
    let composition = try await makeComposition(withAudio: true)
    let preview = try await StackReelPreviewPlayer.prepare(composition: composition)
    let item = try XCTUnwrap(preview.player.currentItem)
    let audioTracks = try await item.asset.loadTracks(withMediaType: .audio)
    XCTAssertEqual(audioTracks.count, 1)
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    item.add(output)

    // The clip is gray. Only the compositor can draw the blue background after it ends.
    let frameReceived = expectation(description: "visible frame in the trailing background")
    preview.onPlaybackError = { error in
      XCTFail("Preview failed to display the composition: \(error)")
      frameReceived.fulfill()
    }
    preview.onPositionChange = { [weak preview] time in
      guard time.seconds >= 1.55,
        let frame = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil)
      else { return }
      preview?.onPositionChange = nil
      preview?.pause()
      CVPixelBufferLockBaseAddress(frame, .readOnly)
      defer { CVPixelBufferUnlockBaseAddress(frame, .readOnly) }
      if let pixel = CVPixelBufferGetBaseAddress(frame)?.assumingMemoryBound(to: UInt8.self) {
        XCTAssertGreaterThan(pixel[0], 220)
        XCTAssertLessThan(pixel[1], 30)
        XCTAssertLessThan(pixel[2], 30)
      } else {
        XCTFail("The displayed frame has no pixel data")
      }
      frameReceived.fulfill()
    }
    preview.play()
    let result = await XCTWaiter.fulfillment(of: [frameReceived], timeout: 10)
    XCTAssertEqual(result, .completed)
  }

  @MainActor
  func testClampsSeekTargetsAndSupersedesPendingSeeks() async throws {
    let preview = try await makePreview()
    await assertSeek(preview, to: CMTime(seconds: 10, preferredTimescale: 600))
    XCTAssertEqual(preview.currentTime, preview.duration)
    await assertSeek(preview, to: CMTime(seconds: -1, preferredTimescale: 600))
    XCTAssertEqual(preview.currentTime, .zero)
    preview.seek(to: .invalid) { XCTAssertFalse($0) }
    XCTAssertEqual(preview.currentTime, .zero)

    let superseded = expectation(description: "superseded seek completes")
    let latest = expectation(description: "latest seek completes")
    let resumed = expectation(description: "playback advances from the latest seek")
    let target = CMTime(seconds: 0.75, preferredTimescale: 600)
    preview.onPositionChange = { [weak preview] position in
      guard position.seconds > 0.8 else { return }
      preview?.onPositionChange = nil
      preview?.pause()
      resumed.fulfill()
    }
    preview.play()
    preview.seek(to: preview.duration) {
      XCTAssertFalse($0)
      superseded.fulfill()
    }
    preview.seek(to: target) {
      XCTAssertTrue($0)
      XCTAssertEqual(preview.currentTime.seconds, target.seconds, accuracy: 0.01)
      latest.fulfill()
    }
    let result = await XCTWaiter.fulfillment(of: [superseded, latest, resumed], timeout: 5)
    XCTAssertEqual(result, .completed)
    XCTAssertEqual(preview.player.rate, 0)
  }

  @MainActor
  func testPlayAndPauseReportPositionChanges() async throws {
    let preview = try await makePreview()
    let playing = expectation(description: "playback advances")
    preview.onPositionChange = { [weak preview] position in
      guard position.seconds > 0.1 else { return }
      preview?.onPositionChange = nil
      preview?.pause()
      playing.fulfill()
    }
    preview.play()
    let result = await XCTWaiter.fulfillment(of: [playing], timeout: 5)
    XCTAssertEqual(result, .completed)
    let pausedAt = preview.currentTime
    XCTAssertGreaterThan(pausedAt, .zero)
    try await Task.sleep(nanoseconds: 150_000_000)
    XCTAssertEqual(preview.currentTime.seconds, pausedAt.seconds, accuracy: 0.01)
    XCTAssertEqual(preview.player.rate, 0)

    let target = CMTime(seconds: 1, preferredTimescale: 600)
    var observed: CMTime?
    preview.onPositionChange = { observed = $0 }
    await assertSeek(preview, to: target)
    XCTAssertEqual(observed, target)
  }

  @MainActor
  func testLoopsFromTheBeginningAndStopsWhenLoopingIsDisabled() async throws {
    let preview = try await makePreview()
    let nearEnd = CMTime(seconds: 1.8, preferredTimescale: 600)
    await assertSeek(preview, to: nearEnd)
    preview.isLooping = true
    let looped = expectation(description: "playback advances again after wrapping")
    let stopped = expectation(description: "playback reaches the end with looping disabled")
    preview.onPositionChange = { [weak preview] position in
      guard let preview else { return }
      if preview.isLooping, position.seconds > 0.05, position.seconds < 0.5 {
        preview.isLooping = false
        looped.fulfill()
      } else if !preview.isLooping, position == preview.duration {
        preview.onPositionChange = nil
        stopped.fulfill()
      }
    }
    preview.play()
    let result = await XCTWaiter.fulfillment(of: [looped, stopped], timeout: 8, enforceOrder: true)
    XCTAssertEqual(result, .completed)
    // The position can reach the end before AVPlayer publishes its paused rate.
    let deadline = DispatchTime.now() + .seconds(3)
    while preview.player.rate != 0 && DispatchTime.now() < deadline {
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTAssertEqual(preview.currentTime, preview.duration)
    XCTAssertEqual(preview.player.rate, 0)
  }

  #if os(iOS) && targetEnvironment(simulator)
    @MainActor
    func testRenderedPreviewReleasesItsPrivateMovie() async throws {
      let version = ProcessInfo.processInfo.operatingSystemVersion
      guard version.majorVersion == 27 && version.minorVersion == 0 else {
        throw XCTSkip("The rendered preview is specific to iOS 27.0 Simulator")
      }
      var preview: StackReelPreviewPlayer? = try await makePreview()
      let asset = try XCTUnwrap(preview?.player.currentItem?.asset as? AVURLAsset)
      XCTAssertEqual(asset.url.deletingLastPathComponent().lastPathComponent, "StackReelPreviews")
      XCTAssertTrue(FileManager.default.fileExists(atPath: asset.url.path))
      preview = nil
      XCTAssertFalse(FileManager.default.fileExists(atPath: asset.url.path))
    }
  #endif

  #if os(iOS)
    @MainActor
    func testPreviewViewAttachesAndDetachesThePlayer() async throws {
      let preview = try await makePreview()
      let view = StackReelPreviewView(frame: .zero)
      let layer = try XCTUnwrap(view.layer as? AVPlayerLayer)
      view.preview = preview
      XCTAssertTrue(layer.player === preview.player)
      view.preview = nil
      XCTAssertNil(layer.player)
    }
  #endif

  @MainActor
  private func assertSeek(_ preview: StackReelPreviewPlayer, to time: CMTime) async {
    let completed = expectation(description: "seek to \(time.seconds) seconds completes")
    preview.seek(to: time) {
      XCTAssertTrue($0)
      completed.fulfill()
    }
    let result = await XCTWaiter.fulfillment(of: [completed], timeout: 5)
    XCTAssertEqual(result, .completed)
  }

  @MainActor
  private func makePreview(withAudio: Bool = false) async throws -> StackReelPreviewPlayer {
    try await StackReelPreviewPlayer.prepare(composition: makeComposition(withAudio: withAudio))
  }

  @MainActor
  private func makeComposition(withAudio: Bool) async throws -> VideoComposition {
    let video = try await makeMovie()
    let tone = withAudio ? try makeTestTone(frequency: 440) : nil
    let json: [String: Any] = [
      "renderPlanVersion": 1, "templateId": "preview-test", "durationUs": 2_013_457,
      "canvas": ["width": 32, "height": 48, "fps": 30, "background": "#0000FF"],
      "layers": [
        [
          "id": "video/0", "trackId": "video", "itemIndex": 0, "z": 0, "startUs": 0,
          "endUs": 1_500_000, "opacity": 1, "kind": "video", "slotId": "clip",
          "source": [
            "assetUri": "video", "sourceStartUs": 0, "sourceEndUs": 1_500_000,
            "rate": 1, "afterEnd": "hold", "fitMode": "trim",
          ],
          "fit": "cover", "sourceSize": ["width": 32, "height": 48],
          "cropPx": ["x": 0, "y": 0, "width": 32, "height": 48],
          "transform": [1, 0, 0, 0, 1, 0, 0, 0, 1], "fadeInUs": 0, "fadeOutUs": 0, "gainDb": 0,
        ]
      ],
      "transitions": [], "warnings": [],
      "audio": withAudio
        ? [audioEntry("tone", start: 0, end: 2_000_000, sourceEnd: 2_000_000)] : [],
    ]
    let plan = try JSONDecoder().decode(
      RenderPlan.self, from: JSONSerialization.data(withJSONObject: json))
    return try await VideoCompositionBuilder.build(plan) { uri in
      uri == "video" ? video : try XCTUnwrap(tone)
    }
  }
}
