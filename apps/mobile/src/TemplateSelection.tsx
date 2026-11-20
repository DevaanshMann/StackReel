import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Action, textStyles } from "./Screen";
import { getVideoSlots, mobileTemplates } from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";

const choices = mobileTemplates.map((template) => ({ template, slots: getVideoSlots(template) }));

export function TemplateGallery({
  onSelectTemplate,
  onSelectSingleClip,
}: {
  onSelectTemplate: (template: MobileTemplate, slots: TemplateVideoSlot[]) => void;
  onSelectSingleClip: () => void;
}) {
  return (
    <>
      <Text accessibilityRole="header" style={textStyles.heading}>
        Templates
      </Text>
      <View style={styles.list}>
        {choices.map(({ template, slots }) => (
          <GalleryCard
            key={template.id}
            label={template.name}
            details={`${slots.length} videos · ${secondsLabel(template.durationUs)}`}
            description={template.description}
            onPress={() => onSelectTemplate(template, slots)}
          />
        ))}
      </View>
      <GalleryCard label="Single-clip editor" details="Preview and export one video" onPress={onSelectSingleClip} />
    </>
  );
}

function GalleryCard({
  label,
  details,
  description,
  onPress,
}: {
  label: string;
  details: string;
  description?: string | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`${details}.${description ? ` ${description}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.panel, styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{label}</Text>
        <Text style={styles.cardDetails}>{details}</Text>
        {description && <Text style={textStyles.muted}>{description}</Text>}
      </View>
      <Text accessible={false} accessibilityElementsHidden style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

export function TemplateVideoSlots({
  slots,
  clips,
  busy,
  importingSlotId,
  importError,
  onSelect,
}: {
  slots: readonly TemplateVideoSlot[];
  clips: Readonly<Record<string, TemplateClip>>;
  busy: boolean;
  importingSlotId: string | undefined;
  importError: { slotId?: string; message: string } | null;
  onSelect: (slot: TemplateVideoSlot) => void;
}) {
  const nextSlot = slots.find((slot) => !clips[slot.id]);
  return (
    <View style={styles.list}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Required videos
      </Text>
      {slots.map((slot) => {
        const clip = clips[slot.id];
        const importing = importingSlotId === slot.id;
        const label = clip ? "Replace video" : "Choose video";
        return (
          <View key={slot.id} style={[styles.panel, styles.slot]}>
            <View style={styles.slotBody}>
              <View style={styles.slotCopy}>
                <Text accessibilityRole="header" style={styles.slotTitle}>
                  {slot.label}
                </Text>
                <Text style={textStyles.muted}>At least {secondsLabel(slot.minDurationUs)}</Text>
                {clip && (
                  <Text numberOfLines={1} style={textStyles.body}>
                    {clip.name}
                  </Text>
                )}
              </View>
              <View style={styles.slotAction}>
                <Action
                  label={importing ? "Opening video…" : label}
                  accessibilityLabel={`${importing ? "Opening Files" : label} for ${slot.label}`}
                  onPress={() => onSelect(slot)}
                  disabled={busy}
                  primary={slot === nextSlot}
                />
              </View>
            </View>
            {importError?.slotId === slot.id && (
              <Text accessibilityRole="alert" style={textStyles.error}>
                {importError.message}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function secondsLabel(microseconds: number) {
  return `${Number((microseconds / 1_000_000).toFixed(2))} s`;
}

const styles = StyleSheet.create({
  list: { gap: space[2] },
  panel: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
  },
  cardCopy: { flex: 1, gap: space[1] },
  cardTitle: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700" },
  cardDetails: { color: darkColors.accent, fontSize: fontSize.sm, fontWeight: "600" },
  chevron: { color: darkColors.textMuted, fontSize: fontSize.xl },
  pressed: { backgroundColor: darkColors.elevated },
  slot: { padding: space[3], gap: space[2] },
  slotBody: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  slotCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 136, gap: space[1] },
  slotAction: { maxWidth: "100%" },
  slotTitle: { color: darkColors.text, fontSize: fontSize.md, fontWeight: "700" },
});
