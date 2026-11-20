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
    .testTarget(
      name: "StackReelCompositionTests", dependencies: ["StackReelComposition", "StackReelPlan"]),
    .testTarget(name: "StackReelPlanTests", dependencies: ["StackReelPlan"]),
  ]
)
