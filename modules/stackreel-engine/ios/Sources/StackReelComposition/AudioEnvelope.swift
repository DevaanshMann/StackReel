import AVFoundation
import StackReelPlan

struct AudioEnvelope {
  let entry: AudioEntry

  init(_ entry: AudioEntry) {
    self.entry = entry
  }

  func apply(to parameters: AVMutableAudioMixInputParameters) {
    let start = Double(entry.startUs)
    let end = Double(entry.endUs)
    let length = end - start
    let fadeIn = min(Double(entry.fadeInUs), length)
    let fadeOut = min(Double(entry.fadeOutUs), length)
    let gain = pow(10, min(0, entry.gainDb) / 20)
    func fade(at time: Double) -> Double {
      let incoming = fadeIn > 0 ? (time - start) / fadeIn : 1
      let outgoing = fadeOut > 0 ? (end - time) / fadeOut : 1
      return max(0, min(1, incoming, outgoing))
    }

    var points = [start + fadeIn, end - fadeOut]
    if fadeIn + fadeOut > length {
      points.append(start + length * fadeIn / (fadeIn + fadeOut))
    }
    let ducking = entry.ducking.map(Ducking.init)
    points += ducking?.breakpoints ?? []
    var boundaries: Set<Int64> = [entry.startUs, entry.endUs]
    for point in points where point > start && point < end {
      boundaries.insert(Int64(point.rounded()))
    }
    let sorted = boundaries.sorted()
    for (left, right) in zip(sorted, sorted.dropFirst()) {
      let middle = (Double(left) + Double(right)) / 2
      func musicLevel(_ time: Double) -> Double {
        guard let ducking else { return 1 }
        return ducking.level(at: ducking.ramp > 0 ? time : middle)
      }
      // AVAudioMix interpolates in linear amplitude. Subdivide where the product
      // of two changing ramps curves away from a straight line.
      let changesTwice =
        fade(at: Double(left)) != fade(at: Double(right))
        && musicLevel(Double(left)) != musicLevel(Double(right))
      let steps = changesTwice ? min(8, right - left) : 1
      var lower = left
      for step in 1...steps {
        let upper = step == steps ? right : left + (right - left) / steps * step
        let range = CMTimeRange(
          start: VideoCompositionBuilder.time(lower), end: VideoCompositionBuilder.time(upper))
        parameters.setVolumeRamp(
          fromStartVolume: Float(gain * fade(at: Double(lower)) * musicLevel(Double(lower))),
          toEndVolume: Float(gain * fade(at: Double(upper)) * musicLevel(Double(upper))),
          timeRange: range)
        lower = upper
      }
    }
  }

  private struct Ducking {
    let ramp: Double
    let reduction: Double
    let regions: [Range<Double>]

    init(_ ducking: AudioEntry.Ducking) {
      ramp = Double(ducking.rampUs)
      reduction = 1 - pow(10, ducking.gainDb / 20)
      var merged: [Range<Double>] = []
      for region in ducking.regions.sorted(by: { $0.startUs < $1.startUs })
      where region.endUs > region.startUs {
        let start = Double(region.startUs)
        let end = Double(region.endUs)
        if let last = merged.last, last.upperBound >= start {
          merged[merged.count - 1] = last.lowerBound..<max(last.upperBound, end)
        } else {
          merged.append(start..<end)
        }
      }
      regions = merged
    }

    var breakpoints: [Double] {
      var points: [Double] = []
      let half = ramp / 2
      for region in regions {
        let (start, end) = (region.lowerBound, region.upperBound)
        points += [start - half, start + half, end - half, end + half]
        if end - start < ramp { points.append((start + end) / 2) }
      }
      // Overlapping releases and attacks meet halfway between adjacent voice regions.
      for (previous, next) in zip(regions, regions.dropFirst())
      where next.lowerBound - previous.upperBound < ramp {
        points.append((previous.upperBound + next.lowerBound) / 2)
      }
      return points
    }

    func level(at time: Double) -> Double {
      if ramp == 0 { return regions.contains { $0.contains(time) } ? 1 - reduction : 1 }
      var amount: Double = 0
      for region in regions {
        if time < region.lowerBound - ramp / 2 { break }
        let attack = 0.5 + (time - region.lowerBound) / ramp
        let release = 0.5 + (region.upperBound - time) / ramp
        amount = max(amount, min(1, attack, release))
      }
      return 1 - reduction * amount
    }
  }
}
