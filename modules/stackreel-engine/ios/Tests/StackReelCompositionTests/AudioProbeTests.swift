import AVFoundation
import XCTest

@testable import StackReelExpoSupport

final class AudioProbeTests: XCTestCase {
  @MainActor
  func testProbeAudioReadsLocalAudioFile() async throws {
    let url = try makeTestTone(frequency: 440)
    let metadata = try await AudioProbe.metadata(for: url)
    XCTAssertEqual(metadata, ["startUs": 0, "durationUs": 3_000_000])
  }

  @MainActor
  func testProbeAudioRejectsVideoWithoutAudio() async throws {
    let url = try await makeMovie()
    do {
      _ = try await AudioProbe.metadata(for: url)
      XCTFail("Expected the video-only file to be rejected")
    } catch AudioProbe.ProbeError.missingTrack {}
  }

  func testAudioMetadataRoundsNonzeroStartUpAndEndDown() throws {
    let range = CMTimeRange(
      start: CMTime(value: 5, timescale: 48_000), duration: CMTime(value: 20, timescale: 48_000))
    XCTAssertEqual(try AudioProbe.metadata(for: range), ["startUs": 105, "durationUs": 415])
  }

  func testAudioMetadataClampsNegativeStartToZero() throws {
    let range = CMTimeRange(
      start: CMTime(value: -5, timescale: 48_000), duration: CMTime(value: 30, timescale: 48_000))
    XCTAssertEqual(try AudioProbe.metadata(for: range), ["startUs": 0, "durationUs": 520])
  }

  func testAudioMetadataRejectsUnusableRanges() {
    let ranges: [CMTimeRange] = [
      .invalid,
      .zero,
      CMTimeRange(start: .zero, duration: .indefinite),
      CMTimeRange(start: .zero, duration: CMTime(value: 1, timescale: 2_000_000)),
      CMTimeRange(
        start: CMTime(value: (1 << 53) - 1, timescale: 1_000_000),
        duration: CMTime(value: 1, timescale: 1_000_000)),
    ]
    for range in ranges {
      XCTAssertThrowsError(try AudioProbe.metadata(for: range)) { error in
        guard case AudioProbe.ProbeError.invalidTimeRange = error else {
          return XCTFail("Unexpected error: \(error)")
        }
      }
    }
  }
}
