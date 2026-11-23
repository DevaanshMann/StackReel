import Slider from "@react-native-community/slider";
import { frameToUs, US_PER_SECOND } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { TrimFilmstrip } from "./TrimFilmstrip";
import { canvas, createClipSource } from "./clip-source";
import { getTemplateTrimWindow, setTemplateClipTrim } from "./template-editor";
import type { TemplateClip, TemplateVideoSlot } from "./template-editor";

export function trimTimeLabel(microseconds: number) {
  return `${(microseconds / US_PER_SECOND).toFixed(2)} s`;
}

export function TemplateTrim({
  slot,
  clip,
  previewGainDb,
  onApply,
  onCancel,
}: {
  slot: TemplateVideoSlot;
  clip: TemplateClip;
  previewGainDb: number;
  onApply: (startFrame: number) => void;
  onCancel: () => void;
}) {
  const window = getTemplateTrimWindow(slot, clip);
  const [startFrame, setStartFrame] = useState(window.startFrame);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sliding = useRef<"strip" | "slider" | null>(null);
  const lastOffset = window.lastStartFrame - window.firstFrame;
  const canAdjust = lastOffset > 0;
  const selectedFrame = dragFrame ?? startFrame;
  const startTime = trimTimeLabel(frameToUs(selectedFrame, canvas.fps));
  const endTime = trimTimeLabel(frameToUs(selectedFrame + window.durationFrames, canvas.fps));
  const duration = trimTimeLabel(frameToUs(window.durationFrames, canvas.fps));

  const previewSource = useMemo(() => {
    const { uri, width, height, trimInUs, trimOutUs } = setTemplateClipTrim(slot, clip, startFrame);
    return createClipSource(
      uri,
      { width, height, startUs: trimInUs, durationUs: trimOutUs - trimInUs },
      canvas,
      "contain",
      previewGainDb,
    );
  }, [slot, clip, startFrame, previewGainDb]);

  function frameForOffset(offset: number) {
    return window.firstFrame + Math.min(lastOffset, Math.max(0, Math.round(offset)));
  }

  function finishDrag(frame: number | null) {
    sliding.current = null;
    if (frame !== null) setStartFrame(frame);
    setDragFrame(null);
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
      <Screen title={`Trim ${slot.label}`} scrollEnabled={dragFrame === null}>
        <View style={styles.adjustment}>
          <Text numberOfLines={1} style={textStyles.body}>
            {clip.name}
          </Text>
          <Text style={textStyles.muted}>
            {canAdjust ? `Drag the ${duration} window to choose a start.` : `${duration} window on the source video`}
          </Text>
          <View style={styles.times}>
            <Text style={styles.time}>Start {startTime}</Text>
            <Text style={styles.time}>End {endTime}</Text>
          </View>
          <TrimFilmstrip
            key={JSON.stringify([clip.uri, window.firstFrame, window.sourceEndFrame])}
            slotId={slot.id}
            uri={clip.uri}
            bounds={window}
            selectedFrame={selectedFrame}
            onDrag={(frame) => {
              sliding.current = "strip";
              setDragFrame(frame);
            }}
            onRelease={finishDrag}
          />
          <View style={styles.controls}>
            <Action
              label="−1f"
              accessibilityLabel="Move trim one frame earlier"
              testID={`trim-earlier-${slot.id}`}
              disabled={dragFrame !== null || startFrame <= window.firstFrame}
              onPress={() => setStartFrame((frame) => Math.max(window.firstFrame, frame - 1))}
            />
            <Slider
              testID={`trim-start-${slot.id}`}
              accessibilityRole="adjustable"
              accessibilityLabel={`Trim start for ${slot.label}`}
              accessibilityValue={{ text: `Start ${startTime}, end ${endTime}` }}
              disabled={!canAdjust || sliding.current === "strip"}
              maximumValue={Math.max(1, lastOffset)}
              value={(sliding.current === "strip" ? selectedFrame : startFrame) - window.firstFrame}
              // The slider allocates one marker per step even with markers hidden.
              // On long clips, snap its continuous values in frameForOffset instead.
              step={lastOffset > 1000 ? 0 : 1}
              minimumTrackTintColor={darkColors.accent}
              maximumTrackTintColor={darkColors.border}
              thumbTintColor={darkColors.text}
              style={styles.slider}
              tapToSeek={canAdjust}
              onSlidingStart={(offset) => {
                sliding.current = "slider";
                setDragFrame(frameForOffset(offset));
              }}
              onValueChange={(offset) => {
                const frame = frameForOffset(offset);
                if (sliding.current === "slider") setDragFrame(frame);
                else if (sliding.current === null) setStartFrame(frame);
              }}
              onSlidingComplete={(offset) => finishDrag(frameForOffset(offset))}
            />
            <Action
              label="+1f"
              accessibilityLabel="Move trim one frame later"
              testID={`trim-later-${slot.id}`}
              disabled={dragFrame !== null || startFrame >= window.lastStartFrame}
              onPress={() => setStartFrame((frame) => Math.min(window.lastStartFrame, frame + 1))}
            />
          </View>
          {!canAdjust && <Text style={textStyles.muted}>This video has no room to move the trim window.</Text>}
        </View>
        <ClipPreview key={previewSource} canvas={canvas} source={previewSource} suspended={dragFrame !== null} />
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Cancel" testID={`trim-cancel-${slot.id}`} onPress={onCancel} />
          <Action
            label="Apply trim"
            testID={`trim-apply-${slot.id}`}
            onPress={apply}
            disabled={dragFrame !== null}
            primary
          />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  adjustment: { gap: space[1] },
  times: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[2] },
  time: { ...textStyles.body, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2] },
  slider: { flex: 1, height: 44 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
