// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "StackReelEngine",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [.library(name: "StackReelPlan", targets: ["StackReelPlan"])],
  targets: [
    .target(name: "StackReelPlan"),
    .testTarget(name: "StackReelPlanTests", dependencies: ["StackReelPlan"]),
  ]
)
