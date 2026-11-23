import Slider from "@react-native-community/slider";
import { StackReelPreviewView } from "@stackreel/engine";
import type { StackReelPreviewViewRef } from "@stackreel/engine";
import { MIN_HIT_TARGET, darkColors, neutral, radius, space } from "@stackreel/ui";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import type { ViewProps, ViewStyle } from "react-native";
import { SafeZoneOverlay } from "./SafeZoneOverlay";
import { Action, textStyles } from "./Screen";
import type { SafeZoneGuide } from "./template-safe-zones";

type PreviewCanvas = { width: number; height: number };
const previewMaxWidth = 224;

export function PreviewFrame({
  canvas,
  children,
  maxWidth = previewMaxWidth,
}: {
  canvas: PreviewCanvas;
  children: ReactNode;
  maxWidth?: number;
}) {
  const aspectRatio = canvas.width / canvas.height;
  // Yoga can calculate the height before clamping the width, so bound both dimensions.
  return <View style={[styles.frame, { aspectRatio, maxWidth, maxHeight: maxWidth / aspectRatio }]}>{children}</View>;
}

export function ClipPreview({
  canvas,
  source,
  suspended,
  viewport,
  safeZoneGuide,
}: {
  canvas: PreviewCanvas;
  source: string;
  suspended: boolean;
  viewport?: { maxWidth: number; props: ViewProps; videoStyle: ViewStyle };
  safeZoneGuide?: SafeZoneGuide | null;
}) {
  const preview = useRef<StackReelPreviewViewRef>(null);
  const dragging = useRef(false);
  const pendingSeek = useRef<object | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(false);

  async function seek(fraction: number) {
    dragging.current = false;
    const view = preview.current;
    if (!view || duration <= 0) return;

    const seconds = fraction * duration;
    const request = {};
    pendingSeek.current = request;
    setScrubPosition(seconds);
    setError(null);
    if (seconds >= duration) setPlaying(false);
    try {
      await view.seekTo(seconds);
      if (preview.current === view && pendingSeek.current === request) setPosition(seconds);
    } catch (cause) {
      if (preview.current === view && pendingSeek.current === request) {
        setPlaying(false);
        setError(errorMessage("Couldn’t move the playhead.", cause));
      }
    } finally {
      if (preview.current === view && pendingSeek.current === request) {
        pendingSeek.current = null;
        setScrubPosition(null);
      }
    }
  }

  const visiblePosition = scrubPosition ?? position;
  return (
    <View style={styles.controls}>
      <PreviewFrame canvas={canvas} maxWidth={viewport?.maxWidth ?? previewMaxWidth}>
        <View {...viewport?.props} style={[StyleSheet.absoluteFill, styles.viewport]}>
          <StackReelPreviewView
            ref={preview}
            style={viewport?.videoStyle ?? StyleSheet.absoluteFill}
            source={source}
            playing={playing && !suspended && scrubPosition === null}
            onReady={({ nativeEvent }) => setDuration(nativeEvent.durationSeconds)}
            onPositionChange={({ nativeEvent }) => {
              if (duration <= 0 || dragging.current || pendingSeek.current) return;
              const seconds = nativeEvent.positionSeconds;
              setPosition(Math.min(seconds, duration));
              if (seconds >= duration) setPlaying(false);
            }}
            onError={({ nativeEvent }) => {
              dragging.current = false;
              pendingSeek.current = null;
              setScrubPosition(null);
              setPlaying(false);
              setDuration(0);
              setError(errorMessage("Couldn’t load the preview.", nativeEvent.message));
            }}
          />
          {showSafeZones && safeZoneGuide && <SafeZoneOverlay canvas={canvas} guide={safeZoneGuide} />}
          {duration === 0 && !error && <Text style={textStyles.muted}>Preparing preview…</Text>}
        </View>
      </PreviewFrame>
      <View style={styles.transport}>
        <Action
          label={playing ? "Pause" : "Play"}
          onPress={() => setPlaying((wasPlaying) => !wasPlaying)}
          disabled={duration <= 0 || suspended || scrubPosition !== null}
        />
        <View style={styles.timeline}>
          <Slider
            accessibilityLabel="Video position"
            accessibilityValue={{ text: `${timeLabel(visiblePosition)} of ${timeLabel(duration)}` }}
            disabled={duration <= 0 || suspended}
            value={duration > 0 ? position / duration : 0}
            minimumTrackTintColor={darkColors.accent}
            maximumTrackTintColor={darkColors.border}
            thumbTintColor={darkColors.text}
            style={styles.slider}
            tapToSeek
            onSlidingStart={(fraction) => {
              dragging.current = true;
              pendingSeek.current = null;
              setScrubPosition(fraction * duration);
            }}
            onValueChange={(fraction) => {
              if (dragging.current) setScrubPosition(fraction * duration);
              else void seek(fraction);
            }}
            onSlidingComplete={seek}
          />
          <View style={styles.timestamps}>
            <Text style={styles.time}>{timeLabel(visiblePosition)}</Text>
            <Text style={styles.time}>{timeLabel(duration)}</Text>
          </View>
        </View>
      </View>
      {safeZoneGuide && (
        <View style={styles.safeZoneControl}>
          <Text accessibilityElementsHidden style={[textStyles.body, styles.safeZoneLabel]}>
            Safe zones
          </Text>
          <Switch
            testID="template-safe-zones-toggle"
            accessibilityLabel="Safe zones"
            accessibilityRole="switch"
            accessibilityHint={
              safeZoneGuide.safe
                ? "Shows where platform controls may cover the video."
                : "Shows that platform controls may cover the entire video."
            }
            hitSlop={7}
            trackColor={{ true: darkColors.accent }}
            value={showSafeZones}
            onValueChange={setShowSafeZones}
          />
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

export function errorMessage(summary: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : cause;
  return typeof message === "string" && message ? `${summary} ${message}` : summary;
}

function timeLabel(seconds: number) {
  const tenths = Math.max(0, Math.floor(seconds * 10));
  const total = Math.floor(tenths / 10);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}.${tenths % 10}`;
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: neutral[900],
    borderColor: darkColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  viewport: { alignItems: "center", justifyContent: "center" },
  controls: { gap: space[3] },
  transport: { flexDirection: "row", alignItems: "center", gap: space[3] },
  timeline: { flex: 1 },
  slider: { height: 44 },
  timestamps: { flexDirection: "row", justifyContent: "space-between" },
  time: { ...textStyles.muted, fontVariant: ["tabular-nums"] },
  safeZoneControl: {
    minHeight: MIN_HIT_TARGET,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  safeZoneLabel: { flexShrink: 1 },
});
