import Accelerate
import MediaToolbox

enum AudioGainTap {
  private final class State {
    let multiplier: Double
    var bitsPerChannel: UInt32 = 0

    init(multiplier: Double) { self.multiplier = multiplier }
  }

  // AVAudioMix volume ramps accept amplitudes between zero and one. Apply any
  // positive base gain to the decoded PCM before that track's fades and ducking.
  static func make(multiplier: Double) throws -> MTAudioProcessingTap {
    let state = State(multiplier: multiplier)
    var callbacks = MTAudioProcessingTapCallbacks(
      version: kMTAudioProcessingTapCallbacksVersion_0,
      clientInfo: Unmanaged.passUnretained(state).toOpaque(),
      init: { _, clientInfo, storage in
        if let clientInfo {
          storage.pointee = Unmanaged<State>.fromOpaque(clientInfo).retain().toOpaque()
        }
      },
      finalize: { tap in Unmanaged<State>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
      },
      prepare: { tap, _, format in
        let state = Unmanaged<State>.fromOpaque(MTAudioProcessingTapGetStorage(tap))
          .takeUnretainedValue()
        let flags = format.pointee.mFormatFlags
        state.bitsPerChannel =
          flags & kAudioFormatFlagIsFloat != 0 && flags & kAudioFormatFlagIsBigEndian == 0
          ? format.pointee.mBitsPerChannel : 0
      },
      unprepare: nil,
      process: { tap, frames, _, buffers, count, flags in
        count.pointee = 0
        guard MTAudioProcessingTapGetSourceAudio(tap, frames, buffers, flags, nil, count) == noErr
        else { return }
        let state = Unmanaged<State>.fromOpaque(MTAudioProcessingTapGetStorage(tap))
          .takeUnretainedValue()
        for buffer in UnsafeMutableAudioBufferListPointer(buffers) {
          guard let data = buffer.mData else { continue }
          if state.bitsPerChannel == 32 {
            let samples = data.assumingMemoryBound(to: Float.self)
            var gain = Float(state.multiplier)
            let size = min(
              count.pointee * Int(buffer.mNumberChannels), Int(buffer.mDataByteSize) / 4)
            vDSP_vsmul(samples, 1, &gain, samples, 1, vDSP_Length(size))
          } else if state.bitsPerChannel == 64 {
            let samples = data.assumingMemoryBound(to: Double.self)
            var gain = state.multiplier
            let size = min(
              count.pointee * Int(buffer.mNumberChannels), Int(buffer.mDataByteSize) / 8)
            vDSP_vsmulD(samples, 1, &gain, samples, 1, vDSP_Length(size))
          }
        }
      })
    return try withExtendedLifetime(state) {
      try create { tap in
        MTAudioProcessingTapCreate(
          kCFAllocatorDefault, &callbacks,
          MTAudioProcessingTapCreationFlags(kMTAudioProcessingTapCreationFlag_PreEffects), tap)
      }
    }
  }

  // The SDK annotation for the retained out parameter changed after Xcode 16.
  // Let the imported function's signature select the ownership conversion.
  private static func create(
    _ call: (UnsafeMutablePointer<MTAudioProcessingTap?>) -> OSStatus
  ) throws -> MTAudioProcessingTap {
    var tap: MTAudioProcessingTap?
    let status = call(&tap)
    guard status == noErr, let tap else {
      throw VideoCompositionBuilder.BuildError.unableToCreateGainTap(status)
    }
    return tap
  }

  private static func create(
    _ call: (UnsafeMutablePointer<Unmanaged<MTAudioProcessingTap>?>) -> OSStatus
  ) throws -> MTAudioProcessingTap {
    var tap: Unmanaged<MTAudioProcessingTap>?
    let status = call(&tap)
    guard status == noErr, let tap else {
      throw VideoCompositionBuilder.BuildError.unableToCreateGainTap(status)
    }
    return tap.takeRetainedValue()
  }
}
