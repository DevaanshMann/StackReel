// Older SDKs import loadTracks as nonisolated without annotating its AVAssetTrack results.
@preconcurrency import AVFoundation
import StackReelComposition
import StackReelPlan
import XCTest

final class MP4ExportTests: XCTestCase {
  @MainActor
  func testExportsCompositedH264WithoutAnAudioTrack() async throws {
    let directory = try makeDirectory()
    let result = try await makeComposition(in: directory)
    let destination = directory.appendingPathComponent("silent.mp4")
    let (updates, report) = AsyncStream<Double>.makeStream()
    try await result.exportMP4(to: destination) { report.yield($0) }
    report.finish()

    var fractions: [Double] = []
    for await fraction in updates { fractions.append(fraction) }
    XCTAssertEqual(fractions.first, 0)
    XCTAssertEqual(fractions.last, 1)
    XCTAssertTrue(fractions.contains { $0 > 0 && $0 < 1 })
    XCTAssertTrue(zip(fractions, fractions.dropFirst()).allSatisfy { $0 < $1 })

    let asset = open(destination)
    let audio = try await asset.loadTracks(withMediaType: .audio)
    XCTAssertTrue(audio.isEmpty)
    try await verifyVideo(in: asset)
    XCTAssertEqual(try contents(of: directory), ["source.mov", "silent.mp4"])
  }

