import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getDraftProjects } from "./draft-names";
import { Action, textStyles } from "./Screen";
import { ShotStoryboard } from "./ShotStoryboard";
import { getSelectedShot, getStoryboardShots } from "./template-storyboard";
import { trimTimeLabel } from "./TemplateTrim";
import { VideoImportActions } from "./VideoImportActions";
import { getEmptyVideoSlots, getVideoSlots, mobileTemplates } from "./template-editor";
import type { MobileTemplate, TemplateClip, TemplateVideoSlot } from "./template-editor";
import { templatePreviews } from "./template-previews";
import type { SlotImportError } from "./template-video-import";
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

type ProjectDrafts = Readonly<Record<string, Readonly<Record<string, ProjectDraft>>>>;

export function TemplateGallery({
  drafts,
  busy,
  preparingSample,
  sampleError,
  onEditSample,
  onWatchExample,
  onNewDraft,
  singleDraftCount,
  onNewSingleClip,
  onSelectTemplate,
  onSelectSingleClip,
}: {
  drafts: ProjectDrafts;
  busy: boolean;
  preparingSample: boolean;
  sampleError: string | undefined;
  onEditSample: SelectTemplate;
  onWatchExample: (template: MobileTemplate, source: number) => void;
  onNewDraft: SelectTemplate;
  singleDraftCount: number;
  onNewSingleClip: () => void;
  onSelectTemplate: SelectTemplate;
  onSelectSingleClip: () => void;
}) {
  return (
    <>
      <Text accessibilityRole="header" style={textStyles.heading}>
        Templates
      </Text>
      <View style={styles.list}>
        {choices.map(({ template, slots }) => {
          const count = Object.keys(drafts[template.id] ?? {}).length;
          const source = templatePreviews[template.id];
          const details = `${slots.length} videos · ${secondsLabel(template.durationUs)}`;
          return (
            <GalleryCard
              key={template.id}
              label={template.name}
              details={count > 1 ? `${details} · Choose from ${count} drafts` : details}
              description={template.description}
              disabled={busy}
              onPress={() => onSelectTemplate(template, slots)}
              actions={
                <>
                  {source !== undefined && (
                    <Action
                      label="Watch example"
                      accessibilityLabel={`Watch ${template.name} example`}
                      testID={`watch-example-${template.id}`}
                      onPress={() => onWatchExample(template, source)}
                      disabled={busy}
                    />
                  )}
                  {template.id === "before-after" && (
                    <Action
                      label={preparingSample ? "Preparing sample reel…" : "Edit sample reel"}
                      testID="edit-sample-before-after"
                      onPress={() => onEditSample(template, slots)}
                      disabled={busy}
                    />
                  )}
                  {count > 0 && (
                    <Action
                      label="New draft"
                      accessibilityLabel={`New draft for ${template.name}`}
                      onPress={() => onNewDraft(template, slots)}
                      disabled={busy}
                    />
                  )}
                  {template.id === "before-after" && sampleError && (
                    <Text accessibilityRole="alert" style={textStyles.error}>
                      {sampleError}
                    </Text>
                  )}
                </>
              }
            />
          );
        })}
      </View>
      <GalleryCard
        label="Single-clip editor"
        disabled={busy}
        details={
          singleDraftCount > 1 ? `Choose from ${singleDraftCount} drafts` : "Trim, preview, and export one video"
        }
        onPress={onSelectSingleClip}
        actions={
          singleDraftCount > 0 && (
            <Action
              label="New draft"
              accessibilityLabel="New single-clip draft"
              onPress={onNewSingleClip}
              disabled={busy}
            />
          )
        }
      />
    </>
  );
}

