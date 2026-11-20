import AVFoundation
import Darwin

extension VideoComposition {
  public enum ExportError: Error, Equatable {
    case nonFileDestination
    case destinationExists
    case unsupportedEncodingSettings(AVMediaType)
    case cannotAddReaderOutput(AVMediaType)
    case cannotAddWriterInput(AVMediaType)
    case noSamples(AVMediaType)
    case readerFailed
    case writerFailed
  }

  /// Exports the composed timeline as a local H.264 MP4, mixing any audio tracks to AAC.
  /// The destination parent must exist. An existing destination is preserved and causes an error.
  /// The progress callback runs serially on a background queue, from 0 to 1 on success.
  /// Cancel the calling task to stop encoding and discard its staged output.
  public func exportMP4(
    to destination: URL, progress: @escaping @Sendable (Double) -> Void = { _ in },
    isolation: isolated (any Actor)? = #isolation
  ) async throws {
    try Task.checkCancellation()
    guard destination.isFileURL else { throw ExportError.nonFileDestination }
    let files = FileManager.default
    guard !files.fileExists(atPath: destination.path) else { throw ExportError.destinationExists }
    let render = try makeRenderComposition()
    let stagingDirectory = destination.deletingLastPathComponent()
      .appendingPathComponent(".stackreel-export-\(UUID())", isDirectory: true)
    try files.createDirectory(at: stagingDirectory, withIntermediateDirectories: false)
    defer { try? files.removeItem(at: stagingDirectory) }

    let encoding = try MP4Encoding(
      asset: render.asset, videoComposition: render.videoComposition, audioMix: audioMix,
      duration: timelineDuration, stagedFile: stagingDirectory.appendingPathComponent("output.mp4"),
      destination: destination, progress: progress)
    try await encoding.run()
  }
}

// AVFoundation objects and mutable encoding state are confined to the queue after setup.
private final class MP4Encoding: @unchecked Sendable {
  private typealias ExportError = VideoComposition.ExportError

  private struct Stream {
    let output: AVAssetReaderOutput
    let input: AVAssetWriterInput
  }

  private let reader: AVAssetReader
  private let writer: AVAssetWriter
  private let streams: [Stream]
  private let duration: CMTime
  private let destination: URL
  private let progress: @Sendable (Double) -> Void
  private let queue = DispatchQueue(label: "StackReelComposition.MP4Export", qos: .userInitiated)
  private let cancellationLock = NSLock()
  private var cancellationRequested = false
  private var continuation: CheckedContinuation<Void, Error>?
  private var statusMonitor: DispatchSourceTimer?
  private var remainingStreams: Int
  private var writtenMedia: Set<AVMediaType> = []
  private var lastProgress = 0.0

  init(
    asset: AVComposition, videoComposition: AVVideoComposition, audioMix: AVAudioMix?,
    duration: CMTime, stagedFile: URL, destination: URL,
    progress: @escaping @Sendable (Double) -> Void
  ) throws {
    let reader = try AVAssetReader(asset: asset)
    let writer = try AVAssetWriter(outputURL: stagedFile, fileType: .mp4)
    reader.timeRange = CMTimeRange(start: .zero, duration: duration)
    let video = AVAssetReaderVideoCompositionOutput(
      videoTracks: asset.tracks(withMediaType: .video),
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    video.videoComposition = videoComposition
    var streams = [
      try Self.connect(
        video, mediaType: .video, reader: reader, writer: writer,
        settings: [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: videoComposition.renderSize.width,
          AVVideoHeightKey: videoComposition.renderSize.height,
        ])
    ]

    let audioTracks = asset.tracks(withMediaType: .audio)
    if !audioTracks.isEmpty {
      let sampleRate = 48_000
      let channels = 2
      let audio = AVAssetReaderAudioMixOutput(
        audioTracks: audioTracks,
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels,
        ])
      audio.audioMix = audioMix
      streams.append(
        try Self.connect(
          audio, mediaType: .audio, reader: reader, writer: writer,
          settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVEncoderBitRateKey: 128_000,
            AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels,
          ]))
    }

