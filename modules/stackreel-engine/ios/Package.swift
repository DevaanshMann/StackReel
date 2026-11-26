// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "StackReelEngine",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [
    .library(name: "StackReelPlan", targets: ["StackReelPlan"]),
    .library(name: "StackReelComposition", targets: ["StackReelComposition"]),
  ],
  targets: [
    .target(name: "StackReelPlan"),
    .target(
      name: "StackReelComposition", dependencies: ["StackReelPlan"],
      resources: [.copy("Resources/Fonts")]),
    // Test native bridge helpers without linking Expo on macOS.
    .target(
      name: "StackReelExpoSupport", path: "Sources/StackReelExpo",
      exclude: ["EnginePreviewView.swift", "RenderSource.swift", "StackReelEngineModule.swift"],
      sources: ["AudioProbe.swift", "VideoThumbnails.swift"]),
    .testTarget(
      name: "StackReelCompositionTests",
      dependencies: ["StackReelComposition", "StackReelPlan", "StackReelExpoSupport"]),
    .testTarget(name: "StackReelPlanTests", dependencies: ["StackReelPlan"]),
  ]
)
