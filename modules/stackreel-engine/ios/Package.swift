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
    // Test the audio probe without linking Expo on macOS.
    .target(
      name: "StackReelAudioProbe", path: "Sources/StackReelExpo",
      exclude: ["EnginePreviewView.swift", "RenderSource.swift", "StackReelEngineModule.swift"],
      sources: ["AudioProbe.swift"]),
    .testTarget(
      name: "StackReelCompositionTests",
      dependencies: ["StackReelComposition", "StackReelPlan", "StackReelAudioProbe"]),
    .testTarget(name: "StackReelPlanTests", dependencies: ["StackReelPlan"]),
  ]
)