    self.reader = reader
    self.writer = writer
    self.streams = streams
    self.remainingStreams = streams.count
    self.duration = duration
    self.destination = destination
    self.progress = progress
  }

  private static func connect(
    _ output: AVAssetReaderOutput, mediaType: AVMediaType, reader: AVAssetReader,
    writer: AVAssetWriter, settings: [String: Any]
  ) throws -> Stream {
    guard reader.canAdd(output) else { throw ExportError.cannotAddReaderOutput(mediaType) }
    guard writer.canApply(outputSettings: settings, forMediaType: mediaType) else {
      throw ExportError.unsupportedEncodingSettings(mediaType)
    }
    let input = AVAssetWriterInput(mediaType: mediaType, outputSettings: settings)
    guard writer.canAdd(input) else { throw ExportError.cannotAddWriterInput(mediaType) }
    output.alwaysCopiesSampleData = false
    reader.add(output)
    writer.add(input)
    return Stream(output: output, input: input)
  }

  func run() async throws {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        queue.async { self.start(continuation) }
      }
    } onCancel: {
      self.cancellationLock.withLock { self.cancellationRequested = true }
      self.queue.async { self.checkStatus() }
    }
  }

  private func start(_ continuation: CheckedContinuation<Void, Error>) {
    self.continuation = continuation
    do {
      try checkForFailure()
      guard writer.startWriting() else { throw writer.error ?? ExportError.writerFailed }
      guard reader.startReading() else { throw reader.error ?? ExportError.readerFailed }
      writer.startSession(atSourceTime: .zero)
      progress(0)

      // A failure can stop readiness callbacks while all inputs are backpressured.
      let monitor = DispatchSource.makeTimerSource(queue: queue)
      monitor.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
      monitor.setEventHandler { [weak self] in self?.checkStatus() }
      statusMonitor = monitor
      monitor.resume()
      for index in streams.indices {
        streams[index].input.requestMediaDataWhenReady(on: queue) { [weak self] in
          self?.drainStream(at: index)
        }
      }
    } catch {
      complete(.failure(error))
    }
  }

  private func drainStream(at index: Int) {
    guard continuation != nil else { return }
    let stream = streams[index]
    let mediaType = stream.input.mediaType
    do {
      while stream.input.isReadyForMoreMediaData {
        try checkForFailure()
        let time = try autoreleasepool { () throws -> CMTime? in
          guard let sample = stream.output.copyNextSampleBuffer() else { return nil }
          guard stream.input.append(sample) else { throw writer.error ?? ExportError.writerFailed }
          return sample.presentationTimeStamp
        }
        guard let time else {
          try checkForFailure()
          guard writtenMedia.contains(mediaType) else { throw ExportError.noSamples(mediaType) }
          stream.input.markAsFinished()
          remainingStreams -= 1
          if remainingStreams == 0 {
            guard reader.status == .completed else {
              throw reader.error ?? ExportError.readerFailed
            }
            writer.endSession(atSourceTime: duration)
            writer.finishWriting { self.queue.async { self.publish() } }
          }
          return
        }
        writtenMedia.insert(mediaType)
        if mediaType == .video, time.isNumeric {
          let fraction = min(time.seconds / duration.seconds, 1.0.nextDown)
          if fraction > lastProgress {
            lastProgress = fraction
            progress(fraction)
          }
        }
      }
    } catch {
      complete(.failure(error))
    }
  }

  private func checkForFailure() throws {
    if cancellationLock.withLock({ cancellationRequested }) { throw CancellationError() }
    if reader.status == .failed || reader.status == .cancelled {
      throw reader.error ?? ExportError.readerFailed
    }
    if writer.status == .failed || writer.status == .cancelled {
      throw writer.error ?? ExportError.writerFailed
    }
  }

  private func checkStatus() {
    guard continuation != nil else { return }
    do {
      try checkForFailure()
    } catch {
      complete(.failure(error))
    }
  }

  private func publish() {
    guard continuation != nil else { return }
    do {
      guard writer.status == .completed else { throw writer.error ?? ExportError.writerFailed }
      try cancellationLock.withLock {
        if cancellationRequested { throw CancellationError() }
        // Commit the finished file atomically and fail if another process claimed the path.
        try writer.outputURL.withUnsafeFileSystemRepresentation { source in
          try destination.withUnsafeFileSystemRepresentation { target in
            guard let source, let target else { throw POSIXError(.EINVAL) }
            if renamex_np(source, target, UInt32(RENAME_EXCL)) != 0 {
              let code = errno
              if code == EEXIST { throw ExportError.destinationExists }
              throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
            }
          }
        }
      }
      progress(1)
      complete(.success(()))
    } catch {
      complete(.failure(error))
    }
  }

  private func complete(_ result: Result<Void, Error>) {
    let pending = continuation
    continuation = nil
    statusMonitor?.cancel()
    statusMonitor = nil
    if case .failure = result {
      if reader.status == .reading { reader.cancelReading() }
      if writer.status == .writing { writer.cancelWriting() }
    }
    pending?.resume(with: result)
  }
}
