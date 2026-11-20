import { addExportProgressListener, cancelExport, exportMP4, probeAudio, probeVideo } from "@stackreel/engine";
import { darkColors, radius, space } from "@stackreel/ui";
import { randomUUID } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClipPreview, PreviewFrame, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { TemplateMusicControls } from "./TemplateMusicControls";
import { TemplateReframe } from "./TemplateReframe";
import { TemplateGallery, TemplateVideoSlots } from "./TemplateSelection";
import { TemplateTextEditor } from "./TemplateTextEditor";
import { TemplateTrim } from "./TemplateTrim";
import { canvas as singleClipCanvas, createClipSource } from "./clip-source";
import {
  createTemplateClip,
  createTemplateMusic,
  createTemplateSource,
  getTemplateTextFields,
  setTemplateClipReframe,
  setTemplateClipTrim,
} from "./template-editor";
import type {
  MobileTemplate,
  TemplateClip,
  TemplateMusic,
  TemplateTextOverrides,
  TemplateVideoSlot,
} from "./template-editor";

type Clip = { name: string; uri: string; source: string };
type SingleDraft = { clip: Clip | null; outputUri: string | null };
type TemplateDraft = {
  clips: Readonly<Record<string, TemplateClip>>;
  textOverrides: TemplateTextOverrides;
  music: TemplateMusic | null;
  source: string | null;
  outputUri: string | null;
};
type Editor = { kind: "single" } | { kind: "template"; template: MobileTemplate; slots: TemplateVideoSlot[] };
type ImportTarget = { kind: "single" } | { kind: "template"; template: MobileTemplate; slot: TemplateVideoSlot };
type ImportOperation = { kind: "import"; slotId?: string };
type SlotEdit = { kind: "trim" | "reframe"; template: MobileTemplate; slot: TemplateVideoSlot; clip: TemplateClip };
type TextEdit = { kind: "text"; template: MobileTemplate; textOverrides: TemplateTextOverrides };
type ExportJob = { kind: "export"; id: string; cancelling: boolean };
type Operation =
  ImportOperation | SlotEdit | TextEdit | { kind: "import-music" | "remove-music" | "share" } | ExportJob;
type Activity = Exclude<Operation, ExportJob> | (ExportJob & { progress: number });
type Feedback = { kind: "error" | "status"; message: string; slotId?: string; scope?: "music" };

const emptyTemplateDraft: TemplateDraft = { clips: {}, textOverrides: {}, music: null, source: null, outputUri: null };

