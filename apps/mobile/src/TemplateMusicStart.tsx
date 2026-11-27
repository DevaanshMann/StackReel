import Slider from "@react-native-community/slider";
import { frameToUs } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { trimTimeLabel } from "./TemplateTrim";
import { getTemplateMusicStartRange } from "./template-editor";
import type { MobileTemplate, TemplateMusic } from "./template-editor";

export function TemplateMusicStart({
  music,
  reelDurationUs,
  canvas,
  createPreview,
  onApply,
  onCancel,
}: {
  music: TemplateMusic;
  reelDurationUs: number;
  canvas: MobileTemplate["canvas"];
  createPreview: (startFrame: number) => string | null;
  onApply: (startFrame: number) => void;
  onCancel: () => void;
}) {
  const { startFrame, maxFrame } = getTemplateMusicStartRange(music, reelDurationUs);
  const [selection, setSelection] = useState(startFrame);
  const currentFrame = useRef(startFrame);
  const sliding = useRef(false);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = dragFrame ?? selection;
  const time = trimTimeLabel(frameToUs(shown, 30));
  const previewSource = useMemo(() => createPreview(selection), [createPreview, selection]);

  function clampFrame(value: number) {
    return Math.max(0, Math.min(maxFrame, Math.round(value)));
  }

  function select(value: number) {
    currentFrame.current = clampFrame(value);
    setSelection(currentFrame.current);
  }

  function apply() {
    if (sliding.current) return;
    try {
      onApply(currentFrame.current);
    } catch (cause) {
      setError(errorMessage("Couldn’t apply the music start.", cause));
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen
        title="Music start"
        scrollEnabled={dragFrame === null}
        footer={
          <View style={styles.actions}>
            <Action label="Cancel" testID="music-start-cancel" onPress={onCancel} />
            <Action
              label="Apply start"
              testID="music-start-apply"
              onPress={apply}
              disabled={dragFrame !== null}
              primary
            />
          </View>
        }
      >
        <Text numberOfLines={1} style={textStyles.body}>
          {music.name}
        </Text>
        {maxFrame > 0 ? (
          <View style={styles.adjustment}>
            <Text style={textStyles.muted}>Choose where in the track your reel begins.</Text>
            <View style={styles.summary}>
              <Text testID="music-start-time" style={styles.time}>
                Start {time}
              </Text>
              <Action
                label="Reset start"
                testID="music-start-reset"
                onPress={() => select(0)}
                disabled={dragFrame !== null || selection === 0}
              />
            </View>
            <View style={styles.controls}>
              <Action
                label="−1f"
                accessibilityLabel="Move music start one frame earlier"
                testID="music-start-earlier"
                onPress={() => select(currentFrame.current - 1)}
                disabled={dragFrame !== null || selection === 0}
              />
              <View
                style={styles.sliderControl}
                accessible
                testID="music-start-adjustable"
                accessibilityRole="adjustable"
                accessibilityLabel="Music start"
                accessibilityHint="Adjusts by one second."
                accessibilityValue={{ min: 0, max: maxFrame, now: shown, text: time }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                  if (sliding.current) return;
                  if (actionName === "increment") select(currentFrame.current + 30);
                  if (actionName === "decrement") select(currentFrame.current - 30);
                }}
              >
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Slider
                    testID="music-start-slider"
                    accessible={false}
                    maximumValue={maxFrame}
                    value={selection}
                    // Long songs can have thousands of frames. A continuous slider avoids allocating a marker per frame.
                    step={maxFrame > 100 ? 0 : 1}
                    minimumTrackTintColor={darkColors.accent}
                    maximumTrackTintColor={darkColors.border}
                    thumbTintColor={darkColors.text}
                    style={styles.slider}
                    tapToSeek
                    onSlidingStart={(value) => {
                      sliding.current = true;
                      setDragFrame(clampFrame(value));
                    }}
                    onValueChange={(value) => {
                      if (sliding.current) setDragFrame(clampFrame(value));
                      else select(value);
                    }}
                    onSlidingComplete={(value) => {
                      sliding.current = false;
                      select(value);
                      setDragFrame(null);
                    }}
                  />
                </View>
              </View>
              <Action
                label="+1f"
                accessibilityLabel="Move music start one frame later"
                testID="music-start-later"
                onPress={() => select(currentFrame.current + 1)}
                disabled={dragFrame !== null || selection === maxFrame}
              />
            </View>
          </View>
        ) : (
          <Text style={textStyles.muted}>
            The reel uses this track from its beginning. Choose a longer track to move the start.
          </Text>
        )}
        {previewSource ? (
          <ClipPreview
            key={previewSource}
            source={previewSource}
            canvas={canvas}
            suspended={dragFrame !== null}
            viewport={{ maxWidth: 176, props: { testID: "music-start-preview" }, videoStyle: StyleSheet.absoluteFill }}
          />
        ) : (
          <Text style={textStyles.muted}>Add all required videos to preview the mix.</Text>
        )}
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
  adjustment: { gap: space[2] },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  time: { ...textStyles.body, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2] },
  sliderControl: { flex: 1 },
  slider: { height: 44 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[5],
  },
});
