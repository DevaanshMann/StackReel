import Slider from "@react-native-community/slider";
import { PLAN_DEFAULTS, cropRect, fitMatrix } from "@stackreel/core";
import type { Crop, Size } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent, NativeTouchEvent } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { createClipSource } from "./clip-source";
import { defaultClipReframe, getClipCrop, maxClipReframeZoom } from "./clip-reframe";
import type { ClipReframe } from "./clip-reframe";
import type { MobileTemplate } from "./template-editor";

type TouchGeometry = { first: number; second?: number; x: number; y: number; distance: number };
type Gesture = {
  target: NativeTouchEvent["target"];
  start: { touches: TouchGeometry; reframe: ClipReframe; crop: Crop } | null;
};

const zoomRange = maxClipReframeZoom - defaultClipReframe.zoom;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

function touchGeometry(touches: readonly NativeTouchEvent[], target: NativeTouchEvent["target"]): TouchGeometry | null {
  const [first, second] = touches
    .filter((touch) => touch.target === target)
    .sort((a, b) => a.identifier - b.identifier);
  if (!first) return null;
  if (!second) return { first: first.identifier, x: first.locationX, y: first.locationY, distance: 0 };
  return {
    first: first.identifier,
    second: second.identifier,
    x: (first.locationX + second.locationX) / 2,
    y: (first.locationY + second.locationY) / 2,
    distance: Math.hypot(first.locationX - second.locationX, first.locationY - second.locationY),
  };
}

function movePlacement(position: number, oldSize: number, newSize: number, start: number, current: number) {
  const travel = 1 - newSize;
  if (travel <= 0) return position;
  // Keep the same point of the source under the finger or pinch midpoint.
  const zoomShift = (oldSize - newSize) * (start - position);
  const dragShift = (start - current) * newSize;
  return clamp(position + (zoomShift + dragShift) / travel, 0, 1);
}

