import AVFoundation
import StackReelPlan
import XCTest

@testable import StackReelComposition

final class AudioCompositionTests: XCTestCase {
  @MainActor
  func testReadbackIncludesBoostFadesAndDucking() async throws {
    let musicURL = try makeTestTone(frequency: 440)
    let voiceURL = try makeTestTone(frequency: 880, amplitude: 0.05)
    var music = audioEntry("music", start: 0, end: 3_000_000, sourceEnd: 3_000_000, kind: "music")
    music["gainDb"] = 6
    music["fadeInUs"] = 500_000
    music["fadeOutUs"] = 500_000
    music["ducking"] = [
      "gainDb": -12, "rampUs": 400_000,
      "regions": [["startUs": 1_000_000, "endUs": 2_000_000]],
    ]
    var voice = audioEntry("voice", start: 1_000_000, end: 2_000_000, sourceEnd: 1_000_000)
    voice["gainDb"] = -6
    let plan = try decodeAudioPlan([music, voice], duration: 3_000_000)
    let result = try await VideoCompositionBuilder.build(plan) { uri in
      uri == "music" ? musicURL : voiceURL
    }
    let samples = try readAudio(result)
    XCTAssertEqual(samples.count, 3 * 48_000)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 0.25), 0.10, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 0.75), 0.20, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 1.00), 0.125, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 1.50), 0.05, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 880, at: 1.50), 0.025, accuracy: 0.006)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 2.00), 0.125, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 440, at: 2.75), 0.10, accuracy: 0.012)
    XCTAssertEqual(amplitude(samples, frequency: 880, at: 2.75), 0, accuracy: 0.005)
  }

  @MainActor
  func testMutedEntriesDoNotResolveMedia() async throws {
    var muted = audioEntry("muted", start: 0, end: 500_000, sourceEnd: 500_000)
    muted["gainDb"] = -60
    let plan = try decodeAudioPlan([muted], duration: 1_000_000)
    let result = try await VideoCompositionBuilder.build(plan) { _ in
      XCTFail("Muted entries should not resolve media")
      return URL(fileURLWithPath: "/dev/null")
    }
    XCTAssertTrue(result.composition.tracks.isEmpty)
    XCTAssertNil(result.audioMix)
  }

  @MainActor
  func testAudioTrimRateLoopAndHoldEdits() async throws {
    let url = try makeTestTone(frequency: 440)
    let loop = audioEntry(
      "music", start: 200_000, end: 2_700_000, sourceStart: 250_000, sourceEnd: 750_000,
      rate: 0.5, kind: "music", loop: true)
    let hold = audioEntry("voice", start: 700_000, end: 1_500_000, sourceEnd: 400_000)
    let following = audioEntry("voice-again", start: 1_600_000, end: 1_700_000, sourceEnd: 100_000)
    let plan = try decodeAudioPlan([following, hold, loop], duration: 3_000_000)
    let result = try await VideoCompositionBuilder.build(plan) { _ in url }
    let tracks = result.composition.tracks(withMediaType: .audio)
    XCTAssertEqual(tracks.count, 2)
    XCTAssertEqual(result.audioMix?.inputParameters.map(\.trackID), tracks.map(\.trackID).sorted())
    let musicEdits = tracks[0].segments.filter { !$0.isEmpty }.map(\.timeMapping)
    XCTAssertEqual(
      musicEdits.map(\.source),
      [range(250_000, 750_000), range(250_000, 750_000), range(250_000, 500_000)])
    XCTAssertEqual(
      musicEdits.map(\.target),
      [range(200_000, 1_200_000), range(1_200_000, 2_200_000), range(2_200_000, 2_700_000)])
    let voiceEdits = tracks[1].segments.filter { !$0.isEmpty }.map(\.timeMapping)
    XCTAssertEqual(voiceEdits.map(\.source), [range(0, 400_000), range(0, 100_000)])
    XCTAssertEqual(
      voiceEdits.map(\.target), [range(700_000, 1_100_000), range(1_600_000, 1_700_000)])
  }

  private func decodeAudioPlan(_ audio: [[String: Any]], duration: Int64) throws -> RenderPlan {
    let json: [String: Any] = [
      "renderPlanVersion": 1, "templateId": "audio-test", "durationUs": duration,
      "canvas": ["width": 32, "height": 48, "fps": 30, "background": "#000000"],
      "layers": [], "transitions": [], "audio": audio, "warnings": [],
    ]
    return try JSONDecoder().decode(
      RenderPlan.self, from: JSONSerialization.data(withJSONObject: json))
  }

  private func range(_ start: Int64, _ end: Int64) -> CMTimeRange {
    CMTimeRange(
      start: CMTime(value: start, timescale: 1_000_000),
      end: CMTime(value: end, timescale: 1_000_000))
  }

  private func readAudio(_ result: VideoComposition) throws -> [Float] {
    let reader = try AVAssetReader(asset: result.composition)
    let output = AVAssetReaderAudioMixOutput(
      audioTracks: result.composition.tracks(withMediaType: .audio),
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1,
      ])
    output.audioMix = result.audioMix
    reader.add(output)
    guard reader.startReading() else { throw try XCTUnwrap(reader.error) }
    var samples: [Float] = []
    while let sample = output.copyNextSampleBuffer() {
      let block = try XCTUnwrap(CMSampleBufferGetDataBuffer(sample))
      var pcm = [Float](repeating: 0, count: CMSampleBufferGetNumSamples(sample))
      let status = pcm.withUnsafeMutableBytes { bytes in
        CMBlockBufferCopyDataBytes(
          block, atOffset: 0, dataLength: bytes.count, destination: bytes.baseAddress!)
      }
      XCTAssertEqual(status, noErr)
      samples += pcm
    }
    XCTAssertEqual(reader.status, .completed)
    return samples
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

func audioEntry(
  _ uri: String, start: Int64, end: Int64, sourceStart: Int64 = 0, sourceEnd: Int64,
  rate: Double = 1, kind: String = "audio", loop: Bool = false
) -> [String: Any] {
  [
    "id": uri, "kind": kind, "slotId": uri, "startUs": start, "endUs": end,
    "gainDb": 0, "fadeInUs": 0, "fadeOutUs": 0,
    "source": [
      "assetUri": uri, "sourceStartUs": sourceStart, "sourceEndUs": sourceEnd, "rate": rate,
      "afterEnd": loop ? "loop" : "hold", "fitMode": loop ? "loop" : "trim",
    ],
  ]
}

extension XCTestCase {
  func makeTestTone(frequency: Double, amplitude: Double = 0.1) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID()).caf")
    let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
    let file = try AVAudioFile(forWriting: url, settings: format.settings)
    let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 144_000))
    buffer.frameLength = buffer.frameCapacity
    let channel = try XCTUnwrap(buffer.floatChannelData)[0]
    for index in 0..<Int(buffer.frameLength) {
      channel[index] = Float(amplitude * sin(2 * .pi * frequency * Double(index) / 48_000))
    }
    try file.write(from: buffer)
    addTeardownBlock { try FileManager.default.removeItem(at: url) }
    return url
  }
}
