import Slider from "@react-native-community/slider";
import { frameToUs } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { trimTimeLabel } from "./TemplateTrim";
import { canvas, createTrimmedClipSource, getClipFrameRange } from "./clip-source";
import type { ClipFrameRange, ClipMetadata } from "./clip-source";

const boundaries = ["startFrame", "endFrame"] as const;
type Boundary = (typeof boundaries)[number];

function timeAtFrame(frame: number) {
  return trimTimeLabel(frameToUs(frame, canvas.fps));
}

export function SingleClipTrim({
  clip,
  onApply,
  onCancel,
}: {
  clip: { name: string; uri: string; media: ClipMetadata; selection: ClipFrameRange };
  onApply: (selection: ClipFrameRange) => void;
  onCancel: () => void;
}) {
  const bounds = useMemo(() => getClipFrameRange(clip.media), [clip.media]);
  const [selection, setSelection] = useState(clip.selection);
  const current = useRef(clip.selection);
  const [drag, setDrag] = useState<{ boundary: Boundary; frame: number } | null>(null);
  const sliding = useRef<Boundary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = drag ? { ...selection, [drag.boundary]: drag.frame } : selection;
  const previewSource = useMemo(() => createTrimmedClipSource(clip.uri, clip.media, selection), [clip, selection]);

  function select(next: ClipFrameRange) {
    current.current = next;
    setSelection(next);
  }

  function limits(boundary: Boundary, range: ClipFrameRange) {
    return boundary === "startFrame"
      ? { min: bounds.startFrame, max: range.endFrame - 1 }
      : { min: range.startFrame + 1, max: bounds.endFrame };
  }

  function setBoundary(boundary: Boundary, frame: number) {
    const range = current.current;
    const { min, max } = limits(boundary, range);
    const next = Math.max(min, Math.min(frame, max));
    if (next !== range[boundary]) select({ ...range, [boundary]: next });
  }

  function apply() {
    if (sliding.current) return;
    try {
      onApply(current.current);
    } catch (cause) {
      setError(errorMessage("Couldn’t apply the trim.", cause));
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen
        title="Trim clip"
        scrollEnabled={drag === null}
        footer={
          <View style={styles.actions}>
            <Action label="Cancel" testID="single-trim-cancel" onPress={onCancel} />
            <Action label="Apply trim" testID="single-trim-apply" onPress={apply} disabled={drag !== null} primary />
          </View>
        }
      >
        <Text numberOfLines={1} style={textStyles.muted}>
          {clip.name}
        </Text>
        {boundaries.map((boundary) => {
          const isStart = boundary === "startFrame";
          const title = isStart ? "Start" : "End";
          const id = isStart ? "start" : "end";
          const frame = shown[boundary];
          const { min, max } = limits(boundary, selection);
          const maxOffset = max - min;
          const sliderDisabled = maxOffset === 0 || (drag !== null && drag.boundary !== boundary);
          const frameAtOffset = (offset: number) => min + Math.max(0, Math.min(maxOffset, Math.round(offset)));
          return (
            <View key={boundary}>
              <Text style={styles.time} testID={`single-trim-${id}-time`}>
                {title} {timeAtFrame(frame)}
              </Text>
              <View style={styles.controls}>
                <Action
                  label="−1f"
                  accessibilityLabel={`Move trim ${id} one frame earlier`}
                  testID={`single-trim-${id}-earlier`}
                  disabled={drag !== null || frame <= min}
                  onPress={() => setBoundary(boundary, current.current[boundary] - 1)}
                />
                <View
                  style={styles.sliderControl}
                  accessible
                  testID={`single-trim-${id}-adjustable`}
                  accessibilityRole="adjustable"
                  accessibilityLabel={`Trim ${id}`}
                  accessibilityValue={{ min, max, now: frame, text: timeAtFrame(frame) }}
                  accessibilityState={{ disabled: sliderDisabled }}
                  accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                  onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                    if (sliding.current || sliderDisabled) return;
                    const frame = current.current[boundary];
                    if (actionName === "increment") setBoundary(boundary, frame + 1);
                    if (actionName === "decrement") setBoundary(boundary, frame - 1);
                  }}
                >
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Slider
                      accessible={false}
                      testID={`single-trim-${id}-slider`}
                      disabled={sliderDisabled}
                      value={selection[boundary] - min}
                      maximumValue={Math.max(1, maxOffset)}
                      // The slider builds an array of steps. Snap long ranges on release instead.
                      step={maxOffset > 100 ? 0 : 1}
                      minimumTrackTintColor={darkColors.accent}
                      maximumTrackTintColor={darkColors.border}
                      thumbTintColor={darkColors.text}
                      style={styles.slider}
                      tapToSeek
                      onSlidingStart={(offset) => {
                        sliding.current = boundary;
                        setDrag({ boundary, frame: frameAtOffset(offset) });
                      }}
                      onValueChange={(offset) => {
                        const next = frameAtOffset(offset);
                        if (sliding.current === boundary) setDrag({ boundary, frame: next });
                        else if (sliding.current === null) setBoundary(boundary, next);
                      }}
                      onSlidingComplete={(offset) => {
                        setBoundary(boundary, frameAtOffset(offset));
                        sliding.current = null;
                        setDrag(null);
                      }}
                    />
                  </View>
                </View>
                <Action
                  label="+1f"
                  accessibilityLabel={`Move trim ${id} one frame later`}
                  testID={`single-trim-${id}-later`}
                  disabled={drag !== null || frame >= max}
                  onPress={() => setBoundary(boundary, current.current[boundary] + 1)}
                />
              </View>
            </View>
          );
        })}
        <View style={styles.summary}>
          <Text style={styles.time} testID="single-trim-duration">
            Duration {timeAtFrame(shown.endFrame - shown.startFrame)}
          </Text>
          <Action
            label="Reset trim"
            testID="single-trim-reset"
            disabled={
              drag !== null || (selection.startFrame === bounds.startFrame && selection.endFrame === bounds.endFrame)
            }
            onPress={() => select(bounds)}
          />
        </View>
        <ClipPreview
          key={previewSource}
          canvas={canvas}
          source={previewSource}
          suspended={drag !== null}
          viewport={{ maxWidth: 160, props: { testID: "single-trim-preview" }, videoStyle: StyleSheet.absoluteFill }}
        />
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  time: { ...textStyles.body, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2] },
  sliderControl: { flex: 1 },
  slider: { height: 44 },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[5],
  },
});