export function ReframeSheet({
  id,
  title,
  clip,
  canvas,
  previewGainDb = 0,
  onApply,
  onCancel,
}: {
  id: string;
  title: string;
  clip: Size & { uri: string; trimInUs: number; trimOutUs: number; reframe?: ClipReframe | undefined };
  canvas: MobileTemplate["canvas"];
  previewGainDb?: number;
  onApply: (reframe: ClipReframe) => void;
  onCancel: () => void;
}) {
  const [reframe, setReframe] = useState(clip.reframe ?? defaultClipReframe);
  const currentReframe = useRef(reframe);
  const [viewportSize, setViewportSize] = useState<Size | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const scale = Math.min(1, Math.max(canvas.width, canvas.height) / Math.max(clip.width, clip.height));
    const even = (size: number) => Math.max(2, 2 * Math.round((size * scale) / 2));
    const width = even(clip.width);
    const height = even(clip.height);
    // Keep the entire oriented source available while the viewport moves over it.
    const source = createClipSource(
      clip.uri,
      { width: clip.width, height: clip.height, startUs: clip.trimInUs, durationUs: clip.trimOutUs - clip.trimInUs },
      { width, height, fps: canvas.fps, background: canvas.background ?? PLAN_DEFAULTS.background },
      "fill",
      previewGainDb,
    );
    return { source, width, height };
  }, [canvas, clip, previewGainDb]);

  const crop = getClipCrop(clip, canvas, reframe);
  const [scaleX, , left, , scaleY, top] = fitMatrix(clip, canvas, "cover", cropRect(clip, crop));
  const displayX = (viewportSize?.width ?? 1) / canvas.width;
  const displayY = (viewportSize?.height ?? 1) / canvas.height;

  function update(next: ClipReframe) {
    currentReframe.current = next;
    setReframe(next);
  }

  function moveGesture({ nativeEvent }: GestureResponderEvent, rebase = false) {
    const active = gesture.current;
    if (!active || !viewportSize) return;
    const touches = touchGeometry(nativeEvent.touches, active.target);
    if (!touches) {
      active.start = null;
      return;
    }

    const start = active.start;
    if (rebase || !start || start.touches.first !== touches.first || start.touches.second !== touches.second) {
      const reframe = currentReframe.current;
      active.start = { touches, reframe, crop: getClipCrop(clip, canvas, reframe) };
      return;
    }

    const initial = start.reframe;
    const zoom = start.touches.distance
      ? clamp((initial.zoom * touches.distance) / start.touches.distance, defaultClipReframe.zoom, maxClipReframeZoom)
      : initial.zoom;
    const nextCrop = getClipCrop(clip, canvas, { ...initial, zoom });
    update({
      zoom,
      x: movePlacement(
        initial.x,
        start.crop.width,
        nextCrop.width,
        start.touches.x / viewportSize.width,
        touches.x / viewportSize.width,
      ),
      y: movePlacement(
        initial.y,
        start.crop.height,
        nextCrop.height,
        start.touches.y / viewportSize.height,
        touches.y / viewportSize.height,
      ),
    });
  }

  function finishGesture() {
    gesture.current = null;
    setGesturing(false);
  }

  function apply() {
    if (gesture.current) return;
    try {
      onApply(currentReframe.current);
    } catch (cause) {
      setError(errorMessage("Couldn’t apply the framing.", cause));
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <Screen title={title} scrollEnabled={!gesturing}>
        <ClipPreview
          canvas={canvas}
          source={preview.source}
          suspended={false}
          viewport={{
            maxWidth: 180,
            props: {
              testID: `reframe-preview-${id}`,
              pointerEvents: "box-only",
              onLayout: ({ nativeEvent: { layout } }) => {
                if (layout.width > 0 && layout.height > 0)
                  setViewportSize({ width: layout.width, height: layout.height });
              },
              onStartShouldSetResponder: () => true,
              onResponderGrant: (event) => {
                gesture.current = { target: event.nativeEvent.target, start: null };
                setGesturing(true);
                moveGesture(event);
              },
              onResponderStart: (event) => moveGesture(event, true),
              onResponderMove: moveGesture,
              onResponderEnd: (event) => moveGesture(event, true),
              onResponderTerminationRequest: () => false,
              onResponderRelease: finishGesture,
              onResponderTerminate: finishGesture,
            },
            videoStyle: {
              position: "absolute",
              top: 0,
              left: 0,
              width: preview.width,
              height: preview.height,
              opacity: viewportSize ? 1 : 0,
              transformOrigin: "left top",
              transform: [
                { translateX: left * displayX },
                { translateY: top * displayY },
                // Correct for rounding the native render size to even dimensions.
                { scaleX: (clip.width * scaleX * displayX) / preview.width },
                { scaleY: (clip.height * scaleY * displayY) / preview.height },
              ],
            },
          }}
        />
        <View>
          <Text style={textStyles.muted}>Drag to move the video. Pinch to zoom.</Text>
          <FramingSlider
            testID={`reframe-zoom-${id}`}
            label="Zoom"
            value={(reframe.zoom - defaultClipReframe.zoom) / zoomRange}
            valueLabel={`${reframe.zoom.toFixed(2)}×`}
            onChange={(value) =>
              update({ ...currentReframe.current, zoom: defaultClipReframe.zoom + value * zoomRange })
            }
          />
          <FramingSlider
            testID={`reframe-horizontal-${id}`}
            label="Horizontal position"
            value={reframe.x}
            valueLabel={percent(reframe.x)}
            disabled={crop.width === 1}
            onChange={(x) => update({ ...currentReframe.current, x })}
          />
          <FramingSlider
            testID={`reframe-vertical-${id}`}
            label="Vertical position"
            value={reframe.y}
            valueLabel={percent(reframe.y)}
            disabled={crop.height === 1}
            onChange={(y) => update({ ...currentReframe.current, y })}
          />
        </View>
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Reset" testID={`reframe-reset-${id}`} onPress={() => update(defaultClipReframe)} />
          <Action label="Cancel" testID={`reframe-cancel-${id}`} onPress={onCancel} />
          <Action label="Apply" testID={`reframe-apply-${id}`} onPress={apply} disabled={gesturing} primary />
        </View>
      </Screen>
    </Modal>
  );
}

function FramingSlider({
  testID,
  label,
  value,
  valueLabel,
  disabled = false,
  onChange,
}: {
  testID: string;
  label: string;
  value: number;
  valueLabel: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.control}>
      <View style={styles.controlLabel} accessibilityElementsHidden>
        <Text style={textStyles.body}>{label}</Text>
        <Text style={styles.value}>{valueLabel}</Text>
      </View>
      <View
        accessible
        style={styles.sliderControl}
        testID={testID}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        accessibilityValue={{ text: disabled ? "No room to move at this zoom" : valueLabel }}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (disabled) return;
          if (actionName === "increment") onChange(clamp(value + 0.05, 0, 1));
          if (actionName === "decrement") onChange(clamp(value - 0.05, 0, 1));
        }}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Slider
            accessible={false}
            disabled={disabled}
            value={value}
            minimumTrackTintColor={darkColors.accent}
            maximumTrackTintColor={darkColors.border}
            thumbTintColor={darkColors.text}
            style={styles.slider}
            tapToSeek={!disabled}
            onValueChange={onChange}
            onSlidingComplete={onChange}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  control: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] },
  controlLabel: { flexBasis: 132, flexShrink: 1 },
  value: { ...textStyles.muted, fontVariant: ["tabular-nums"] },
  sliderControl: { flex: 1, minWidth: 90 },
  slider: { height: 44 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