  @MainActor
  func testExportsOneAACTrackWithBothSourcesAndTheirGain() async throws {
    let directory = try makeDirectory()
    let musicURL = try makeTestTone(frequency: 440)
    let voiceURL = try makeTestTone(frequency: 880, amplitude: 0.05)
    var music = audioEntry(
      "music", start: 0, end: 875_000, sourceEnd: 875_000, kind: "music")
    music["gainDb"] = -6
    var voice = audioEntry("voice", start: 250_000, end: 750_000, sourceEnd: 500_000)
    voice["gainDb"] = 6
    let result = try await makeComposition(
      in: directory, audio: [music, voice], sources: ["music": musicURL, "voice": voiceURL])
    let destination = directory.appendingPathComponent("mixed.mp4")
    try await result.exportMP4(to: destination)

    let asset = open(destination)
    try await verifyVideo(in: asset)
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    XCTAssertEqual(tracks.count, 1)
    let track = try XCTUnwrap(tracks.first)
    let (formats, range) = try await track.load(.formatDescriptions, .timeRange)
    let format = try XCTUnwrap(formats.first)
    XCTAssertEqual(CMFormatDescriptionGetMediaSubType(format), kAudioFormatMPEG4AAC)
    let stream = try XCTUnwrap(CMAudioFormatDescriptionGetStreamBasicDescription(format))
    XCTAssertEqual(stream.pointee.mChannelsPerFrame, 2)
    XCTAssertEqual(stream.pointee.mSampleRate, 48_000)
    XCTAssertEqual(range.start.seconds, 0, accuracy: 0.002)
    XCTAssertEqual(range.end.seconds, 0.875, accuracy: 0.022)

    let samples = try readAudio(track, in: asset)
    // Compare tone amplitudes in windows away from the AAC priming and mix boundaries.
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 0.5), 0.05, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 880, at: 0.5), 0.10, accuracy: 0.020)
    XCTAssertEqual(amplitude(samples, frequency: 880, at: 0.125), 0, accuracy: 0.005)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 0.8125), 0.05, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 880, at: 0.8125), 0, accuracy: 0.005)
    XCTAssertEqual(try contents(of: directory), ["source.mov", "mixed.mp4"])
  }

  @MainActor
  func testCancellationDuringEncodingRemovesTheStagedOutput() async throws {
    let directory = try makeDirectory()
    let result = try await makeComposition(in: directory)
    let destination = directory.appendingPathComponent("cancelled.mp4")
    let (encodingStarted, notify) = AsyncStream<Void>.makeStream()
    let resumeEncoding = DispatchSemaphore(value: 0)
    let task = Task {
      defer { notify.finish() }
      try await result.exportMP4(to: destination) { fraction in
        if fraction > 0 && fraction < 1 {
          notify.yield()
          _ = resumeEncoding.wait(timeout: .now() + .seconds(5))
        }
      }
    }
    for await _ in encodingStarted {
      task.cancel()
      resumeEncoding.signal()
      break
    }
    do {
      try await task.value
      XCTFail("Expected cancellation during encoding")
    } catch is CancellationError {
      XCTAssertEqual(try contents(of: directory), ["source.mov"])
    }
  }

  @MainActor
  func testPreservesDestinationPresentBeforeOrDuringEncoding() async throws {
    let directory = try makeDirectory()
    let result = try await makeComposition(in: directory)
    let destination = directory.appendingPathComponent("occupied.mp4")
    let existing = Data("existing destination".utf8)

    do {
      try await result.exportMP4(to: destination) { fraction in
        if fraction == 0 {
          do {
            try existing.write(to: destination, options: .withoutOverwriting)
          } catch {
            XCTFail("Could not create the competing destination: \(error)")
          }
        }
        XCTAssertLessThan(fraction, 1)
      }
      XCTFail("Expected the exclusive publication to fail")
    } catch let error as VideoComposition.ExportError {
      XCTAssertEqual(error, .destinationExists)
    }
    do {
      try await result.exportMP4(to: destination) { _ in
        XCTFail("An occupied destination should fail before encoding")
      }
      XCTFail("Expected an error for the occupied destination")
    } catch let error as VideoComposition.ExportError {
      XCTAssertEqual(error, .destinationExists)
    }
    XCTAssertEqual(try Data(contentsOf: destination), existing)
    XCTAssertEqual(try contents(of: directory), ["source.mov", "occupied.mp4"])
  }

  private func makeDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    addTeardownBlock { try FileManager.default.removeItem(at: directory) }
    return directory
  }

  private func contents(of directory: URL) throws -> Set<String> {
    try Set(FileManager.default.contentsOfDirectory(atPath: directory.path))
  }

  @MainActor
  private func makeComposition(
    in directory: URL, audio: [[String: Any]] = [], sources: [String: URL] = [:]
  ) async throws -> VideoComposition {
    let source = directory.appendingPathComponent("source.mov")
    try await writeWhiteMovie(to: source)
    let layer: [String: Any] = [
      "id": "video/0", "trackId": "video", "itemIndex": 0, "z": 0, "opacity": 1,
      "startUs": 0, "endUs": 500_000, "kind": "video", "slotId": "clip",
      "source": [
        "assetUri": "clip", "sourceStartUs": 0, "sourceEndUs": 500_000,
        "rate": 1, "afterEnd": "hold", "fitMode": "trim",
      ],
      "fit": "cover", "sourceSize": ["width": 64, "height": 64],
      "cropPx": ["x": 0, "y": 0, "width": 64, "height": 64],
      "transform": [1, 0, 32, 0, 1, 0, 0, 0, 1], "fadeInUs": 0, "fadeOutUs": 0, "gainDb": 0,
    ]
    let json: [String: Any] = [
      "renderPlanVersion": 1, "templateId": "export-test", "durationUs": 1_025_000,
      "canvas": ["width": 64, "height": 64, "fps": 24, "background": "#00FF00"],
      "layers": [layer], "transitions": [], "audio": audio, "warnings": [],
    ]
    let plan = try JSONDecoder().decode(
      RenderPlan.self, from: JSONSerialization.data(withJSONObject: json))
    return try await VideoCompositionBuilder.build(plan) { uri in
      try XCTUnwrap(uri == "clip" ? source : sources[uri])
    }
  }

  @MainActor
  private func writeWhiteMovie(to url: URL) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    #if os(iOS)
      let codec = AVVideoCodecType.h264
    #else
      let codec = AVVideoCodecType.jpeg
    #endif
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: codec, AVVideoWidthKey: 64, AVVideoHeightKey: 64,
      ])
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input)
    writer.add(input)
    guard writer.startWriting() else { throw try XCTUnwrap(writer.error) }
    defer { if writer.status == .writing { writer.cancelWriting() } }
    writer.startSession(atSourceTime: .zero)

    var buffer: CVPixelBuffer?
    XCTAssertEqual(CVPixelBufferCreate(nil, 64, 64, kCVPixelFormatType_32BGRA, nil, &buffer), noErr)
    let frame = try XCTUnwrap(buffer)
    CVPixelBufferLockBaseAddress(frame, [])
    if let address = CVPixelBufferGetBaseAddress(frame) {
      memset(address, 255, CVPixelBufferGetDataSize(frame))
    }
    CVPixelBufferUnlockBaseAddress(frame, [])
    for index in 0..<12 {
      let deadline = DispatchTime.now() + .seconds(5)
      while !input.isReadyForMoreMediaData {
        guard writer.status == .writing else { throw try XCTUnwrap(writer.error) }
        guard DispatchTime.now() < deadline else { throw FixtureError.writerTimedOut }
        try await Task.sleep(nanoseconds: 1_000_000)
      }
      guard adaptor.append(frame, withPresentationTime: CMTime(value: Int64(index), timescale: 24))
      else { throw try XCTUnwrap(writer.error) }
    }
    writer.endSession(atSourceTime: CMTime(value: 1, timescale: 2))
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw try XCTUnwrap(writer.error) }
  }

  private enum FixtureError: Error { case writerTimedOut }

  private func open(_ destination: URL) -> AVURLAsset {
    AVURLAsset(url: destination, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
  }

  @MainActor
  private func verifyVideo(in asset: AVURLAsset) async throws {
    let tracks = try await asset.loadTracks(withMediaType: .video)
    XCTAssertEqual(tracks.count, 1)
    let track = try XCTUnwrap(tracks.first)
    let (size, fps, formats, range) = try await track.load(
      .naturalSize, .nominalFrameRate, .formatDescriptions, .timeRange)
    XCTAssertEqual(size, CGSize(width: 64, height: 64))
    XCTAssertEqual(fps, 24, accuracy: 0.5)
    XCTAssertEqual(
      CMFormatDescriptionGetMediaSubType(try XCTUnwrap(formats.first)), kCMVideoCodecType_H264)
    XCTAssertEqual(range.start.seconds, 0, accuracy: 0.001)
    XCTAssertEqual(range.end.seconds, 1.025, accuracy: 0.002)

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(output)
    guard reader.startReading() else { throw try XCTUnwrap(reader.error) }
    var frames = 0
    while let sample = output.copyNextSampleBuffer() {
      if frames == 0 || frames == 23 {
        let frame = try XCTUnwrap(sample.imageBuffer)
        try assertPixel(in: frame, x: 16, near: [0, 255, 0])
        try assertPixel(in: frame, x: 48, near: frames == 0 ? [255, 255, 255] : [0, 255, 0])
      }
      frames += 1
    }
    XCTAssertEqual(reader.status, .completed, String(describing: reader.error))
    XCTAssertEqual(frames, 25)
  }

  private func assertPixel(in frame: CVPixelBuffer, x: Int, near expected: [Int]) throws {
    CVPixelBufferLockBaseAddress(frame, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(frame, .readOnly) }
    let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(frame)).assumingMemoryBound(to: UInt8.self)
    let pixel = base + 32 * CVPixelBufferGetBytesPerRow(frame) + 4 * x
    let rgb = [Int(pixel[2]), Int(pixel[1]), Int(pixel[0])]
    XCTAssertTrue(
      zip(rgb, expected).allSatisfy { abs($0 - $1) <= 25 }, "Got \(rgb), expected \(expected)")
  }

  private func readAudio(_ track: AVAssetTrack, in asset: AVURLAsset) throws -> [Float] {
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
      ])
    reader.add(output)
    guard reader.startReading() else { throw try XCTUnwrap(reader.error) }
    var leftChannel: [Float] = []
    while let sample = output.copyNextSampleBuffer() {
      let block = try XCTUnwrap(CMSampleBufferGetDataBuffer(sample))
      var stereo = [Float](repeating: 0, count: 2 * CMSampleBufferGetNumSamples(sample))
      let status = stereo.withUnsafeMutableBytes { bytes in
        CMBlockBufferCopyDataBytes(
          block, atOffset: 0, dataLength: bytes.count, destination: bytes.baseAddress!)
      }
      XCTAssertEqual(status, noErr)
      leftChannel += stride(from: 0, to: stereo.count, by: 2).map { stereo[$0] }
    }
    XCTAssertEqual(reader.status, .completed, String(describing: reader.error))
    return leftChannel
  }

  private func amplitude(_ samples: [Float], frequency: Double, at time: Double) -> Double {
    let center = Int(time * 48_000)
    let window = (center - 600)..<(center + 600)
    guard samples.indices.contains(window.lowerBound), window.upperBound <= samples.count
    else { return .nan }
    var real = 0.0
    var imaginary = 0.0
    for index in window {
      let phase = 2 * .pi * frequency * Double(index) / 48_000
      real += Double(samples[index]) * cos(phase)
      imaginary += Double(samples[index]) * sin(phase)
    }
    return 2 * hypot(real, imaginary) / Double(window.count)
  }
}
