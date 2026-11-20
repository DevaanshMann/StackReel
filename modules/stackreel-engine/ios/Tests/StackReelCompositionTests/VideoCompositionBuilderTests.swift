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
    XCTAssertThrowsError(try result.makeRenderComposition()) {
      XCTAssertEqual($0 as? VideoComposition.RenderError, .unsupportedHold(layerID: "video/1"))
    }
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
    XCTAssertThrowsError(try result.makeRenderComposition()) {
      XCTAssertEqual($0 as? VideoComposition.RenderError, .unsupportedLayer(layerID: "image/0"))
    }
  }

  @MainActor
  func testEmbeddedAudioAndTrailingMusicPreserveVideoOutput() async throws {
    let video = try await makeMovie { _, _ in (255, 0, 0) }
    let tone = try makeTestTone(frequency: 440)
    let source = AVMutableComposition()
    let videoAsset = AVURLAsset(url: video)
    let toneAsset = AVURLAsset(url: tone)
    let videoTrack = try XCTUnwrap(videoAsset.tracks(withMediaType: .video).first)
    let toneTrack = try XCTUnwrap(toneAsset.tracks(withMediaType: .audio).first)
    let picture = try XCTUnwrap(
      source.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid))
    let sound = try XCTUnwrap(
      source.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid))
    try picture.insertTimeRange(range(0, 1_500_000), of: videoTrack, at: .zero)
    try sound.insertTimeRange(range(0, 700_000), of: toneTrack, at: time(300_000))
    let embedded = video.deletingLastPathComponent().appendingPathComponent("with-audio.mov")
    let export = try XCTUnwrap(
      AVAssetExportSession(asset: source, presetName: AVAssetExportPresetPassthrough))
    export.outputURL = embedded
    export.outputFileType = .mov
    await withCheckedContinuation { continuation in
      export.exportAsynchronously { continuation.resume() }
    }
    XCTAssertEqual(export.status, .completed, String(describing: export.error))

    let embeddedURI = "fixture://embedded.mov"
    let silentURI = "fixture://silence.mov"
    let plan = try decodePlan(
      duration: 2_500_000,
      layers: [
        clip(
          0, start: 0, end: 1_500_000, sourceStart: 0, sourceEnd: 1_500_000, assetURI: embeddedURI),
        clip(
          1, start: 1_500_000, end: 1_800_000, sourceStart: 0, sourceEnd: 300_000,
          assetURI: silentURI),
      ],
      audio: [
        audioEntry(embeddedURI, start: 0, end: 1_500_000, sourceEnd: 1_500_000, kind: "video"),
        audioEntry(silentURI, start: 1_500_000, end: 1_800_000, sourceEnd: 300_000, kind: "video"),
        audioEntry("music", start: 200_000, end: 2_300_000, sourceEnd: 2_100_000, kind: "music"),
      ])
    let assets = [embeddedURI: embedded, silentURI: video, "music": tone]
    var resolved: [String] = []
    let result = try await VideoCompositionBuilder.build(plan) { uri in
      resolved.append(uri)
      return try XCTUnwrap(assets[uri])
    }
    XCTAssertEqual(resolved, [embeddedURI, silentURI, "music"])
    let render = try result.makeRenderComposition()
    let tracks = render.asset.tracks(withMediaType: .audio)
    XCTAssertEqual(tracks.count, 2)
    XCTAssertEqual(result.audioMix?.inputParameters.map(\.trackID), tracks.map(\.trackID).sorted())
    XCTAssertEqual(tracks.first?.segments.last?.timeMapping.target.end, time(1_000_000))
    XCTAssertEqual(render.asset.duration, time(2_500_000))
    let frames = try readFrames(render, at: [10, 60, 74])
    assertPixel(try pixel(frames[10]), near: [245, 0, 0])
    XCTAssertEqual(try pixel(frames[60]), [0, 0, 0])
    XCTAssertEqual(try pixel(frames[74]), [0, 0, 0])
  }

  @MainActor
  func testRendersCrossfadesAndTrailingBackgroundThroughAVFoundation() async throws {
    let red = try await makeMovie { _, _ in (255, 0, 0) }
    let blue = try await makeMovie { _, _ in (0, 0, 255) }
    var incoming = clip(
      1, start: 1_000_000, end: 2_500_000, sourceStart: 0, sourceEnd: 1_500_000,
      assetURI: "fixture://blue.mov")
    incoming["fadeOutUs"] = 500_000
    let plan = try decodePlan(
      duration: 3_000_000,
      layers: [
        clip(0, start: 200_000, end: 2_000_000, sourceStart: 200_000, sourceEnd: 2_000_000),
        incoming,
      ],
      transitions: [
        [
          "id": "video/0", "trackId": "video", "z": 0, "type": "crossfade", "startUs": 200_000,
          "endUs": 600_000, "fromLayerId": NSNull(), "toLayerId": "video/0",
        ],
        [
          "id": "video/1", "trackId": "video", "z": 0, "type": "crossfade", "startUs": 1_000_000,
          "endUs": 2_000_000, "fromLayerId": "video/0", "toLayerId": "video/1",
        ],
      ], background: "#00FF00")
    let result = try await VideoCompositionBuilder.build(plan) { uri in
      uri == "fixture://blue.mov" ? blue : red
    }
    let render = try result.makeRenderComposition()
    XCTAssertEqual(render.asset.duration, result.timelineDuration)
    let frames = try readFrames(render, at: Set(0..<90))
    XCTAssertEqual(render.videoComposition.frameDuration, CMTime(value: 1, timescale: 30))
    XCTAssertEqual(render.videoComposition.renderSize, CGSize(width: 32, height: 48))
    let green = try pixel(frames[0])
    let beforeCrossfade = try pixel(frames[24])
    let afterCrossfade = try pixel(frames[60])
    XCTAssertEqual(green, [0, 255, 0])
    XCTAssertEqual(try pixel(frames[6]), green)
    assertPixel(beforeCrossfade, near: [245, 0, 0])
    assertPixel(afterCrossfade, near: [0, 0, 245])
    assertPixel(try pixel(frames[12]), near: blend(green, beforeCrossfade, progress: 0.5))
    assertPixel(try pixel(frames[45]), near: blend(beforeCrossfade, afterCrossfade, progress: 0.5))
    assertPixel(try pixel(frames[68]), near: blend(afterCrossfade, green, progress: 8.0 / 15))
    XCTAssertEqual(try pixel(frames[81]), green)
  }

  @MainActor
  func testRendersSlidesInAllDirectionsThroughAVFoundation() async throws {
    let red = try await makeMovie { _, _ in (255, 0, 0) }
    let blue = try await makeMovie { _, _ in (0, 0, 255) }
    let outgoing = clip(0, start: 0, end: 2_000_000, sourceStart: 0, sourceEnd: 2_000_000)
    let incoming = clip(
      1, start: 1_000_000, end: 2_500_000, sourceStart: 0, sourceEnd: 1_500_000,
      assetURI: "fixture://blue.mov")
    // Sample opposite corners to catch both an inverted direction and translation on the wrong axis.
    let cases: [(direction: String, redCorners: [Bool], seam: [(Int, Int)])] = [
      ("left", [true, false, true, false], [(25, 24), (26, 24)]),
      ("right", [false, true, false, true], [(6, 24), (5, 24)]),
      ("up", [true, true, false, false], [(16, 37), (16, 38)]),
      ("down", [false, false, true, true], [(16, 10), (16, 9)]),
    ]
    let corners = [(4, 6), (28, 6), (4, 42), (28, 42)]
    for (direction, redCorners, seam) in cases {
      let plan = try decodePlan(
        duration: 2_500_000, layers: [outgoing, incoming],
        transitions: [
          [
            "id": "video/1", "trackId": "video", "z": 0, "type": "slide", "direction": direction,
            "startUs": 1_000_000, "endUs": 2_000_000, "fromLayerId": "video/0",
            "toLayerId": "video/1",
          ]
        ])
      let composition = try await VideoCompositionBuilder.build(plan) { uri in
        uri == "fixture://blue.mov" ? blue : red
      }
      let frames = try readFrames(
        composition.makeRenderComposition(), at: [29, 30, 36, 45, 54, 60])
      let redPixel = try pixel(frames[29])
      let bluePixel = try pixel(frames[60])
      assertPixel(redPixel, near: [245, 0, 0])
      assertPixel(bluePixel, near: [0, 0, 245])
      XCTAssertEqual(try pixel(frames[30]), redPixel, direction)
      assertPixel(try pixel(frames[36]), near: redPixel)
      assertPixel(try pixel(frames[54]), near: bluePixel)
      for ((x, y), isRed) in zip(corners, redCorners) {
        XCTAssertEqual(
          try pixel(frames[45], x: x, y: y), isRed ? redPixel : bluePixel, direction)
      }
      // A fractional step (20% progress) rounds the shared edge to one pixel.
      for ((x, y), expected) in zip(seam, [redPixel, bluePixel]) {
        XCTAssertEqual(try pixel(frames[36], x: x, y: y), expected, direction)
      }
    }
  }

  @MainActor
  func testSlideFromBackgroundDefaultsLeftAndKeepsOtherTracksFixed() async throws {
    let red = try await makeMovie { _, _ in (255, 0, 0) }
    let green = try await makeMovie { _, _ in (0, 255, 0) }
    let blue = try await makeMovie { _, _ in (0, 0, 255) }
    var underlay = clip(
      0, start: 0, end: 2_000_000, sourceStart: 0, sourceEnd: 2_000_000,
      assetURI: "fixture://green.mov")
    underlay["id"] = "underlay/0"
    underlay["trackId"] = "underlay"
    var incoming = clip(0, start: 500_000, end: 2_000_000, sourceStart: 0, sourceEnd: 1_500_000)
    incoming["z"] = 1
    // The projected image extends beyond both canvas edges before it slides.
    incoming["transform"] = [2, 0, -16, 0, 1, 0, 0, 0, 1]
    var overlay = clip(
      0, start: 0, end: 2_000_000, sourceStart: 0, sourceEnd: 2_000_000,
      assetURI: "fixture://blue.mov")
    overlay["id"] = "overlay/0"
    overlay["trackId"] = "overlay"
    overlay["z"] = 2
    overlay["cropPx"] = ["x": 8, "y": 8, "width": 8, "height": 8]
    let plan = try decodePlan(
      duration: 2_000_000, layers: [underlay, incoming, overlay],
      transitions: [
        [
          "id": "video/0", "trackId": "video", "z": 1, "type": "slide", "startUs": 500_000,
          "endUs": 1_500_000, "fromLayerId": NSNull(), "toLayerId": "video/0",
        ]
      ])
    let assets = [
      "fixture://clip.mov": red, "fixture://green.mov": green, "fixture://blue.mov": blue,
    ]
    let composition = try await VideoCompositionBuilder.build(plan) { uri in
      try XCTUnwrap(assets[uri])
    }
    let frames = try readFrames(composition.makeRenderComposition(), at: [14, 15, 30, 45])
    let greenPixel = try pixel(frames[14], x: 24)
    let bluePixel = try pixel(frames[14], x: 12, y: 12)
    let redPixel = try pixel(frames[45], x: 24)
    XCTAssertGreaterThan(greenPixel[1], 235)
    XCTAssertLessThan(max(greenPixel[0], greenPixel[2]), 40)
    assertPixel(bluePixel, near: [0, 0, 245])
    assertPixel(redPixel, near: [245, 0, 0])
    XCTAssertEqual(try pixel(frames[15], x: 24), greenPixel)
    XCTAssertEqual(try pixel(frames[30], x: 8), greenPixel)
    assertPixel(try pixel(frames[30], x: 24), near: redPixel)
    for index in [15, 30, 45] {
      XCTAssertEqual(try pixel(frames[index], x: 12, y: 12), bluePixel)
    }
  }

  @MainActor
  func testRendersStyledTextDuringItsTimelineInterval() async throws {
    let url = try await makeMovie { _, _ in (0, 0, 255) }
    var video = clip(0, start: 0, end: 2_000_000, sourceStart: 0, sourceEnd: 2_000_000)
    video["transform"] = [5, 0, 0, 0, 5, 0, 0, 0, 1]
    var foreground = clip(0, start: 0, end: 2_000_000, sourceStart: 0, sourceEnd: 2_000_000)
    foreground["id"] = "foreground/0"
    foreground["trackId"] = "foreground"
    foreground["z"] = 2
    foreground["cropPx"] = ["x": 0, "y": 0, "width": 20, "height": 18]
    foreground["transform"] = [1, 0, 85, 0, 1, 126, 0, 0, 1]
    var overlay = textLayer(0, start: 400_000, end: 2_400_000, x: 12, y: 72)
    overlay["style"] = [
      "font": "Inter-Bold", "sizePx": 25, "color": "#FFFFFF", "align": "center",
      "stroke": ["color": "#FF9900", "widthPx": 2],
      "shadow": ["color": "#FF00FF", "blurPx": 0, "offsetXPx": 4, "offsetYPx": 4],
      "background": ["color": "#007030", "paddingPx": 12, "cornerRadiusPx": 9],
    ]
    overlay["animation"] = [
      "in": "fade", "out": "fade", "inDurationUs": 400_000, "outDurationUs": 400_000,
    ]
    let plan = try decodePlan(
      duration: 2_600_000, layers: [video, foreground, overlay],
      canvas: CGSize(width: 160, height: 240))
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let render = try result.makeRenderComposition()
    let frames = try readFrames(render, at: [9, 12, 18, 24, 63, 75])
    let blue = try pixel(frames[9], x: 19, y: 86)
    let pill = try pixel(frames[24], x: 19, y: 86)
    assertPixel(blue, near: [0, 0, 245])
    assertPixel(pill, near: [0, 112, 48])
    XCTAssertEqual(try pixel(frames[12], x: 19, y: 86), blue)
    assertPixel(try pixel(frames[18], x: 19, y: 86), near: blend(blue, pill, progress: 0.5))
    XCTAssertEqual(try pixel(frames[24], x: 12, y: 72), blue)
    XCTAssertEqual(try pixel(frames[24], x: 90, y: 131), blue)
    XCTAssertGreaterThan(try pixel(frames[63], x: 19, y: 86)[1], 40)
    XCTAssertEqual(try pixel(frames[75], x: 19, y: 86), [0, 0, 0])

    var sawFill = false
    var sawOutline = false
    var sawShadow = false
    for y in 85..<146 {
      for x in 22..<110 {
        let rgb = try pixel(frames[24], x: x, y: y)
        sawFill = sawFill || rgb.allSatisfy { $0 > 235 }
        sawOutline = sawOutline || (rgb[0] > 235 && rgb[1] > 100 && rgb[2] < 35)
        sawShadow = sawShadow || (rgb[0] > 235 && rgb[1] < 35 && rgb[2] > 235)
      }
    }
    XCTAssertTrue(sawFill)
    XCTAssertTrue(sawOutline)
    XCTAssertTrue(sawShadow)
  }

  @MainActor
  func testTypewriterRevealsGraphemesAndReversesWithoutMovingTheLayout() async throws {
    let url = try await makeMovie { _, _ in (0, 0, 0) }
    var video = clip(0, start: 0, end: 2_400_000, sourceStart: 0, sourceEnd: 2_400_000)
    video["transform"] = [5, 0, 0, 0, 5, 0, 0, 0, 1]
    var overlay = textLayer(0, start: 200_000, end: 2_400_000, x: 20, y: 20)
    overlay["text"] = "A👩🏽‍🚀\r\nZ"
    overlay["style"] = [
      "font": "Helvetica-Bold", "sizePx": 28, "color": "#FFFFFF", "align": "center",
      "stroke": ["color": "#00FF00", "widthPx": 1],
      "shadow": ["color": "#0000FF", "blurPx": 0, "offsetXPx": 2, "offsetYPx": 2],
      "background": ["color": "#C00000", "paddingPx": 10, "cornerRadiusPx": 8],
    ]
    overlay["animation"] = [
      "in": "typewriter", "out": "typewriter", "inDurationUs": 800_000, "outDurationUs": 800_000,
    ]
    let plan = try decodePlan(
      duration: 2_600_000, layers: [video, overlay], canvas: CGSize(width: 160, height: 240))
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let render = try result.makeRenderComposition()
    let frames = try readFrames(render, at: [5, 6, 14, 17, 20, 26, 35, 58, 64, 71, 72])
    let pill = try pixel(frames[6], x: 27, y: 28)
    assertPixel(pill, near: [192, 0, 0])
    for frame in [14, 17, 20, 26, 35, 58, 64, 71] {
      XCTAssertEqual(try pixel(frames[frame], x: 27, y: 28), pill)
    }
    for frame in [5, 72] {
      XCTAssertEqual(try pixel(frames[frame], x: 27, y: 28), [0, 0, 0])
    }

    func visiblePixels(_ frame: Int) throws -> Set<Int> {
      var pixels: Set<Int> = []
      for y in 20..<100 {
        for x in 20..<100 {
          if try pixel(frames[frame], x: x, y: y) != pixel(frames[6], x: x, y: y) {
            pixels.insert(y * 160 + x)
          }
        }
      }
      return pixels
    }

    let firstLetter = try visiblePixels(14)
    let firstLine = try visiblePixels(20)
    let fullText = try visiblePixels(35)
    XCTAssertFalse(firstLetter.isEmpty)
    XCTAssertTrue(firstLetter.isStrictSubset(of: firstLine))
    XCTAssertTrue(firstLine.isStrictSubset(of: fullText))
    XCTAssertEqual(try visiblePixels(17), firstLetter)
    XCTAssertEqual(try visiblePixels(26), firstLine)
    XCTAssertEqual(try visiblePixels(58), firstLine)
    XCTAssertEqual(try visiblePixels(64), firstLetter)
    XCTAssertTrue(try visiblePixels(71).isEmpty)
  }

  @MainActor
  func testReusesTextTextureAcrossPlacementsAndRotatesAboutAnchor() async throws {
    let url = try await makeMovie { _, _ in (0, 0, 0) }
    var video = clip(0, start: 0, end: 1_200_000, sourceStart: 0, sourceEnd: 1_200_000)
    video["transform"] = [5, 0, 0, 0, 5, 0, 0, 0, 1]
    let rotated = textLayer(0, start: 0, end: 2_000_000, x: 95, y: 20, rotation: 90)
    var sliding = textLayer(1, start: 0, end: 2_000_000, x: 60, y: 132)
    sliding["animation"] = [
      "in": "slide-right", "out": "none", "inDurationUs": 1_000_000, "outDurationUs": 0,
    ]
    let plan = try decodePlan(
      duration: 2_000_000, layers: [video, rotated, sliding],
      canvas: CGSize(width: 160, height: 240))
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let render = try result.makeRenderComposition()
    let instruction = try XCTUnwrap(
      render.videoComposition.instructions.first as? StackReelVideoInstruction)
    let first = try XCTUnwrap(instruction.textTexturesByLayerID["titles/0"])
    let second = try XCTUnwrap(instruction.textTexturesByLayerID["titles/1"])
    XCTAssertTrue(first.image === second.image)
    let frames = try readFrames(render, at: [15, 30, 59])
    XCTAssertEqual(try pixel(frames[30], x: 90, y: 26), [255, 0, 0])
    XCTAssertEqual(try pixel(frames[30], x: 100, y: 26), [0, 0, 0])
    XCTAssertEqual(try pixel(frames[15], x: 55, y: 137), [255, 0, 0])
    XCTAssertEqual(try pixel(frames[30], x: 55, y: 137), [0, 0, 0])
    XCTAssertEqual(try pixel(frames[30], x: 65, y: 137), [255, 0, 0])
    XCTAssertEqual(try pixel(frames[59], x: 65, y: 137), [255, 0, 0])
  }

  @MainActor
  func testRendersPortraitCropAndCanvasTransformThroughAVFoundation() async throws {
    let rotation = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 48, ty: 0)
    let url = try await makeMovie(transform: rotation) { x, y in
      if y < 24 { return (0, 255, 0) }
      return x < 16 ? (255, 0, 0) : (0, 0, 255)
    }
    var layer = clip(0, start: 0, end: 1_000_000, sourceStart: 0, sourceEnd: 1_000_000)
    layer["sourceSize"] = ["width": 48, "height": 32]
    layer["cropPx"] = ["x": 4, "y": 0, "width": 20, "height": 32]
    layer["transform"] = [1, 0, 2, 0, 1, 8, 0, 0, 1]
    let plan = try decodePlan(duration: 1_000_000, layers: [layer])
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let frames = try readFrames(result.makeRenderComposition(), at: [15])
    assertPixel(try pixel(frames[15], x: 14, y: 13), near: [245, 0, 0])
    assertPixel(try pixel(frames[15], x: 14, y: 29), near: [0, 0, 245])
    XCTAssertEqual(try pixel(frames[15], x: 28, y: 19), [0, 0, 0])
    XCTAssertEqual(try pixel(frames[15], x: 14, y: 4), [0, 0, 0])
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
    rate: Double = 1, fitMode: String = "trim", assetURI: String = "fixture://clip.mov"
  ) -> [String: Any] {
    [
      "id": "video/\(index)", "trackId": "video", "itemIndex": index, "z": 0, "startUs": start,
      "endUs": end, "opacity": 1, "kind": "video", "slotId": "clip",
      "source": [
        "assetUri": assetURI, "sourceStartUs": sourceStart, "sourceEndUs": sourceEnd,
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
    duration: Int64, layers: [[String: Any]], transitions: [[String: Any]] = [],
    background: String = "#000000", audio: [[String: Any]] = [],
    canvas: CGSize = CGSize(width: 32, height: 48)
  ) throws -> RenderPlan {
    let json: [String: Any] = [
      "renderPlanVersion": 1, "templateId": "composition-test", "durationUs": duration,
      "canvas": [
        "width": Int(canvas.width), "height": Int(canvas.height), "fps": 30,
        "background": background,
      ],
      "layers": layers, "transitions": transitions, "audio": audio, "warnings": [],
    ]
    return try JSONDecoder().decode(
      RenderPlan.self, from: JSONSerialization.data(withJSONObject: json))
  }

  private func textLayer(
    _ index: Int, start: Int64, end: Int64, x: Int, y: Int, rotation: Int = 0
  ) -> [String: Any] {
    [
      "id": "titles/\(index)", "trackId": "titles", "itemIndex": index, "z": 1, "startUs": start,
      "endUs": end, "opacity": 1, "kind": "text", "text": "STACK\nREEL",
      "style": [
        "font": "Helvetica-Bold", "sizePx": 20, "color": "#FFFFFF", "align": "center",
        "background": ["color": "#FF0000", "paddingPx": 10, "cornerRadiusPx": 0],
      ],
      "placement": ["xPx": x, "yPx": y, "rotationDeg": rotation, "anchor": "top-left"],
      "animation": ["in": "none", "out": "none", "inDurationUs": 0, "outDurationUs": 0],
    ]
  }

  private func time(_ us: Int64) -> CMTime {
    CMTime(value: us, timescale: 1_000_000)
  }

  private func range(_ start: Int64, _ end: Int64) -> CMTimeRange {
    CMTimeRange(start: time(start), end: time(end))
  }

  private enum TestError: Error {
    case unexpectedAsset
    case cannotReadComposition
  }

  private func readFrames(
    _ render: (asset: AVComposition, videoComposition: AVVideoComposition),
    at frameNumbers: Set<Int>
  ) throws -> [Int: CVPixelBuffer] {
    let reader = try AVAssetReader(asset: render.asset)
    let output = AVAssetReaderVideoCompositionOutput(
      videoTracks: render.asset.tracks(withMediaType: .video),
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.videoComposition = render.videoComposition
    guard reader.canAdd(output) else { throw TestError.cannotReadComposition }
    reader.add(output)
    guard reader.startReading() else { throw reader.error ?? TestError.cannotReadComposition }

    var frames: [Int: CVPixelBuffer] = [:]
    while let sample = output.copyNextSampleBuffer() {
      let frameNumber = Int(
        sample.presentationTimeStamp.convertScale(30, method: .roundHalfAwayFromZero).value)
      if frameNumbers.contains(frameNumber) { frames[frameNumber] = sample.imageBuffer }
    }
    guard reader.status == .completed else { throw reader.error ?? TestError.cannotReadComposition }
    XCTAssertEqual(Set(frames.keys), frameNumbers)
    return frames
  }

  private func pixel(_ frame: CVPixelBuffer?, x: Int = 16, y: Int = 24) throws -> [Int] {
    let frame = try XCTUnwrap(frame)
    CVPixelBufferLockBaseAddress(frame, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(frame, .readOnly) }
    let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(frame)).assumingMemoryBound(to: UInt8.self)
    let pixel = base + y * CVPixelBufferGetBytesPerRow(frame) + 4 * x
    return [Int(pixel[2]), Int(pixel[1]), Int(pixel[0])]
  }

  private func assertPixel(
    _ pixel: [Int], near expected: [Int], file: StaticString = #filePath, line: UInt = #line
  ) {
    // The source frames are compressed, so allow a small RGB-channel tolerance.
    XCTAssertTrue(
      zip(pixel, expected).allSatisfy { abs($0 - $1) <= 15 },
      "Expected \(expected), got \(pixel)", file: file, line: line)
  }

  private func blend(_ from: [Int], _ to: [Int], progress: Double) -> [Int] {
    func linear(_ byte: Int) -> Double {
      let value = Double(byte) / 255
      return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return zip(from, to).map { start, end in
      let value = linear(start) * (1 - progress) + linear(end) * progress
      let sRGB = value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1 / 2.4) - 0.055
      return Int((sRGB * 255).rounded())
    }
  }
}

extension XCTestCase {
  private enum MovieFixtureError: Error {
    case cannotAllocateFrame(OSStatus)
    case cannotWriteMovie
    case writerTimedOut
  }

  @MainActor
  func makeMovie(
    transform: CGAffineTransform = .identity,
    pixel: (Int, Int) -> (red: UInt8, green: UInt8, blue: UInt8) = { _, _ in (128, 128, 128) }
  ) async throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    addTeardownBlock { try FileManager.default.removeItem(at: directory) }

    let url = directory.appendingPathComponent("clip.mov")
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    #if os(iOS)
      let codec = AVVideoCodecType.h264
    #else
      // Photo JPEG keeps macOS tests independent of hardware H.264 encoding.
      let codec = AVVideoCodecType.jpeg
    #endif
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: codec, AVVideoWidthKey: 32, AVVideoHeightKey: 48,
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
      ])
    input.transform = transform
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input)
    guard writer.canAdd(input) else { throw MovieFixtureError.cannotWriteMovie }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? MovieFixtureError.cannotWriteMovie }
    writer.startSession(atSourceTime: .zero)
    defer {
      if writer.status == .writing { writer.cancelWriting() }
    }

    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(nil, 32, 48, kCVPixelFormatType_32BGRA, nil, &buffer)
    guard status == kCVReturnSuccess, let buffer else {
      throw MovieFixtureError.cannotAllocateFrame(status)
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    if let address = CVPixelBufferGetBaseAddress(buffer) {
      let base = address.assumingMemoryBound(to: UInt8.self)
      for y in 0..<CVPixelBufferGetHeight(buffer) {
        let row = base + y * CVPixelBufferGetBytesPerRow(buffer)
        for x in 0..<CVPixelBufferGetWidth(buffer) {
          let color = pixel(x, y)
          row[4 * x] = color.blue
          row[4 * x + 1] = color.green
          row[4 * x + 2] = color.red
          row[4 * x + 3] = 255
        }
      }
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])

    for frame in 0..<90 {
      let deadline = DispatchTime.now() + .seconds(5)
      while !input.isReadyForMoreMediaData {
        guard writer.status == .writing else {
          throw writer.error ?? MovieFixtureError.cannotWriteMovie
        }
        guard DispatchTime.now() < deadline else { throw MovieFixtureError.writerTimedOut }
        try await Task.sleep(nanoseconds: 1_000_000)
      }
      guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30))
      else {
        throw writer.error ?? MovieFixtureError.cannotWriteMovie
      }
    }
    writer.endSession(atSourceTime: CMTime(value: 3, timescale: 1))
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else {
      throw writer.error ?? MovieFixtureError.cannotWriteMovie
    }
    return url
  }
}
