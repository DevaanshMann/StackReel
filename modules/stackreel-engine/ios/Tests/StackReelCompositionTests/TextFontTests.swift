import CoreText
import Foundation
import XCTest

@testable import StackReelComposition

final class TextFontTests: XCTestCase {
  private struct Template: Decodable {
    struct Track: Decodable {
      struct Item: Decodable {
        struct Style: Decodable {
          let font: String
        }

        let style: Style?
      }

      let items: [Item]
    }

    let tracks: [Track]
  }

  func testEverySampleTemplateFontResolvesFromTheBundle() throws {
    // Follow the source tree from Tests/StackReelCompositionTests to the repository root.
    var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    for _ in 0..<5 {
      root.deleteLastPathComponent()
    }
    let examples = root.appendingPathComponent("templates/examples", isDirectory: true)
    let files = try FileManager.default.contentsOfDirectory(
      at: examples, includingPropertiesForKeys: nil
    )
    .filter { $0.pathExtension == "json" }
    let decoder = JSONDecoder()
    let names = Set(
      try files.flatMap { file in
        let template = try decoder.decode(Template.self, from: Data(contentsOf: file))
        return template.tracks.flatMap { $0.items.compactMap { $0.style?.font } }
      })
    XCTAssertFalse(names.isEmpty)

    let fontFiles =
      Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
    XCTAssertEqual(Set(fontFiles.map { $0.deletingPathExtension().lastPathComponent }), names)
    for name in names.sorted() {
      let font = TextRasterizer.font(named: name, size: 32)
      XCTAssertEqual(CTFontCopyPostScriptName(font) as String, name)
      let expectedURL = try XCTUnwrap(
        Bundle.module.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts"))
      XCTAssertEqual(CTFontCopyAttribute(font, kCTFontURLAttribute) as? URL, expectedURL, name)
      XCTAssertEqual(CTFontGetSize(font), 32)
    }
  }

  func testUnavailableFontUsesTheSystemFont() throws {
    let size: CGFloat = 41
    let systemFont = try XCTUnwrap(CTFontCreateUIFontForLanguage(.system, size, nil))
    let font = TextRasterizer.font(named: "StackReelTest-MissingFont", size: size)
    XCTAssertEqual(CTFontCopyPostScriptName(font), CTFontCopyPostScriptName(systemFont))
    XCTAssertEqual(CTFontGetSize(font), size)
  }
}
