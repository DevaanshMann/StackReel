import { requireNativeModule, requireNativeView } from "expo";
import type { NativeModule } from "expo";
import type { RefAttributes } from "react";
import type { ViewProps } from "react-native";

export interface VideoMetadata {
  width: number;
  height: number;
  startUs: number;
  durationUs: number;
}

export interface AudioMetadata {
  startUs: number;
  durationUs: number;
}

export interface ExportProgress {
  exportId: string;
  progress: number;
}

export interface StackReelPreviewViewProps extends ViewProps {
  source: string;
  playing: boolean;
  looping?: boolean;
  onReady?: (event: { nativeEvent: { durationSeconds: number } }) => void;
  onPositionChange?: (event: { nativeEvent: { positionSeconds: number } }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
}

export interface StackReelPreviewViewRef {
  seekTo(seconds: number): Promise<void>;
}

type EngineEvents = {
  onExportProgress: (event: ExportProgress) => void;
};

interface StackReelEngineModule extends InstanceType<typeof NativeModule<EngineEvents>> {
  probeVideo(uri: string): Promise<VideoMetadata>;
  probeAudio(uri: string): Promise<AudioMetadata>;
  exportMP4(source: string, exportId: string): Promise<{ uri: string }>;
  cancelExport(exportId: string): Promise<void>;
}

const engine = requireNativeModule<StackReelEngineModule>("StackReelEngine");

export function probeVideo(uri: string): Promise<VideoMetadata> {
  return engine.probeVideo(uri);
}

export function probeAudio(uri: string): Promise<AudioMetadata> {
  return engine.probeAudio(uri);
}

export function exportMP4(source: string, exportId: string): Promise<{ uri: string }> {
  return engine.exportMP4(source, exportId);
}

export function cancelExport(exportId: string): Promise<void> {
  return engine.cancelExport(exportId);
}

export function addExportProgressListener(listener: (event: ExportProgress) => void): { remove(): void } {
  return engine.addListener("onExportProgress", listener);
}

export const StackReelPreviewView = requireNativeView<
  StackReelPreviewViewProps & RefAttributes<StackReelPreviewViewRef>
>("StackReelEngine");
