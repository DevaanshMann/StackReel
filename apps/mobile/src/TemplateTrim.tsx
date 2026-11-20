import Slider from "@react-native-community/slider";
import { frameToUs, US_PER_SECOND } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { canvas, createClipSource } from "./clip-source";
import { getTemplateTrimWindow, setTemplateClipTrim } from "./template-editor";
import type { TemplateClip, TemplateVideoSlot } from "./template-editor";

export function trimTimeLabel(microseconds: number) {
  return `${(microseconds / US_PER_SECOND).toFixed(2)} s`;
}

export function TemplateTrim({
  slot,
  clip,
  onApply,
  onCancel,
}: {
  slot: TemplateVideoSlot;
  clip: TemplateClip;
  onApply: (startFrame: number) => void;
  onCancel: () => void;
}) {
  const window = getTemplateTrimWindow(slot, clip);
  const [startFrame, setStartFrame] = useState(window.startFrame);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sliding = useRef(false);
  const lastOffset = window.lastStartFrame - window.firstFrame;
  const canAdjust = lastOffset > 0;
  const selectedFrame = dragFrame ?? startFrame;
  const startTime = trimTimeLabel(frameToUs(selectedFrame, canvas.fps));
  const endTime = trimTimeLabel(frameToUs(selectedFrame + window.durationFrames, canvas.fps));
  const duration = trimTimeLabel(frameToUs(window.durationFrames, canvas.fps));

  const previewSource = useMemo(() => {
    const { uri, width, height, trimInUs, trimOutUs } = setTemplateClipTrim(slot, clip, startFrame);
    return createClipSource(uri, { width, height, startUs: trimInUs, durationUs: trimOutUs - trimInUs });
  }, [slot, clip, startFrame]);

  function frameForOffset(offset: number) {
    return window.firstFrame + Math.min(lastOffset, Math.max(0, Math.round(offset)));
  }

  function apply() {
    if (sliding.current) return;
    try {
      onApply(startFrame);
    } catch (cause) {
      setError(errorMessage("Couldn’t apply the trim.", cause));
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen title={`Trim ${slot.label}`}>
        <View style={styles.adjustment}>
          <Text numberOfLines={1} style={textStyles.body}>
            {clip.name}
          </Text>
          <Text style={textStyles.muted}>{duration} window on the source video</Text>
          <View style={styles.times}>
            <Text style={styles.time}>Start {startTime}</Text>
            <Text style={styles.time}>End {endTime}</Text>
          </View>
          <Slider
            testID={`trim-start-${slot.id}`}
            accessibilityLabel={`Trim start for ${slot.label}`}
            accessibilityValue={{ text: `Start ${startTime}, end ${endTime}` }}
            disabled={!canAdjust}
            maximumValue={Math.max(1, lastOffset)}
            value={startFrame - window.firstFrame}
            step={1}
            minimumTrackTintColor={darkColors.accent}
            maximumTrackTintColor={darkColors.border}
            thumbTintColor={darkColors.text}
            style={styles.slider}
            tapToSeek={canAdjust}
            onSlidingStart={(offset) => {
              sliding.current = true;
              setDragFrame(frameForOffset(offset));
            }}
            onValueChange={(offset) => {
              const frame = frameForOffset(offset);
              if (sliding.current) setDragFrame(frame);
              else setStartFrame(frame);
            }}
            onSlidingComplete={(offset) => {
              sliding.current = false;
              setStartFrame(frameForOffset(offset));
              setDragFrame(null);
            }}
          />
          {!canAdjust && <Text style={textStyles.muted}>This video has no room to move the trim window.</Text>}
        </View>
        <ClipPreview key={previewSource} canvas={canvas} source={previewSource} suspended={dragFrame !== null} />
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Cancel" onPress={onCancel} />
          <Action label="Apply trim" onPress={apply} disabled={dragFrame !== null} primary />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  adjustment: { gap: space[1] },
  times: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[2] },
  time: { ...textStyles.body, fontVariant: ["tabular-nums"] },
  slider: { height: 44 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
