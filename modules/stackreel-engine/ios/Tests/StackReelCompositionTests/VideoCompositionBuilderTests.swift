import AVFoundation
import StackReelPlan
import XCTest

@testable import StackReelComposition

final class VideoCompositionBuilderTests: XCTestCase {
  @MainActor
  func testTrimmedClipsOverlapOnSeparateTracksAndReuseFreeTracks() async throws {
    // Encode a portrait display transform into the movie's metadata.
    let rotation = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 48, ty: 0)
    let url = try await makeMovie(transform: rotation)
    let plan = try decodePlan(
      duration: 3_300_000,
      layers: [
        clip(2, start: 2_200_000, end: 2_900_000, sourceStart: 0, sourceEnd: 700_000),
        image(start: 1_000_000, end: 1_800_000),
        clip(0, start: 233_333, end: 1_600_000, sourceStart: 333_333, sourceEnd: 1_700_000),
        clip(
          1, start: 1_200_000, end: 2_200_000, sourceStart: 400_000, sourceEnd: 2_400_000, rate: 2),
      ],
      transitions: [
        [
          "id": "video/1", "trackId": "video", "z": 0, "type": "crossfade", "startUs": 1_200_000,
          "endUs": 1_600_000, "fromLayerId": "video/0", "toLayerId": "video/1",
        ]
      ])
    var loadedURIs: [String] = []
    let result = try await VideoCompositionBuilder.build(plan) { uri in
      loadedURIs.append(uri)
      return url
    }

    XCTAssertEqual(loadedURIs, ["fixture://clip.mov"])
    XCTAssertEqual(result.timelineDuration, time(3_300_000))
    XCTAssertEqual(result.composition.tracks.count, 2)
    let outgoing = try XCTUnwrap(result.clipsByLayerID["video/0"])
    let incoming = try XCTUnwrap(result.clipsByLayerID["video/1"])
    let following = try XCTUnwrap(result.clipsByLayerID["video/2"])
    XCTAssertNotEqual(outgoing.trackID, incoming.trackID)
    XCTAssertEqual(outgoing.trackID, following.trackID)
    XCTAssertEqual(outgoing.preferredTransform, rotation)
    XCTAssertNil(outgoing.holdTimeRange)
    XCTAssertEqual(outgoing.playableTimeRange, range(233_333, 1_600_000))
    XCTAssertEqual(incoming.playableTimeRange, range(1_200_000, 2_200_000))

    let laneA = try segments(result, trackID: outgoing.trackID)
    let laneB = try segments(result, trackID: incoming.trackID)
    XCTAssertEqual(laneA.map(\.source), [range(333_333, 1_700_000), range(0, 700_000)])
    XCTAssertEqual(laneA.map(\.target), [range(233_333, 1_600_000), range(2_200_000, 2_900_000)])
    XCTAssertEqual(laneB.map(\.source), [range(400_000, 2_400_000)])
    XCTAssertEqual(laneB.map(\.target), [range(1_200_000, 2_200_000)])
    let overlap = outgoing.playableTimeRange.intersection(incoming.playableTimeRange)
    XCTAssertEqual(overlap, range(plan.transitions[0].startUs, plan.transitions[0].endUs))

