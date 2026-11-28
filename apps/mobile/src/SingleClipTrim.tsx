import { frameToUs } from "@stackreel/core";
import { darkColors, fontSize, MIN_HIT_TARGET, radius, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { SingleClipFilmstrip } from "./SingleClipFilmstrip";
import { trimTimeLabel } from "./TemplateTrim";
import { canvas, getClipFrameRange } from "./clip-source";
import type { ClipFrameRange } from "./clip-source";
import { createSingleClipSource } from "./single-clip-draft";
import type { SingleClip } from "./single-clip-draft";

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
  clip: SingleClip;
  onApply: (selection: ClipFrameRange) => void;
  onCancel: () => void;
}) {
  const bounds = useMemo(() => getClipFrameRange(clip.media), [clip.media]);
  const [selection, setSelection] = useState(clip.selection);
  const current = useRef(clip.selection);
  const [drag, setDrag] = useState<{ boundary: Boundary; frame: number } | null>(null);
  const sliding = useRef(false);
  const [previewEnd, setPreviewEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const shown = drag ? { ...selection, [drag.boundary]: drag.frame } : selection;
  const previewSource = useMemo(() => createSingleClipSource({ ...clip, selection }), [clip, selection]);

  function select(next: ClipFrameRange, boundary?: Boundary) {
    setPreviewEnd(boundary === "endFrame");
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
    if (next !== range[boundary]) select({ ...range, [boundary]: next }, boundary);
  }

  const resetDisabled =
    drag !== null || (selection.startFrame === bounds.startFrame && selection.endFrame === bounds.endFrame);

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
        title={null}
        scrollEnabled={drag === null}
        footer={
          <View style={styles.actions}>
            <Action label="Cancel" testID="single-trim-cancel" onPress={onCancel} />
            <Action label="Apply trim" testID="single-trim-apply" onPress={apply} disabled={drag !== null} primary />
          </View>
        }
      >
        <View>
          <Text accessibilityRole="header" style={textStyles.heading}>
            Trim clip
          </Text>
          <Text numberOfLines={1} style={textStyles.muted}>
            {clip.name}
          </Text>
        </View>
        <ClipPreview
          key={previewSource}
          canvas={canvas}
          source={previewSource}
          trimEndStillUs={previewEnd ? frameToUs(selection.endFrame - selection.startFrame - 1, canvas.fps) : undefined}
          suspended={drag !== null}
          viewport={{ maxWidth: 152, props: { testID: "single-trim-preview" }, videoStyle: StyleSheet.absoluteFill }}
        />
        <View style={styles.editor}>
          <View style={styles.summary}>
            <Text style={styles.duration} testID="single-trim-duration">
              Duration {timeAtFrame(shown.endFrame - shown.startFrame)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset trim"
              testID="single-trim-reset"
              disabled={resetDisabled}
              accessibilityState={{ disabled: resetDisabled }}
              onPress={() => select(bounds)}
              style={({ pressed }) => [styles.reset, (resetDisabled || pressed) && styles.dimmed]}
            >
              <Text style={styles.resetLabel}>Reset trim</Text>
            </Pressable>
          </View>
          <SingleClipFilmstrip
            uri={clip.uri}
            bounds={bounds}
            selection={shown}
            activeBoundary={drag?.boundary}
            onDrag={(boundary, frame) => {
              sliding.current = true;
              setDrag({ boundary, frame });
            }}
            onRelease={(boundary, frame) => {
              if (frame !== null) setBoundary(boundary, frame);
              sliding.current = false;
              setDrag(null);
            }}
          />
          <View style={styles.precision}>
            {boundaries.map((boundary) => {
              const isStart = boundary === "startFrame";
              const id = isStart ? "start" : "end";
              const frame = shown[boundary];
              const { min, max } = limits(boundary, selection);
              const disabled = drag !== null || min === max;
              function nudge(delta: number) {
                if (!sliding.current) setBoundary(boundary, current.current[boundary] + delta);
              }
              return (
                <View key={boundary} style={[styles.endpoint, { flexBasis: 130 * Math.max(1, fontScale) }]}>
                  <View
                    accessible
                    testID={`single-trim-${id}-adjustable`}
                    accessibilityRole="adjustable"
                    accessibilityLabel={`Trim ${id}`}
                    accessibilityValue={{ min, max, now: frame, text: timeAtFrame(frame) }}
                    accessibilityState={{ disabled }}
                    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                    onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                      if (disabled) return;
                      if (actionName === "increment") nudge(1);
                      if (actionName === "decrement") nudge(-1);
                    }}
                    style={styles.readout}
                  >
                    <Text style={styles.boundary}>{isStart ? "In" : "Out"}</Text>
                    <Text style={styles.time} testID={`single-trim-${id}-time`}>
                      {timeAtFrame(frame)}
                    </Text>
                  </View>
                  <View style={styles.stepper}>
                    {([-1, 1] as const).map((delta) => {
                      const direction = delta < 0 ? "earlier" : "later";
                      const atLimit = delta < 0 ? frame <= min : frame >= max;
                      return (
                        <Pressable
                          key={direction}
                          accessibilityRole="button"
                          accessibilityLabel={`Move trim ${id} one frame ${direction}`}
                          accessibilityState={{ disabled: drag !== null || atLimit }}
                          testID={`single-trim-${id}-${direction}`}
                          disabled={drag !== null || atLimit}
                          onPress={() => nudge(delta)}
                          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                        >
                          <Text style={[styles.stepLabel, (drag !== null || atLimit) && styles.dimmed]}>
                            {delta < 0 ? "−1f" : "+1f"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
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
  editor: {
    gap: space[2],
    backgroundColor: darkColors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingBottom: space[3],
  },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space[2],
  },
  duration: { ...textStyles.body, fontWeight: "600", fontVariant: ["tabular-nums"] },
  reset: { minHeight: MIN_HIT_TARGET, justifyContent: "center", paddingHorizontal: space[1] },
  resetLabel: { color: darkColors.text, fontSize: fontSize.sm, fontWeight: "600" },
  precision: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  endpoint: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
    borderColor: darkColors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  readout: {
    minHeight: MIN_HIT_TARGET,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space[1],
    paddingHorizontal: space[2],
  },
  boundary: textStyles.muted,
  time: { ...textStyles.body, fontWeight: "600", fontVariant: ["tabular-nums"] },
  stepper: { flexDirection: "row", gap: StyleSheet.hairlineWidth, backgroundColor: darkColors.border },
  step: {
    flex: 1,
    minHeight: MIN_HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.elevated,
  },
  stepLabel: { color: darkColors.text, fontSize: fontSize.sm, fontWeight: "600" },
  pressed: { backgroundColor: darkColors.border },
  dimmed: { opacity: 0.5 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[5],
  },
});
