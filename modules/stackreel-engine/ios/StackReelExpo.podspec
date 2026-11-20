Pod::Spec.new do |s|
  s.name = 'StackReelExpo'
  s.version = '0.0.0'
  s.summary = 'Expo bridge for the StackReel iOS engine.'
  s.homepage = 'https://github.com/DevaanshMann/StackReel'
  s.license = 'MIT'
  s.author = 'StackReel contributors'
  s.source = { :git => 'https://github.com/DevaanshMann/StackReel.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '6.0'
  s.static_framework = true
  s.source_files = 'Sources/StackReelExpo/**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.dependency 'ExpoModulesCore'
  s.dependency 'StackReelPlan', s.version.to_s
  s.dependency 'StackReelComposition', s.version.to_s
end
