import Darwin
import Foundation

struct ExportCache: Sendable {
  static let shared = ExportCache(
    directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("StackReelExports", isDirectory: true))

  private let directory: URL
  let cleanup: Task<Void, Never>

  init(directory: URL) {
    self.directory = directory
    // The shared instance and its single sweep survive Expo module reloads.
    cleanup = Task.detached(priority: .utility) { Self.removePreviousExports(in: directory) }
  }

  func nextOutputURL() async throws -> URL {
    await cleanup.value
    try Task.checkCancellation()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    guard Self.fileType(at: directory) == .typeDirectory else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    return directory.appendingPathComponent("\(UUID().uuidString).mp4", isDirectory: false)
  }

  private static func fileType(at url: URL) -> FileAttributeType? {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.type]) as? FileAttributeType
  }

  private static func removePreviousExports(in directory: URL) {
    guard fileType(at: directory) == .typeDirectory,
      let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path)
    else { return }

    let stagingPrefix = ".stackreel-export-"
    for name in names {
      let item = directory.appendingPathComponent(name, isDirectory: false)
      if name.hasSuffix(".mp4"), UUID(uuidString: String(name.dropLast(4))) != nil,
        fileType(at: item) == .typeRegular
      {
        unlink(item.path)
      } else if name.hasPrefix(stagingPrefix),
        UUID(uuidString: String(name.dropFirst(stagingPrefix.count))) != nil,
        fileType(at: item) == .typeDirectory,
        let contents = try? FileManager.default.contentsOfDirectory(atPath: item.path)
      {
        let output = item.appendingPathComponent("output.mp4", isDirectory: false)
        // Match the stored spelling on case-insensitive volumes too.
        if contents.contains("output.mp4"), fileType(at: output) == .typeRegular { unlink(output.path) }
        // rmdir preserves any other contents in the staging directory.
        rmdir(item.path)
      }
    }
  }
}