export function TemplateProjects({
  drafts,
  filter,
  singleProjects,
  onSelectSingleClip,
  duplicating,
  onShowAll,
  onOpenDraft,
  onDuplicateDraft,
  onRenameDraft,
  onDeleteDraft,
  onBrowseTemplates,
}: {
  drafts: ProjectDrafts;
  filter: MobileTemplate | "single" | undefined;
  singleProjects: readonly { draftId: string; label: string; draft: { loadError?: string } }[];
  onSelectSingleClip: (draftId: string) => void;
  duplicating: { templateId: string; draftId: string } | null;
  onShowAll: () => void;
  onOpenDraft: (template: MobileTemplate, slots: TemplateVideoSlot[], draftId: string) => void;
  onDuplicateDraft: (template: MobileTemplate, draftId: string) => void;
  onRenameDraft: (template: MobileTemplate, draftId: string) => void;
  onDeleteDraft: (template: MobileTemplate, draftId: string, deleteTarget: string) => void;
  onBrowseTemplates: () => void;
}) {
  const busy = duplicating !== null;
  const projects = filter === "single" ? [] : getDraftProjects(choices, drafts, filter?.id);
  const singles = !filter || filter === "single" ? singleProjects : [];
  const filteredTitle = filter === "single" ? "Single-clip drafts" : filter && `${filter.name} drafts`;

  return (
    <>
      <Text accessibilityRole="header" style={textStyles.heading}>
        {filteredTitle ?? "Projects"}
      </Text>
      {filter && <Action label="Show all projects" onPress={onShowAll} disabled={busy} />}
      {projects.length === 0 && singles.length === 0 ? (
        <View style={[styles.panel, styles.emptyProjects]}>
          <Text style={styles.cardTitle}>
            {filter === "single"
              ? "No saved single-clip drafts"
              : filter
                ? `No saved ${filter.name} drafts`
                : "No saved drafts yet"}
          </Text>
          <Text style={textStyles.muted}>
            {filter === "single"
              ? "Import a video in the single-clip editor to start a draft."
              : filter
                ? "Make an edit in a template to start a draft."
                : "Edit a template or import a single clip to start a draft."}
          </Text>
          <Action label="Browse templates" onPress={onBrowseTemplates} />
        </View>
      ) : (
        <View style={styles.list}>
          {singles.map(({ draftId, label, draft }) => (
            <GalleryCard
              key={draftId}
              label={label}
              details={draft.loadError ?? "Single-clip draft"}
              disabled={busy}
              onPress={() => onSelectSingleClip(draftId)}
            />
          ))}
          {projects.map(({ template, slots, draftId, draft, label, deleteTarget }) => {
            const name = draft.name ?? template.name;
            const filled = slots.filter(({ id }) => draft.clips[id]).length;
            const missingMedia = draft.missingSlots.length > 0 || draft.missingMusic;
            const progress = `${filled} of ${slots.length} videos`;
            const details = name === template.name ? progress : `${template.name} · ${progress}`;
            const copying = duplicating?.templateId === template.id && duplicating.draftId === draftId;
            return (
              <GalleryCard
                key={`${template.id}/${draftId}`}
                label={label}
                details={draft.loadError ? "Couldn’t load draft" : details}
                description={missingMedia ? "Missing media" : undefined}
                disabled={busy}
                onPress={() => onOpenDraft(template, slots, draftId)}
                actions={
                  <>
                    {!draft.loadError && (
                      <>
                        <Action
                          label={copying ? "Duplicating…" : "Duplicate"}
                          accessibilityLabel={`${copying ? "Duplicating" : "Duplicate"} ${label} draft`}
                          disabled={busy}
                          onPress={() => onDuplicateDraft(template, draftId)}
                        />
                        <Action
                          label="Rename"
                          accessibilityLabel={`Rename ${label} draft`}
                          disabled={busy}
                          onPress={() => onRenameDraft(template, draftId)}
                        />
                      </>
                    )}
                    <Action
                      label="Delete"
                      accessibilityLabel={`Delete ${deleteTarget}`}
                      disabled={busy}
                      onPress={() => onDeleteDraft(template, draftId, deleteTarget)}
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
  disabled = false,
  onPress,
  actions,
}: {
  label: string;
  details: string;
  description?: string | undefined;
  disabled?: boolean;
  onPress: () => void;
  actions?: ReactNode;
}) {
  return (
    <View style={[styles.panel, styles.cardPanel]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        accessibilityHint={`${details}.${description ? ` ${description}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.disabled]}
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

export type ImportRecovery = { error: SlotImportError; answer: (replace: boolean) => void };

export function TemplateVideoSlots({
  selectedSlotId,
  onSelectSlot,
  slots,
  clips,
  missingSlots,
  recoverableSlots,
  relinking,
  busy,
  importingSlotId,
  importingFrom,
  recovery,
  slotError,
  onRelink,
  swapError,
  onSelect,
  onSelectOrdered,
  onTrim,
  onReframe,
  onVolume,
  onClear,
  onChooseSwap,
  onSwap,
  onCancelSwap,
}: {
  selectedSlotId: string | undefined;
  onSelectSlot: (slotId: string) => void;
  slots: readonly TemplateVideoSlot[];
  clips: Readonly<Record<string, TemplateClip>>;
  missingSlots: readonly string[];
  recoverableSlots: Readonly<Record<string, string>>;
  relinking: boolean;
  busy: boolean;
  importingSlotId: string | undefined;
  importingFrom: VideoPickerSource | undefined;
  recovery: ImportRecovery | undefined;
  slotError: { slotId?: string; message: string } | null;
  swapError: string | undefined;
  onRelink: (slot: TemplateVideoSlot, source: VideoPickerSource) => void;
  onSelect: (slot: TemplateVideoSlot, source: VideoPickerSource) => void;
  onSelectOrdered: (slots: TemplateVideoSlot[]) => void;
  onTrim: (slot: TemplateVideoSlot) => void;
  onReframe: (slot: TemplateVideoSlot) => void;
  onVolume: (slot: TemplateVideoSlot) => void;
  onClear: (slot: TemplateVideoSlot) => void;
  onChooseSwap: () => void;
  onSwap: (first: TemplateVideoSlot, second: TemplateVideoSlot) => void;
  onCancelSwap: (() => void) | undefined;
}) {
  const shots = getStoryboardShots(slots, clips, missingSlots);
  const selected = getSelectedShot(shots, selectedSlotId);
  const effectiveId = selected?.slot.id;
  useEffect(() => {
    if (effectiveId !== undefined && selectedSlotId !== effectiveId) onSelectSlot(effectiveId);
  }, [effectiveId, selectedSlotId, onSelectSlot]);

  if (!selected) return null;
  const { slot, clip } = selected;
  const missing = selected.status === "Missing";
  const recoverable = missing && Object.hasOwn(recoverableSlots, slot.id);
  const emptySlots = getEmptyVideoSlots(slots, clips, missingSlots);
  const filledSlots = shots.filter(({ status }) => status === "Ready").map(({ slot }) => slot);
  const swapPairs = filledSlots.flatMap((first, index) =>
    filledSlots.slice(index + 1).map((second) => ({ first, second })),
  );
  const choosingSwap = onCancelSwap !== undefined;
  const visibleSwapPairs = choosingSwap || swapPairs.length === 1 ? swapPairs : [];
  return (
    <View style={styles.list}>
      <ShotStoryboard shots={shots} selected={selected} busy={busy} onSelectSlot={onSelectSlot} />
      <View testID={`shot-inspector-${slot.id}`} style={[styles.panel, styles.slot]}>
        <View style={styles.slotCopy}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Shot {selected.number} · {slot.label}
          </Text>
          {clip && (
            <>
              <Text selectable style={textStyles.body}>
                {clip.name}
              </Text>
              <Text style={textStyles.muted}>
                Source {trimTimeLabel(clip.trimInUs)} to {trimTimeLabel(clip.trimOutUs)}
                {!missing && ` · Original audio ${clip.volumePercent ?? 100}%`}
              </Text>
            </>
          )}
          <Text style={textStyles.muted}>
            At least {secondsLabel(slot.minDurationUs)}
            {slot.minDurationUs < slot.trimDurationUs &&
              `. Clips under ${secondsLabel(slot.trimDurationUs)} hold their final frame.`}
          </Text>
          {missing && (
            <Text accessibilityRole="alert" style={textStyles.error}>
              {recoverable
                ? `“${recoverableSlots[slot.id]}” is unavailable. Relink the original to keep your trim, framing, and audio level.`
                : "Saved video is missing. Replace it or clear this slot."}
            </Text>
          )}
        </View>
        {clip && !missing && (
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
            <Action
              label="Volume"
              accessibilityLabel={`Volume for ${slot.label}`}
              testID={`volume-${slot.id}`}
              onPress={() => onVolume(slot)}
              disabled={busy}
            />
          </View>
        )}
        {recoverable && (
          <VideoImportActions
            action="Relink"
            importingFrom={relinking && importingSlotId === slot.id ? importingFrom : undefined}
            busy={busy}
            primary
            slotLabel={slot.label}
            onSelect={(source) => onRelink(slot, source)}
          />
        )}
        <VideoImportActions
          action={clip || missing ? "Replace" : "Choose"}
          importingFrom={!relinking && importingSlotId === slot.id ? importingFrom : undefined}
          busy={busy}
          primary={!recoverable && (missing || (!clip && emptySlots.length < 2))}
          slotLabel={slot.label}
          onSelect={(source) => onSelect(slot, source)}
        />
        {(clip || missing) && (
          <View style={styles.slotAction}>
            <Action
              label="Clear video"
              accessibilityLabel={`Clear video for ${slot.label}`}
              testID={`clear-video-${slot.id}`}
              onPress={() => onClear(slot)}
              disabled={busy}
            />
          </View>
        )}
      </View>
      {slotError && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {slotError.message}
        </Text>
      )}
      {emptySlots.length >= 2 && (
        <View style={[styles.panel, styles.slot]}>
          <Text style={textStyles.body}>
            Pick in slot order ·{" "}
            {shots
              .filter(({ status }) => status === "Empty")
              .map(({ slot, number }) => `${number}. ${slot.label}`)
              .join(" · ")}
          </Text>
          {recovery ? (
            <>
              <Text accessibilityRole="alert" style={textStyles.error}>
                {recovery.error.message}
              </Text>
              <Text style={textStyles.body}>Choose a replacement to keep your other picks in order.</Text>
              <Action
                label={`Replace ${recovery.error.slot.label} from Photos`}
                onPress={() => recovery.answer(true)}
                primary
              />
              <Action label="Cancel import" onPress={() => recovery.answer(false)} />
            </>
          ) : (
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
          )}
        </View>
      )}
      {swapPairs.length > 1 && !choosingSwap && (
        <Action label="Swap clips" testID="swap-video-slots" onPress={onChooseSwap} disabled={busy} />
      )}
      {visibleSwapPairs.map(({ first, second }) => (
        <Action
          key={`${first.id}-${second.id}`}
          label={`Swap ${first.label} and ${second.label}`}
          testID={`swap-${first.id}-${second.id}`}
          onPress={() => onSwap(first, second)}
          disabled={busy && !choosingSwap}
        />
      ))}
      {choosingSwap && <Action label="Cancel" testID="cancel-swap" onPress={onCancelSwap} />}
      {swapError && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {swapError}
        </Text>
      )}
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
  disabled: { opacity: 0.55 },
  slot: { padding: space[3], gap: space[2] },
  slotCopy: { gap: space[1] },
  slotAction: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
