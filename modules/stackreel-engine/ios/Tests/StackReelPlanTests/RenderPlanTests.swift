import CryptoKit
import Foundation
import StackReelPlan
import XCTest

final class RenderPlanTests: XCTestCase {
  private struct Manifest: Decodable {
    struct Fixture: Decodable {
      struct PlanFile: Decodable {
        let path: String
        let sha256: String
      }

      let id: String
      let renderPlanVersion: Int
      let renderPlan: PlanFile
    }

    let manifestVersion: Int
    let renderPlanVersion: Int
    let cases: [Fixture]
  }

  func testSharedPlansRoundTrip() throws {
    // Tests/StackReelPlanTests → ios → stackreel-engine → modules → repository root.
    var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    for _ in 0..<5 {
      root.deleteLastPathComponent()
    }
    let fixtures = root.appendingPathComponent("fixtures", isDirectory: true)
    let manifestData = try Data(contentsOf: fixtures.appendingPathComponent("manifest.json"))
    let manifest = try JSONDecoder().decode(Manifest.self, from: manifestData)

    XCTAssertEqual(manifest.manifestVersion, 1)
    XCTAssertEqual(manifest.renderPlanVersion, RenderPlan.currentVersion)
    XCTAssertFalse(manifest.cases.isEmpty)

    for fixture in manifest.cases {
      do {
        XCTAssertEqual(fixture.renderPlanVersion, RenderPlan.currentVersion, fixture.id)
        let data = try Data(contentsOf: fixtures.appendingPathComponent(fixture.renderPlan.path))
        let sha256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(
          sha256, fixture.renderPlan.sha256, "\(fixture.id): use the current generated fixtures")

        let plan = try JSONDecoder().decode(RenderPlan.self, from: data)
        XCTAssertEqual(plan.templateId, fixture.id)
        try assertSameJSON(JSONEncoder().encode(plan), data, message: fixture.id)
      } catch {
        XCTFail("\(fixture.id): \(error)")
      }
    }
  }

  func testUnsupportedVersionFailsBeforeReadingPayload() {
    let data = Data(#"{"renderPlanVersion":2}"#.utf8)
    XCTAssertThrowsError(try JSONDecoder().decode(RenderPlan.self, from: data)) { error in
      guard case DecodingError.dataCorrupted(let context) = error else {
        return XCTFail("Expected an unsupported version error, got \(error)")
      }
      XCTAssertEqual(context.codingPath.map(\.stringValue), ["renderPlanVersion"])
    }
  }

  func testLongDurationKeepsMicrosecondPrecision() throws {
    let data = Data(
      #"""
      {
        "renderPlanVersion": 1, "templateId": "long-plan", "durationUs": 3000033333,
        "canvas": {"width":1080,"height":1920,"fps":30,"background":"#000000"},
        "layers": [], "transitions": [], "audio": [], "warnings": []
      }
      """#.utf8)
    let plan = try JSONDecoder().decode(RenderPlan.self, from: data)
    XCTAssertEqual(plan.durationUs, 3_000_033_333)
    try assertSameJSON(JSONEncoder().encode(plan), data)
  }

  func testBackgroundTransitionRequiresExplicitNull() throws {
    let json = #"""
      {"id":"video/0","trackId":"video","z":0,"type":"crossfade","startUs":0,"endUs":100000,"toLayerId":"video/0"}
      """#
    XCTAssertThrowsError(try JSONDecoder().decode(Transition.self, from: Data(json.utf8)))

    let data = Data((json.dropLast() + #","fromLayerId":null}"#).utf8)
    let transition = try JSONDecoder().decode(Transition.self, from: data)
    XCTAssertNil(transition.fromLayerId)
    try assertSameJSON(JSONEncoder().encode(transition), data)
  }

  func testTransformRequiresNineElements() {
    let data = Data("[1, 0, 0, 0, 1, 0]".utf8)
    XCTAssertThrowsError(try JSONDecoder().decode(Layer.Media.Transform.self, from: data))
  }

  func testWarningsRoundTrip() throws {
    let data = Data(
      #"""
      [
        {"type":"missing-slot","slotId":"clip","message":"Missing slot"},
        {"type":"asset-info-missing","slotId":"clip","assetUri":"fixture://clip.mp4","message":"Missing asset info"},
        {"type":"empty-trim","slotId":"clip","layerId":"video/0","message":"Empty trim"},
        {"type":"clip-too-short","slotId":"clip","layerId":"video/0","neededUs":1000000,"availableUs":400000,
         "policy":"slow","message":"Short clip"},
        {"type":"min-speed-reached","slotId":"clip","layerId":"video/0","minSpeed":0.25,"message":"Minimum speed"},
        {"type":"item-too-short","trackId":"video","itemIndex":0,"message":"Short item"}
      ]
      """#.utf8)
    let warnings = try JSONDecoder().decode([PlanWarning].self, from: data)
    XCTAssertEqual(
      warnings.map(\.detail),
      [
        .missingSlot(slotId: "clip"),
        .assetInfoMissing(slotId: "clip", assetUri: "fixture://clip.mp4"),
        .emptyTrim(slotId: "clip", layerId: "video/0"),
        .clipTooShort(
          slotId: "clip", layerId: "video/0", neededUs: 1_000_000, availableUs: 400_000,
          policy: .slow),
        .minSpeedReached(slotId: "clip", layerId: "video/0", minSpeed: 0.25),
        .itemTooShort(trackId: "video", itemIndex: 0),
      ])
    try assertSameJSON(JSONEncoder().encode(warnings), data)
  }

  private func assertSameJSON(
    _ actual: Data, _ expected: Data, message: String = "", file: StaticString = #filePath,
    line: UInt = #line
  ) throws {
    let actualJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: actual) as? NSObject)
    let expectedJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: expected) as? NSObject)
    XCTAssertEqual(actualJSON, expectedJSON, message, file: file, line: line)
  }
}
