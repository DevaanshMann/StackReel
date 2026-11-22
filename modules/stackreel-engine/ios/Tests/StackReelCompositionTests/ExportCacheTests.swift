import Foundation
import XCTest

@testable import StackReelExpoSupport

final class ExportCacheTests: XCTestCase {
  private func makeDirectory() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    addTeardownBlock { try FileManager.default.removeItem(at: root) }
    return root
  }

  @MainActor
  func testLaunchReclaimsLegacyExportsAndKeepsIndependentCopies() async throws {
    let files = FileManager.default
    let root = try makeDirectory()
    let exports = root.appendingPathComponent("StackReelExports", isDirectory: true)
    try files.createDirectory(at: exports, withIntermediateDirectories: false)
    let old = exports.appendingPathComponent("\(UUID()).mp4")
    let video = Data("completed export".utf8)
    try video.write(to: old)
    let savedCopy = root.appendingPathComponent(old.lastPathComponent)
    try files.copyItem(at: old, to: savedCopy)
    let unrelated = exports.appendingPathComponent("keep.mp4")
    try video.write(to: unrelated)
    let staging = exports.appendingPathComponent(".stackreel-export-\(UUID())")
    try files.createDirectory(at: staging, withIntermediateDirectories: false)
    try video.write(to: staging.appendingPathComponent("output.mp4"))

    let session = ExportCache(directory: exports)
    await session.cleanup.value

    XCTAssertFalse(files.fileExists(atPath: old.path))
    XCTAssertFalse(files.fileExists(atPath: staging.path))
    XCTAssertEqual(try Data(contentsOf: savedCopy), video)
    XCTAssertEqual(try Data(contentsOf: unrelated), video)
  }

  @MainActor
  func testCurrentExportsSurviveOtherJobsUntilTheNextLaunch() async throws {
    let exports = try makeDirectory().appendingPathComponent("StackReelExports")
    let session = ExportCache(directory: exports)
    async let firstJob = session.nextOutputURL()
    async let secondJob = session.nextOutputURL()
    let (first, second) = try await (firstJob, secondJob)
    XCTAssertNotEqual(first, second)
    let video = Data("current export".utf8)
    try video.write(to: first)
    try video.write(to: second)

    _ = try await session.nextOutputURL()
    XCTAssertEqual(try Data(contentsOf: first), video)
    XCTAssertEqual(try Data(contentsOf: second), video)

    let relaunched = ExportCache(directory: exports)
    await relaunched.cleanup.value
    XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: second.path))
    let fresh = try await relaunched.nextOutputURL()
    try video.write(to: fresh)
    XCTAssertEqual(try Data(contentsOf: fresh), video)
  }

  @MainActor
  func testCleanupLeavesForeignFilesAndDirectoriesInPlace() async throws {
    let files = FileManager.default
    let exports = try makeDirectory()
    let video = Data("preserve".utf8)
    let namedLikeAnExport = exports.appendingPathComponent("\(UUID()).mp4")
    let staging = exports.appendingPathComponent(".stackreel-export-\(UUID())")
    for folder in [namedLikeAnExport, staging] {
      try files.createDirectory(at: folder, withIntermediateDirectories: false)
      try video.write(to: folder.appendingPathComponent("notes.txt"))
    }

    let session = ExportCache(directory: exports)
    await session.cleanup.value
    for folder in [namedLikeAnExport, staging] {
      XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("notes.txt")), video)
    }
  }

  @MainActor
  func testCleanupDoesNotFollowLinksToOtherStorage() async throws {
    let files = FileManager.default
    let root = try makeDirectory()
    let external = root.appendingPathComponent("Saved")
    let exports = root.appendingPathComponent("StackReelExports", isDirectory: true)
    try files.createDirectory(at: external, withIntermediateDirectories: false)
    let saved = external.appendingPathComponent("\(UUID()).mp4")
    let video = Data("saved video".utf8)
    try video.write(to: saved)
    try files.createSymbolicLink(at: exports, withDestinationURL: external)
    await ExportCache(directory: exports).cleanup.value
    XCTAssertEqual(try Data(contentsOf: saved), video)

    try files.removeItem(at: exports)
    try files.createDirectory(at: exports, withIntermediateDirectories: false)
    let stagedLink = exports.appendingPathComponent(".stackreel-export-\(UUID())")
    try files.createSymbolicLink(at: stagedLink, withDestinationURL: external)
    let otherOutput = external.appendingPathComponent("output.mp4")
    try video.write(to: otherOutput)
    await ExportCache(directory: exports).cleanup.value
    XCTAssertEqual(try Data(contentsOf: otherOutput), video)
  }
}
