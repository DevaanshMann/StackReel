import Slider from "@react-native-community/slider";
import { PLAN_DEFAULTS } from "@stackreel/core";
import { darkColors, space } from "@stackreel/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { ClipPreview, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { createClipSource } from "./clip-source";
import { getTemplateGainDb } from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";

export function TemplateVolume({
  slot,
  clip,
  canvas,
  templateGainDb,
  onApply,
  onCancel,
}: {
  slot: TemplateVideoSlot;
  clip: TemplateClip;
  canvas: MobileTemplate["canvas"];
  templateGainDb: number | undefined;
  onApply: (percent: number) => void;
  onCancel: () => void;
}) {
  function createPreview(volumePercent: number) {
    const { uri, width, height, trimInUs, trimOutUs } = clip;
    return createClipSource(
      uri,
      { width, height, startUs: trimInUs, durationUs: trimOutUs - trimInUs },
      { ...canvas, background: canvas.background ?? PLAN_DEFAULTS.background },
      "contain",
      getTemplateGainDb(volumePercent, templateGainDb),
    );
  }

  return (
    <VolumeSheet
      id={slot.id}
      title={`Volume for ${slot.label}`}
      filename={clip.name}
      levelLabel="Original audio"
      accessibilitySubject={`original audio for ${slot.label}`}
      sliderLabel={`Original audio volume for ${slot.label}`}
      initialVolume={clip.volumePercent ?? 100}
      canvas={canvas}
      createPreview={createPreview}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

export function VolumeSheet({
  id,
  title,
  filename,
  levelLabel,
  accessibilitySubject,
  sliderLabel,
  initialVolume,
  canvas,
  createPreview,
  onApply,
  onCancel,
}: {
  id: string;
  title: string;
  filename: string;
  levelLabel: string;
  accessibilitySubject: string;
  sliderLabel: string;
  initialVolume: number;
  canvas: MobileTemplate["canvas"];
  createPreview: (percent: number) => string | null;
  onApply: (percent: number) => void;
  onCancel: () => void;
}) {
  const [volumePercent, setVolumePercent] = useState(initialVolume);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sliding = useRef(false);
  const currentVolumePercent = useRef(volumePercent);
  const lastAudiblePercent = useRef(volumePercent || 100);
  const visiblePercent = dragPercent ?? volumePercent;
  const muteLabel = visiblePercent === 0 ? "Unmute" : "Mute";

  const previewSource = useMemo(() => createPreview(volumePercent), [createPreview, volumePercent]);

  function updateVolume(percent: number) {
    currentVolumePercent.current = percent;
    if (percent > 0) lastAudiblePercent.current = percent;
    setVolumePercent(percent);
  }

  function apply() {
    if (sliding.current) return;
    try {
      onApply(currentVolumePercent.current);
    } catch (cause) {
      setError(errorMessage("Couldn’t apply the volume.", cause));
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen title={title}>
        <View style={styles.adjustment}>
          <Text numberOfLines={1} style={textStyles.muted}>
            {filename}
          </Text>
          <View style={styles.level} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={textStyles.body}>{levelLabel}</Text>
            <Text style={styles.percent} testID={`volume-percent-${id}`}>
              {visiblePercent}%
            </Text>
          </View>
          <View style={styles.sliderRow}>
            <View
              testID={`volume-adjustable-${id}`}
              style={styles.sliderControl}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={sliderLabel}
              accessibilityValue={{ min: 0, max: 100, now: visiblePercent, text: `${visiblePercent}%` }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                if (sliding.current) return;
                const percent = currentVolumePercent.current;
                if (actionName === "increment") updateVolume(Math.min(100, percent + 5));
                if (actionName === "decrement") updateVolume(Math.max(0, percent - 5));
              }}
            >
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Slider
                  testID={`volume-slider-${id}`}
                  accessible={false}
                  minimumValue={0}
                  maximumValue={100}
                  value={volumePercent}
                  step={1}
                  minimumTrackTintColor={darkColors.accent}
                  maximumTrackTintColor={darkColors.border}
                  thumbTintColor={darkColors.text}
                  style={styles.slider}
                  tapToSeek
                  onSlidingStart={(percent) => {
                    sliding.current = true;
                    setDragPercent(percent);
                  }}
                  onValueChange={(percent) => {
                    if (sliding.current) setDragPercent(percent);
                    else updateVolume(percent);
                  }}
                  onSlidingComplete={(percent) => {
                    sliding.current = false;
                    updateVolume(percent);
                    setDragPercent(null);
                  }}
                />
              </View>
            </View>
            <Action
              label={muteLabel}
              accessibilityLabel={`${muteLabel} ${accessibilitySubject}`}
              testID={`volume-mute-${id}`}
              onPress={() => updateVolume(volumePercent === 0 ? lastAudiblePercent.current : 0)}
              disabled={dragPercent !== null}
            />
          </View>
        </View>
        {previewSource ? (
          <ClipPreview
            key={previewSource}
            canvas={canvas}
            source={previewSource}
            suspended={dragPercent !== null}
            viewport={{
              maxWidth: 176,
              props: { testID: `volume-preview-${id}` },
              videoStyle: StyleSheet.absoluteFill,
            }}
          />
        ) : (
          <Text style={textStyles.muted}>Add all required videos to preview the mix.</Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Cancel" testID={`volume-cancel-${id}`} onPress={onCancel} />
          <Action
            label="Apply volume"
            testID={`volume-apply-${id}`}
            onPress={apply}
            disabled={dragPercent !== null}
            primary
          />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  adjustment: { gap: space[2] },
  level: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[2] },
  percent: { ...textStyles.body, fontVariant: ["tabular-nums"] },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  sliderControl: { flex: 1 },
  slider: { height: 44 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