export default function App() {
  const activeOperation = useRef<Operation | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [singleDraft, setSingleDraft] = useState<SingleDraft>({ clip: null, outputUri: null });
  const [templateDrafts, setTemplateDrafts] = useState<Readonly<Record<string, TemplateDraft>>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const template = editor?.kind === "template" ? editor.template : null;
  const textFields = template ? getTemplateTextFields(template) : [];
  const templateDraft = template ? (templateDrafts[template.id] ?? emptyTemplateDraft) : emptyTemplateDraft;
  const source = template ? templateDraft.source : (singleDraft.clip?.source ?? null);
  const outputUri = template ? templateDraft.outputUri : singleDraft.outputUri;
  const canvas = template?.canvas ?? singleClipCanvas;
  const busy = activity !== null;

  useEffect(() => {
    const subscription = addExportProgressListener(({ exportId, progress }) => {
      const job = activeOperation.current;
      if (job?.kind !== "export" || job.id !== exportId || job.cancelling || !Number.isFinite(progress)) return;
      const fraction = Math.min(progress, 1);
      setActivity((current) =>
        current?.kind === "export" && current.id === exportId && fraction > current.progress
          ? { ...current, progress: fraction }
          : current,
      );
    });
    return () => {
      subscription.remove();
      const job = activeOperation.current;
      activeOperation.current = null;
      if (job?.kind === "export" && !job.cancelling) void cancelExport(job.id).catch(() => undefined);
    };
  }, []);

  function begin(operation: Operation) {
    if (activeOperation.current) return false;
    activeOperation.current = operation;
    setActivity(operation.kind === "export" ? { ...operation, progress: 0 } : operation);
    setFeedback(null);
    return true;
  }

  function finish(operation: Operation) {
    if (activeOperation.current !== operation) return;
    activeOperation.current = null;
    setActivity(null);
  }

  function navigate(next: Editor | null) {
    if (activeOperation.current) return;
    setFeedback(null);
    setEditor(next);
  }

  function removeUnusedCachedFile(uri: string | null | undefined, drafts = templateDrafts) {
    if (!uri || uri === singleDraft.clip?.uri || uri === singleDraft.outputUri) return;
    const inUse = Object.values(drafts).some(
      ({ clips, music, outputUri }) =>
        uri === music?.uri || uri === outputUri || Object.values(clips).some((clip) => uri === clip.uri),
    );
    if (!inUse) removeCachedFile(uri);
  }

  function updateTemplateDraft(template: MobileTemplate, draft: TemplateDraft, previousInputUri?: string) {
    // Resolve before committing so a failed edit leaves the draft and export intact.
    const source = createTemplateSource(template, draft.clips, draft.textOverrides, draft.music);
    const outputUri = source === draft.source ? draft.outputUri : null;
    const drafts = { ...templateDrafts, [template.id]: { ...draft, source, outputUri } };
    setTemplateDrafts(drafts);
    removeUnusedCachedFile(draft.outputUri, drafts);
    removeUnusedCachedFile(previousInputUri, drafts);
  }

  function openSlotEdit(kind: SlotEdit["kind"], slot: TemplateVideoSlot) {
    const clip = templateDraft.clips[slot.id];
    if (template && clip) begin({ kind, template, slot, clip });
  }

  function applySlotEdit(operation: SlotEdit, update: (clip: TemplateClip) => TemplateClip) {
    if (activeOperation.current !== operation) return;
    const { template, slot, clip } = operation;
    const draft = templateDrafts[template.id];
    if (!draft || draft.clips[slot.id] !== clip) {
      throw new Error("This slot changed. Close the editor and open it again.");
    }

    const updated = update(clip);
    if (updated !== clip) {
      const clips = { ...draft.clips, [slot.id]: updated };
      updateTemplateDraft(template, { ...draft, clips });
    }
    finish(operation);
  }

  function applyTextEdit(operation: TextEdit, textOverrides: TemplateTextOverrides) {
    if (activeOperation.current !== operation) return;
    const { template } = operation;
    const draft = templateDrafts[template.id] ?? emptyTemplateDraft;
    if (draft.textOverrides !== operation.textOverrides) {
      throw new Error("This template text changed. Close the editor and open it again.");
    }

    if (textOverrides !== draft.textOverrides) updateTemplateDraft(template, { ...draft, textOverrides });
    finish(operation);
  }

  async function selectVideo(target: ImportTarget) {
    const operation: ImportOperation =
      target.kind === "template" ? { kind: "import", slotId: target.slot.id } : { kind: "import" };
    if (!begin(operation)) return;
    let pickedUri: string | undefined;
    try {
      const result = await getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
      if (result.canceled) return;
      const [asset] = result.assets;
      if (!asset) throw new Error("Files did not return a video.");
      pickedUri = asset.uri;
      if (activeOperation.current !== operation) return;

      const metadata = await probeVideo(pickedUri);
      if (activeOperation.current !== operation) return;

      if (target.kind === "template") {
        const { template, slot } = target;
        const draft = templateDrafts[template.id] ?? emptyTemplateDraft;
        const clip = createTemplateClip(slot, pickedUri, asset.name, metadata);
        const clips = { ...draft.clips, [slot.id]: clip };
        updateTemplateDraft(template, { ...draft, clips }, draft.clips[slot.id]?.uri);
      } else {
        const source = createClipSource(pickedUri, metadata);
        setSingleDraft({ clip: { name: asset.name, uri: pickedUri, source }, outputUri: null });
        if (singleDraft.clip?.uri !== pickedUri) removeCachedFile(singleDraft.clip?.uri);
        removeCachedFile(outputUri);
      }

      pickedUri = undefined;
    } catch (cause) {
      if (activeOperation.current === operation) {
        const message = errorMessage("Couldn’t import the video.", cause);
        setFeedback({ ...operation, kind: "error", message });
      }
    } finally {
      removeUnusedCachedFile(pickedUri);
      finish(operation);
    }
  }

  async function selectMusic(template: MobileTemplate) {
    const operation = { kind: "import-music" } as const;
    if (!begin(operation)) return;
    let pickedUri: string | undefined;
    try {
      const result = await getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (result.canceled) return;
      const [asset] = result.assets;
      if (!asset) throw new Error("Files did not return an audio file.");
      pickedUri = asset.uri;
      if (activeOperation.current !== operation) return;

      const metadata = await probeAudio(pickedUri);
      if (activeOperation.current !== operation) return;

      const draft = templateDrafts[template.id] ?? emptyTemplateDraft;
      const music = createTemplateMusic(pickedUri, asset.name, metadata);
      updateTemplateDraft(template, { ...draft, music }, draft.music?.uri);
      pickedUri = undefined;
    } catch (cause) {
      if (activeOperation.current === operation) {
        setFeedback({ kind: "error", scope: "music", message: errorMessage("Couldn’t import the music.", cause) });
      }
    } finally {
      removeUnusedCachedFile(pickedUri);
      finish(operation);
    }
  }

  function removeMusic(template: MobileTemplate) {
    const draft = templateDrafts[template.id];
    const operation = { kind: "remove-music" } as const;
    if (!draft?.music || !begin(operation)) return;
    try {
      updateTemplateDraft(template, { ...draft, music: null }, draft.music.uri);
    } catch (cause) {
      setFeedback({ kind: "error", scope: "music", message: errorMessage("Couldn’t remove the music.", cause) });
    } finally {
      finish(operation);
    }
  }

  async function startExport() {
    if (!source) return;
    const job: ExportJob = { kind: "export", id: randomUUID(), cancelling: false };
    if (!begin(job)) return;
    try {
      const { uri } = await exportMP4(source, job.id);
      if (activeOperation.current === job) {
        if (template) {
          setTemplateDrafts((drafts) => ({ ...drafts, [template.id]: { ...templateDraft, outputUri: uri } }));
        } else {
          setSingleDraft({ ...singleDraft, outputUri: uri });
        }
        if (uri !== outputUri) removeCachedFile(outputUri);
      } else {
        removeCachedFile(uri);
      }
    } catch (cause) {
      if (activeOperation.current === job) {
        if (job.cancelling) setFeedback({ kind: "status", message: "Export cancelled." });
        else setFeedback({ kind: "error", message: errorMessage("Couldn’t export the MP4.", cause) });
      }
    } finally {
      finish(job);
    }
  }

  async function requestCancel() {
    const job = activeOperation.current;
    if (job?.kind !== "export" || job.cancelling) return;
    job.cancelling = true;
    setFeedback(null);
    setActivity((current) => (current?.kind === "export" ? { ...current, cancelling: true } : current));
    try {
      await cancelExport(job.id);
    } catch (cause) {
      if (activeOperation.current === job) {
        job.cancelling = false;
        setActivity((current) => (current?.kind === "export" ? { ...current, cancelling: false } : current));
        setFeedback({ kind: "error", message: errorMessage("Couldn’t cancel the export.", cause) });
      }
    }
  }

  async function shareVideo() {
    const operation = { kind: "share" } as const;
    if (!outputUri || !begin(operation)) return;
    try {
      if (!(await isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
      if (activeOperation.current === operation) await shareAsync(outputUri, { UTI: "public.mpeg-4" });
    } catch (cause) {
      if (activeOperation.current === operation) {
        setFeedback({ kind: "error", message: errorMessage("Couldn’t share the MP4.", cause) });
      }
    } finally {
      finish(operation);
    }
  }

  if (!editor) {
    return (
      <Screen page="gallery">
        <TemplateGallery
          onSelectTemplate={(template, slots) => navigate({ kind: "template", template, slots })}
          onSelectSingleClip={() => navigate({ kind: "single" })}
        />
      </Screen>
    );
  }

  const importing = activity?.kind === "import";
  const exporting = activity?.kind === "export";
  const trimming = activity?.kind === "trim";
  const reframing = activity?.kind === "reframe";
  const editingText = activity?.kind === "text";
  const clip = singleDraft.clip;
  const editorScreen = (
    <Screen page={template?.id ?? "single-clip"}>
      {trimming && (
        <TemplateTrim
          slot={activity.slot}
          clip={activity.clip}
          onApply={(startFrame) =>
            applySlotEdit(activity, (clip) => setTemplateClipTrim(activity.slot, clip, startFrame))
          }
          onCancel={() => finish(activity)}
        />
      )}
      {reframing && (
        <TemplateReframe
          slot={activity.slot}
          clip={activity.clip}
          canvas={activity.template.canvas}
          onApply={(reframe) =>
            applySlotEdit(activity, (clip) => setTemplateClipReframe(clip, activity.template.canvas, reframe))
          }
          onCancel={() => finish(activity)}
        />
      )}
      <View style={styles.navigation}>
        <Action label="Back to templates" onPress={() => navigate(null)} disabled={busy} />
      </View>
      <View style={styles.details}>
        <Text accessibilityRole="header" style={textStyles.heading}>
          {template?.name ?? "Single-clip editor"}
        </Text>
        <Text style={textStyles.muted}>
          {canvas.width} × {canvas.height} · {canvas.fps} fps
        </Text>
        {editor.kind === "single" && clip && (
          <Text numberOfLines={1} style={textStyles.body}>
            {clip.name}
          </Text>
        )}
      </View>
      {template && textFields.length > 0 && (
        <View style={styles.navigation}>
          <Action
            label="Edit text"
            testID="edit-template-text"
            onPress={() => begin({ kind: "text", template, textOverrides: templateDraft.textOverrides })}
            disabled={busy}
          />
        </View>
      )}
      {editor.kind === "template" && (
        <TemplateVideoSlots
          slots={editor.slots}
          clips={templateDraft.clips}
          busy={busy}
          importingSlotId={importing ? activity.slotId : undefined}
          importError={feedback?.kind === "error" && feedback.slotId !== undefined ? feedback : null}
          onSelect={(slot) => selectVideo({ kind: "template", template: editor.template, slot })}
          onTrim={(slot) => openSlotEdit("trim", slot)}
          onReframe={(slot) => openSlotEdit("reframe", slot)}
        />
      )}
      {source && <ClipPreview key={source} canvas={canvas} source={source} suspended={busy && !exporting} />}
      {editor.kind === "single" && !source && (
        <PreviewFrame canvas={canvas}>
          <Text style={textStyles.muted}>Choose a clip from Files</Text>
        </PreviewFrame>
      )}
      {editor.kind === "template" && !source && (
        <Text style={textStyles.muted}>Add all required videos to preview and export.</Text>
      )}
      {editor.kind === "template" && editor.template.audio?.music && (
        <TemplateMusicControls
          music={templateDraft.music}
          busy={busy}
          importing={activity?.kind === "import-music"}
          error={feedback?.scope === "music" ? feedback.message : undefined}
          onSelect={() => selectMusic(editor.template)}
          onRemove={() => removeMusic(editor.template)}
        />
      )}
      <View style={styles.actions}>
        {feedback && feedback.slotId === undefined && feedback.scope !== "music" && (
          <Text accessibilityRole="alert" style={feedback.kind === "error" ? textStyles.error : textStyles.muted}>
            {feedback.message}
          </Text>
        )}
        {exporting && (
          <>
            <ExportProgress percentage={Math.floor(activity.progress * 100)} />
            <Action
              label={activity.cancelling ? "Cancelling…" : "Cancel export"}
              onPress={requestCancel}
              disabled={activity.cancelling}
            />
          </>
        )}
        {outputUri && (
          <Action
            label={activity?.kind === "share" ? "Sharing…" : "Share MP4"}
            onPress={shareVideo}
            disabled={busy}
            primary
          />
        )}
        {(editor.kind === "template" || source) && !exporting && (
          <Action
            label="Export MP4"
            onPress={startExport}
            disabled={busy || !source}
            primary={!!source && !outputUri}
          />
        )}
        {editor.kind === "single" && (
          <Action
            label={importing ? "Opening video…" : clip ? "Replace video" : "Choose video"}
            onPress={() => selectVideo({ kind: "single" })}
            disabled={busy}
            primary={clip === null}
          />
        )}
      </View>
    </Screen>
  );

  return (
    <>
      {editorScreen}
      {editingText && (
        <TemplateTextEditor
          fields={textFields}
          overrides={activity.textOverrides}
          onApply={(overrides) => applyTextEdit(activity, overrides)}
          onCancel={() => finish(activity)}
        />
      )}
    </>
  );
}

function ExportProgress({ percentage }: { percentage: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Export progress"
      accessibilityValue={{ min: 0, max: 100, now: percentage }}
      style={styles.progress}
    >
      <Text style={textStyles.body}>Exporting MP4 · {percentage}%</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percentage}%` }]} />
      </View>
    </View>
  );
}

function removeCachedFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const cache = Paths.cache.uri.replace(/\/$/, "");
    if (uri.startsWith(`${cache}/`)) new File(uri).delete();
  } catch {
    // The system may have already evicted the file from the cache.
  }
}

const styles = StyleSheet.create({
  navigation: { alignSelf: "flex-start" },
  details: { gap: space[1] },
  actions: { gap: space[2] },
  progress: { gap: space[2], marginBottom: space[1] },
  progressTrack: { height: 6, borderRadius: radius.full, backgroundColor: darkColors.border, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: darkColors.accent },
});
