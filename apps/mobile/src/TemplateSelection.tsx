import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Action, textStyles } from "./Screen";
import { trimTimeLabel } from "./TemplateTrim";
import { VideoImportActions } from "./VideoImportActions";
import { getEmptyVideoSlots, getVideoSlots, mobileTemplates } from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";
import type { VideoPickerSource } from "./video-picker";

const choices = mobileTemplates.map((template) => ({ template, slots: getVideoSlots(template) }));
type SelectTemplate = (template: MobileTemplate, slots: TemplateVideoSlot[]) => void;
type ProjectDraft = {
  name?: string | null;
  clips: Readonly<Record<string, TemplateClip>>;
  missingSlots: readonly string[];
  missingMusic: boolean;
  loadError?: string;
};

export function TemplateGallery({
  onSelectTemplate,
  onSelectSingleClip,
}: {
  onSelectTemplate: SelectTemplate;
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

export function TemplateProjects({
  drafts,
  onSelectTemplate,
  onRenameDraft,
  onDeleteDraft,
  onBrowseTemplates,
}: {
  drafts: Readonly<Record<string, ProjectDraft>>;
  onSelectTemplate: SelectTemplate;
  onRenameDraft: (template: MobileTemplate) => void;
  onDeleteDraft: (template: MobileTemplate) => void;
  onBrowseTemplates: () => void;
}) {
  const projects = choices.flatMap(({ template, slots }) => {
    const draft = drafts[template.id];
    return draft ? [{ template, slots, draft }] : [];
  });

  return (
    <>
      <Text accessibilityRole="header" style={textStyles.heading}>
        Projects
      </Text>
      {projects.length === 0 ? (
        <View style={[styles.panel, styles.emptyProjects]}>
          <Text style={styles.cardTitle}>No saved drafts yet</Text>
          <Text style={textStyles.muted}>Make an edit in a template to start a draft.</Text>
          <Action label="Browse templates" onPress={onBrowseTemplates} />
        </View>
      ) : (
        <View style={styles.list}>
          {projects.map(({ template, slots, draft }) => {
            const name = draft.name ?? template.name;
            const filled = slots.filter(({ id }) => draft.clips[id]).length;
            const missingMedia = draft.missingSlots.length > 0 || draft.missingMusic;
            const progress = `${filled} of ${slots.length} videos`;
            const details = name === template.name ? progress : `${template.name} · ${progress}`;
            return (
              <GalleryCard
                key={template.id}
                label={name}
                details={draft.loadError ? "Couldn’t load draft" : details}
                description={missingMedia ? "Missing media" : undefined}
                onPress={() => onSelectTemplate(template, slots)}
                actions={
                  <>
                    {!draft.loadError && (
                      <Action
                        label="Rename"
                        accessibilityLabel={`Rename ${name} draft`}
                        onPress={() => onRenameDraft(template)}
                      />
                    )}
                    <Action
                      label="Delete"
                      accessibilityLabel={`Delete ${name} draft`}
                      onPress={() => onDeleteDraft(template)}
                    />
                  </>
                }
              />
            );
          })}
        </View>
      )}
    </>
  );
}

function GalleryCard({
  label,
  details,
  description,
  onPress,
  actions,
}: {
  label: string;
  details: string;
  description?: string | undefined;
  onPress: () => void;
  actions?: ReactNode;
}) {
  return (
    <View style={[styles.panel, styles.cardPanel]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={`${details}.${description ? ` ${description}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
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
      {actions && <View style={styles.cardActions}>{actions}</View>}
    </View>
  );
}

export function TemplateVideoSlots({
  slots,
  clips,
  missingSlots,
  busy,
  importingSlotId,
  importingFrom,
  importError,
  onSelect,
  onSelectOrdered,
  onTrim,
  onReframe,
}: {
  slots: readonly TemplateVideoSlot[];
  clips: Readonly<Record<string, TemplateClip>>;
  missingSlots: readonly string[];
  busy: boolean;
  importingSlotId: string | undefined;
  importingFrom: VideoPickerSource | undefined;
  importError: { slotId?: string; message: string } | null;
  onSelect: (slot: TemplateVideoSlot, source: VideoPickerSource) => void;
  onSelectOrdered: (slots: TemplateVideoSlot[]) => void;
  onTrim: (slot: TemplateVideoSlot) => void;
  onReframe: (slot: TemplateVideoSlot) => void;
}) {
  const emptySlots = getEmptyVideoSlots(slots, clips, missingSlots);
  const nextSlot = slots.find((slot) => !clips[slot.id]);
  return (
    <View style={styles.list}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Required videos
      </Text>
      {emptySlots.length >= 2 && (
        <View style={[styles.panel, styles.slot]}>
          <Text style={textStyles.body}>
            Pick in slot order · {emptySlots.map(({ label }, index) => `${index + 1}. ${label}`).join(" · ")}
          </Text>
          <Action
            label={
              importingFrom === "Photos" && importingSlotId === undefined
                ? "Importing from Photos…"
                : "Choose videos from Photos"
            }
            onPress={() => onSelectOrdered(emptySlots)}
            disabled={busy}
            primary
          />
        </View>
      )}
      {slots.map((slot) => {
        const clip = clips[slot.id];
        const missing = missingSlots.includes(slot.id);
        return (
          <View key={slot.id} style={[styles.panel, styles.slot]}>
            <View style={styles.slotCopy}>
              <Text accessibilityRole="header" style={styles.slotTitle}>
                {slot.label}
              </Text>
              <Text style={textStyles.muted}>At least {secondsLabel(slot.minDurationUs)}</Text>
              {clip && (
                <>
                  <Text numberOfLines={1} style={textStyles.body}>
                    {clip.name}
                  </Text>
                  <Text style={textStyles.muted}>
                    Source {trimTimeLabel(clip.trimInUs)} to {trimTimeLabel(clip.trimOutUs)}
                  </Text>
                </>
              )}
              {missing && (
                <Text accessibilityRole="alert" style={textStyles.error}>
                  Saved video is missing. Choose a replacement from Photos or Files.
                </Text>
              )}
            </View>
            <VideoImportActions
              replace={!!clip || missing}
              importingFrom={importingSlotId === slot.id ? importingFrom : undefined}
              busy={busy}
              primary={emptySlots.length < 2 && slot === nextSlot}
              slotLabel={slot.label}
              onSelect={(source) => onSelect(slot, source)}
            />
            {clip && (
              <View style={styles.slotAction}>
                <Action
                  label="Trim"
                  accessibilityLabel={`Trim ${slot.label}`}
                  onPress={() => onTrim(slot)}
                  disabled={busy}
                />
                <Action
                  label="Reframe"
                  accessibilityLabel={`Reframe ${slot.label}`}
                  testID={`reframe-${slot.id}`}
                  onPress={() => onReframe(slot)}
                  disabled={busy}
                />
              </View>
            )}
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
  cardPanel: { overflow: "hidden" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
  },
  cardCopy: { flex: 1, gap: space[1] },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space[2],
    borderTopColor: darkColors.border,
    borderTopWidth: 1,
    padding: space[2],
  },
  emptyProjects: { padding: space[4], gap: space[3] },
  cardTitle: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700" },
  cardDetails: { color: darkColors.accent, fontSize: fontSize.sm, fontWeight: "600" },
  chevron: { color: darkColors.textMuted, fontSize: fontSize.xl },
  pressed: { backgroundColor: darkColors.elevated },
  slot: { padding: space[3], gap: space[2] },
  slotCopy: { gap: space[1] },
  slotAction: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  slotTitle: { color: darkColors.text, fontSize: fontSize.md, fontWeight: "700" },
});
