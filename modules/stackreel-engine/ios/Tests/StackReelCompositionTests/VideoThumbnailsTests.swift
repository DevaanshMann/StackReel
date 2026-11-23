import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import XCTest

@testable import StackReelExpoSupport

final class VideoThumbnailsTests: XCTestCase {
  @MainActor
  func testGeneratesOrientedJPEGsAndKeepsUnavailableFramesInPlace() async throws {
    let rotation = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 48, ty: 0)
    let url = try await makeMovie(transform: rotation)
    let frames = try await VideoThumbnails.generate(
      for: url, timesUs: [2_966_667, 3_000_000, 0, -1, 1.5, .infinity, .nan, 0])

    XCTAssertEqual(frames.count, 8)
    for index in [1, 3, 4, 5, 6] { XCTAssertNil(frames[index]) }
    for index in [0, 2, 7] {
      let uri = try XCTUnwrap(frames[index])
      let prefix = "data:image/jpeg;base64,"
      XCTAssertTrue(uri.hasPrefix(prefix))
      let data = try XCTUnwrap(Data(base64Encoded: String(uri.dropFirst(prefix.count))))
      let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
      XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)
      let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
      XCTAssertLessThanOrEqual(image.width, 192)
      XCTAssertEqual(Double(image.width) / Double(image.height), 48.0 / 32.0, accuracy: 0.02)
    }
  }

  @MainActor
  func testMissingVideoTrackReturnsAnUnavailableEntryForEachSample() async throws {
    let url = try makeTestTone(frequency: 440)
    let frames = try await VideoThumbnails.generate(for: url, timesUs: [0, 500_000])
    XCTAssertEqual(frames, [nil, nil])
  }

  @MainActor
  func testBoundsRequestBeforeOpeningFile() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let empty = try await VideoThumbnails.generate(for: url, timesUs: [])
    XCTAssertTrue(empty.isEmpty)
    do {
      _ = try await VideoThumbnails.generate(for: url, timesUs: Array(repeating: 0, count: 9))
      XCTFail("Expected a request over the sample limit to fail")
    } catch VideoThumbnails.RequestError.tooManyFrames {}
  }
}
