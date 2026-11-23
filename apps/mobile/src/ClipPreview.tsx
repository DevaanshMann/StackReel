import Slider from "@react-native-community/slider";
import { StackReelPreviewView } from "@stackreel/engine";
import type { StackReelPreviewViewRef } from "@stackreel/engine";
import { MIN_HIT_TARGET, darkColors, neutral, radius, space } from "@stackreel/ui";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { ViewProps, ViewStyle } from "react-native";
import { SafeZoneOverlay } from "./SafeZoneOverlay";
import { Action, textStyles } from "./Screen";
import { fitPreviewCanvas } from "./template-safe-zones";
import type { SafeZoneGuide } from "./template-safe-zones";

type PreviewCanvas = { width: number; height: number };
const previewMaxWidth = 224;

export function PreviewFrame({
  canvas,
  children,
  maxWidth = previewMaxWidth,
  expanded = false,
  testID,
}: {
  canvas: PreviewCanvas;
  children: ReactNode;
  maxWidth?: number;
  expanded?: boolean;
  testID?: string | undefined;
}) {
  const [available, setAvailable] = useState<PreviewCanvas>({ width: 0, height: 0 });
  const aspectRatio = canvas.width / canvas.height;
  // Yoga can calculate the height before clamping the width, so bound both dimensions.
  const inlineSize = { aspectRatio, maxWidth, maxHeight: maxWidth / aspectRatio };
  const { width, height } = fitPreviewCanvas(canvas, available);
  return (
    <View
      collapsable={false}
      style={expanded && styles.stage}
      onLayout={expanded ? ({ nativeEvent: { layout } }) => setAvailable(layout) : undefined}
    >
      <View testID={testID} style={[styles.frame, expanded ? [styles.fullFrame, { width, height }] : inlineSize]}>
        {children}
      </View>
    </View>
  );
}

export function ClipPreview({
  canvas,
  source,
  suspended,
  viewport,
  safeZoneGuide,
  fullScreen,
}: {
  canvas: PreviewCanvas;
  source: string;
  suspended: boolean;
  viewport?: { maxWidth: number; props: ViewProps; videoStyle: ViewStyle };
  safeZoneGuide?: SafeZoneGuide | null;
  fullScreen?: { active: boolean; disabled: boolean; onChange: (expanded: boolean) => void };
}) {
  const preview = useRef<StackReelPreviewViewRef>(null);
  const dragging = useRef(false);
  const pendingSeek = useRef<{ seconds: number } | null>(null);
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
    const request = { seconds };
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

  const expanded = fullScreen?.active ?? false;
  const seekDisabled = suspended || duration <= 0;
  const visiblePosition = scrubPosition ?? position;
  const playbackControls = (
    <>
      <View style={styles.transport}>
        <Action
          label={playing ? "Pause" : "Play"}
          onPress={() => setPlaying((wasPlaying) => !wasPlaying)}
          disabled={duration <= 0 || suspended || scrubPosition !== null}
        />
        <View
          style={styles.timeline}
          testID="preview-position"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Video position"
          accessibilityValue={{ text: `${timeLabel(visiblePosition)} of ${timeLabel(duration)}` }}
          accessibilityState={{ disabled: seekDisabled }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (seekDisabled || dragging.current || (actionName !== "increment" && actionName !== "decrement")) return;
            const step = Math.min(5, duration / 10);
            const from = pendingSeek.current?.seconds ?? position;
            const seconds = Math.min(duration, Math.max(0, from + (actionName === "increment" ? step : -step)));
            void seek(seconds / duration);
          }}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Slider
              testID="preview-position-slider"
              accessible={false}
              disabled={seekDisabled}
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
    </>
  );
  return (
    <View
      collapsable={false}
      accessibilityViewIsModal={expanded}
      onAccessibilityEscape={expanded ? () => fullScreen?.onChange(false) : undefined}
      style={expanded ? styles.fullPreview : styles.controls}
    >
      {fullScreen && (
        <Action
          testID={expanded ? "preview-fullscreen-close" : "preview-fullscreen-open"}
          label={expanded ? "Exit full screen" : "Full screen"}
          accessibilityLabel={expanded ? "Close full-screen preview" : "Open full-screen preview"}
          onPress={() => fullScreen.onChange(!expanded)}
          disabled={fullScreen.disabled}
        />
      )}
      <PreviewFrame
        canvas={canvas}
        maxWidth={viewport?.maxWidth ?? previewMaxWidth}
        expanded={expanded}
        testID={fullScreen ? "preview-frame" : undefined}
      >
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
      {fullScreen ? (
        <ScrollView
          scrollEnabled={expanded}
          style={expanded && styles.fullTransport}
          contentContainerStyle={styles.controls}
        >
          {playbackControls}
        </ScrollView>
      ) : (
        playbackControls
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
  stage: { flex: 1, justifyContent: "center" },
  fullFrame: { borderWidth: 0, borderRadius: 0 },
  fullPreview: { flex: 1, gap: space[2] },
  fullTransport: { flexGrow: 0, maxHeight: "45%", paddingHorizontal: space[3] },
  viewport: { alignItems: "center", justifyContent: "center" },
  controls: { gap: space[3] },
  transport: { flexDirection: "row", alignItems: "center", gap: space[3] },
  timeline: { flex: 1 },
  slider: { height: 44 },
  timestamps: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
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