    let instructions = try result.makeVideoInstructions()
    XCTAssertEqual(
      instructions.map(\.timeRange),
      [
        range(0, 233_333), range(233_333, 1_000_000), range(1_000_000, 1_200_000),
        range(1_200_000, 1_600_000), range(1_600_000, 1_800_000), range(1_800_000, 2_200_000),
        range(2_200_000, 2_900_000), range(2_900_000, 3_300_000),
      ])
    XCTAssertEqual(
      instructions.map { $0.layers.map(\.timing.id) },
      [
        [], ["video/0"], ["video/0", "image/0"], ["video/0", "video/1", "image/0"],
        ["video/1", "image/0"], ["video/1"], ["video/2"], [],
      ])
    let transition = instructions[3]
    XCTAssertEqual(transition.transitions.map(\.id), ["video/1"])
    XCTAssertEqual(transition.transitions.first?.fromLayerId, "video/0")
    XCTAssertEqual(transition.transitions.first?.toLayerId, "video/1")
    XCTAssertEqual(
      transition.requiredSourceTrackIDs,
      [outgoing.trackID, incoming.trackID].sorted().map {
        NSNumber(value: $0)
      })
    XCTAssertEqual(transition.passthroughTrackID, kCMPersistentTrackID_Invalid)
    XCTAssertTrue(transition.containsTweening)
    XCTAssertTrue(instructions[4].transitions.isEmpty)
    XCTAssertFalse(instructions[4].containsTweening)
    XCTAssertEqual(instructions[6].requiredSourceTrackIDs, [NSNumber(value: following.trackID)])
    XCTAssertEqual(instructions[7].requiredSourceTrackIDs, [])
  }

  @MainActor
  func testLoopsFillTheLayerAndHoldTailsRemainAddressable() async throws {
    let url = try await makeMovie()
    let plan = try decodePlan(
      duration: 2_000_000,
      layers: [
        clip(
          0, start: 0, end: 1_000_000, sourceStart: 200_000, sourceEnd: 600_000, fitMode: "loop"),
        clip(
          1, start: 1_000_000, end: 2_000_000, sourceStart: 0, sourceEnd: 400_000, fitMode: "freeze"
        ),
      ])
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let loop = try XCTUnwrap(result.clipsByLayerID["video/0"])
    let hold = try XCTUnwrap(result.clipsByLayerID["video/1"])
    XCTAssertEqual(loop.trackID, hold.trackID)
    XCTAssertNil(loop.holdTimeRange)
    XCTAssertEqual(hold.playableTimeRange, range(1_000_000, 1_400_000))
    XCTAssertEqual(hold.holdTimeRange, range(1_400_000, 2_000_000))
    let media = try segments(result, trackID: loop.trackID)
    XCTAssertEqual(
      media.map(\.source),
      [
        range(200_000, 600_000), range(200_000, 600_000), range(200_000, 400_000),
        range(0, 400_000),
      ])
    XCTAssertEqual(
      media.map(\.target),
      [
        range(0, 400_000), range(400_000, 800_000), range(800_000, 1_000_000),
        range(1_000_000, 1_400_000),
      ])

    let instructions = try result.makeVideoInstructions()
    XCTAssertEqual(
      instructions.map(\.timeRange),
      [range(0, 1_000_000), range(1_000_000, 1_400_000), range(1_400_000, 2_000_000)])
    XCTAssertEqual(instructions[1].videoInputsByLayerID["video/1"]?.usesHeldFrame, false)
    let held = try XCTUnwrap(instructions[2].videoInputsByLayerID["video/1"])
    XCTAssertTrue(held.usesHeldFrame)
    XCTAssertEqual(held.clip.trackID, hold.trackID)
    XCTAssertEqual(held.clip.playableTimeRange, range(1_000_000, 1_400_000))
    XCTAssertEqual(instructions[2].requiredSourceTrackIDs, [])
  }

  @MainActor
  func testRejectsTrimOutsideSourceTrack() async throws {
    let url = try await makeMovie()
    let plan = try decodePlan(
      duration: 1_000_000,
      layers: [clip(0, start: 0, end: 1_000_000, sourceStart: 2_500_000, sourceEnd: 3_500_000)])
    do {
      _ = try await VideoCompositionBuilder.build(plan) { _ in url }
      XCTFail("Expected a source range error")
    } catch let error as VideoCompositionBuilder.BuildError {
      XCTAssertEqual(error, .sourceRangeOutsideTrack(layerID: "video/0"))
    }
  }

  @MainActor
  func testPlanWithoutVideoKeepsItsTimelineDuration() async throws {
    let plan = try decodePlan(
      duration: 1_000_000, layers: [image(start: 0, end: 800_000)],
      transitions: [
        [
          "id": "image/0", "trackId": "image", "z": 1, "type": "crossfade", "startUs": 0,
          "endUs": 300_000, "fromLayerId": NSNull(), "toLayerId": "image/0",
        ]
      ])
    let result = try await VideoCompositionBuilder.build(plan) { _ in
      XCTFail("No media should be loaded")
      throw TestError.unexpectedAsset
    }
    XCTAssertEqual(result.timelineDuration, time(1_000_000))
    XCTAssertTrue(result.clipsByLayerID.isEmpty)
    XCTAssertTrue(result.composition.tracks.isEmpty)
    let instructions = try result.makeVideoInstructions()
    XCTAssertEqual(
      instructions.map(\.timeRange),
      [range(0, 300_000), range(300_000, 800_000), range(800_000, 1_000_000)])
    XCTAssertEqual(instructions.map { $0.layers.map(\.timing.id) }, [["image/0"], ["image/0"], []])
    XCTAssertEqual(instructions[0].transitions.map(\.id), ["image/0"])
    XCTAssertNil(instructions[0].transitions.first?.fromLayerId)
    XCTAssertEqual(instructions[0].canvas.background, "#000000")
    XCTAssertTrue(instructions.allSatisfy { $0.requiredSourceTrackIDs == [] })
  }

  func testScheduleRejectsTransitionWithInactiveSource() throws {
    let plan = try decodePlan(
      duration: 2_000_000,
      layers: [image(start: 0, end: 1_000_000), image(1, start: 900_000, end: 2_000_000)],
      transitions: [
        [
          "id": "image/1", "trackId": "image", "z": 1, "type": "crossfade", "startUs": 900_000,
          "endUs": 1_100_000, "fromLayerId": "image/0", "toLayerId": "image/1",
        ]
      ])
    XCTAssertThrowsError(try StackReelVideoInstruction.schedule(plan, clipsByLayerID: [:])) {
      XCTAssertEqual(
        $0 as? StackReelVideoInstruction.ScheduleError, .invalidTransition(transitionID: "image/1"))
    }
  }

  func testSharedPlansHaveContiguousInstructions() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 {
      root.deleteLastPathComponent()
    }
    let directory = root.appendingPathComponent("fixtures/render-plans", isDirectory: true)
    let files = try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil
    )
    .filter { $0.lastPathComponent.hasSuffix(".renderplan.json") }
    XCTAssertFalse(files.isEmpty)
    for file in files {
      let plan = try JSONDecoder().decode(RenderPlan.self, from: Data(contentsOf: file))
      // Fixtures carry plan metadata. Assign one track per video without opening source media.
      var clips: [String: VideoComposition.Clip] = [:]
      for (index, layer) in plan.layers.enumerated() {
        guard case .video = layer.content else { continue }
        let timing = layer.timing
        clips[timing.id] = VideoComposition.Clip(
          trackID: CMPersistentTrackID(index + 1), preferredTransform: .identity,
          playableTimeRange: range(timing.startUs, timing.endUs), holdTimeRange: nil)
      }
      let instructions = try StackReelVideoInstruction.schedule(plan, clipsByLayerID: clips)
      var cursor = CMTime.zero
      for instruction in instructions {
        let interval = instruction.timeRange
        XCTAssertEqual(interval.start, cursor, plan.templateId)
        XCTAssertGreaterThan(interval.duration, .zero, plan.templateId)
        let activeIDs = plan.layers.filter {
          range($0.timing.startUs, $0.timing.endUs).containsTime(cursor)
        }.map(\.timing.id)
        XCTAssertEqual(Set(instruction.layers.map(\.timing.id)), Set(activeIDs), plan.templateId)
        cursor = interval.end
      }
      XCTAssertEqual(cursor, time(plan.durationUs), plan.templateId)
    }
  }

  private func segments(_ result: VideoComposition, trackID: CMPersistentTrackID) throws
    -> [CMTimeMapping]
  {
    let track = try XCTUnwrap(result.composition.tracks.first { $0.trackID == trackID })
    return track.segments.filter { !$0.isEmpty }.map(\.timeMapping)
  }

  private func clip(
    _ index: Int, start: Int64, end: Int64, sourceStart: Int64, sourceEnd: Int64,
    rate: Double = 1, fitMode: String = "trim"
  ) -> [String: Any] {
    [
      "id": "video/\(index)", "trackId": "video", "itemIndex": index, "z": 0, "startUs": start,
      "endUs": end, "opacity": 1, "kind": "video", "slotId": "clip",
      "source": [
        "assetUri": "fixture://clip.mov", "sourceStartUs": sourceStart, "sourceEndUs": sourceEnd,
        "rate": rate, "afterEnd": fitMode == "loop" ? "loop" : "hold", "fitMode": fitMode,
      ],
      "fit": "cover", "sourceSize": ["width": 32, "height": 48],
      "cropPx": ["x": 0, "y": 0, "width": 32, "height": 48],
      "transform": [1, 0, 0, 0, 1, 0, 0, 0, 1], "fadeInUs": 0, "fadeOutUs": 0, "gainDb": 0,
    ]
  }

  private func image(_ index: Int = 0, start: Int64, end: Int64) -> [String: Any] {
    [
      "id": "image/\(index)", "trackId": "image", "itemIndex": index, "z": 1, "startUs": start,
      "endUs": end, "opacity": 1, "kind": "image", "slotId": "still",
      "assetUri": "fixture://still.jpg", "fit": "cover",
      "sourceSize": ["width": 32, "height": 48],
      "cropPx": ["x": 0, "y": 0, "width": 32, "height": 48],
      "transform": [1, 0, 0, 0, 1, 0, 0, 0, 1], "fadeInUs": 0, "fadeOutUs": 0,
    ]
  }

  private func decodePlan(
    duration: Int64, layers: [[String: Any]], transitions: [[String: Any]] = []
  ) throws -> RenderPlan {
    let json: [String: Any] = [
      "renderPlanVersion": 1, "templateId": "composition-test", "durationUs": duration,
      "canvas": ["width": 32, "height": 48, "fps": 30, "background": "#000000"],
      "layers": layers, "transitions": transitions, "audio": [], "warnings": [],
    ]
    return try JSONDecoder().decode(
      RenderPlan.self, from: JSONSerialization.data(withJSONObject: json))
  }

  private func time(_ us: Int64) -> CMTime {
    CMTime(value: us, timescale: 1_000_000)
  }

  private func range(_ start: Int64, _ end: Int64) -> CMTimeRange {
    CMTimeRange(start: time(start), end: time(end))
  }

  private enum TestError: Error {
    case unexpectedAsset
    case cannotAllocateFrame(OSStatus)
    case cannotWriteMovie
    case writerTimedOut
  }

  @MainActor
  private func makeMovie(transform: CGAffineTransform = .identity) async throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    addTeardownBlock { try FileManager.default.removeItem(at: directory) }

    let url = directory.appendingPathComponent("clip.mov")
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    // Photo JPEG keeps the test independent of hardware H.264 encoding.
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.jpeg, AVVideoWidthKey: 32, AVVideoHeightKey: 48,
      ])
    input.transform = transform
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input)
    guard writer.canAdd(input) else { throw TestError.cannotWriteMovie }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? TestError.cannotWriteMovie }
    writer.startSession(atSourceTime: .zero)
    defer {
      if writer.status == .writing { writer.cancelWriting() }
    }

    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(nil, 32, 48, kCVPixelFormatType_32BGRA, nil, &buffer)
    guard status == kCVReturnSuccess, let buffer else {
      throw TestError.cannotAllocateFrame(status)
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    if let address = CVPixelBufferGetBaseAddress(buffer) {
      memset(address, 128, CVPixelBufferGetDataSize(buffer))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])

    for frame in 0..<90 {
      let deadline = DispatchTime.now() + .seconds(5)
      while !input.isReadyForMoreMediaData {
        guard writer.status == .writing else { throw writer.error ?? TestError.cannotWriteMovie }
        guard DispatchTime.now() < deadline else { throw TestError.writerTimedOut }
        try await Task.sleep(nanoseconds: 1_000_000)
      }
      guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30))
      else {
        throw writer.error ?? TestError.cannotWriteMovie
      }
    }
    writer.endSession(atSourceTime: CMTime(value: 3, timescale: 1))
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw writer.error ?? TestError.cannotWriteMovie }
    return url
  }
}
