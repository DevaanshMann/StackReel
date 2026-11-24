import { addExportProgressListener, cancelExport, exportMP4, probeAudio, probeVideo } from "@stackreel/engine";
import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { randomUUID } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { useKeepAwake } from "expo-keep-awake";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ClipPreview, PreviewFrame, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import type { ScreenRef } from "./Screen";
import { SingleClipTrim } from "./SingleClipTrim";
import { TemplateMusicControls } from "./TemplateMusicControls";
import { TemplateReframe } from "./TemplateReframe";
import { TemplateGallery, TemplateProjects, TemplateVideoSlots } from "./TemplateSelection";
import { TemplateTextEditor } from "./TemplateTextEditor";
import { TemplateTrim } from "./TemplateTrim";
import { TemplateVolume, VolumeSheet } from "./TemplateVolume";
import { VideoImportActions } from "./VideoImportActions";
import { canvas as singleClipCanvas } from "./clip-source";
import type { ClipFrameRange, SingleClipFit } from "./clip-source";
import { discardPickerCopy } from "./draft-files";
import { nextDraftName } from "./draft-names";
import {
  deleteSingleClipDraft,
  importSingleClipDraft,
  loadSingleClipDraft,
  setSingleClipFit,
  trimSingleClipDraft,
} from "./single-clip-draft";
import type { SingleClip } from "./single-clip-draft";
import {
  clearTemplateMusic,
  clearTemplateVideoSlot,
  commitTemplateDraftUpdate,
  createDraftMediaFile,
  createTemplateDraftSession,
  deleteTemplateDraft,
  duplicateTemplateDraft,
  listTemplateDraftIds,
  loadTemplateDraft,
  removeDraftFile,
  renameTemplateDraft,
} from "./template-drafts";
import type { TemplateDraftEdits, TemplateDraftSession } from "./template-drafts";
import {
  createTemplateMusic,
  createTemplateSource,
  getTemplateGainDb,
  getTemplateTextFields,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateClipVolume,
  setTemplateMusicVolume,
  swapTemplateClips,
} from "./template-editor";
import type {
  MobileTemplate,
  TemplateClip,
  TemplateMusic,
  TemplateTextOverrides,
  TemplateVideoSlot,
} from "./template-editor";
import { getTemplateSafeZoneGuide } from "./template-safe-zones";
import { importTemplateVideos, removeCachedFile, SlotImportError } from "./template-video-import";
import { pickVideo } from "./video-picker";
import type { VideoPickerSource } from "./video-picker";

type SingleDraft = { clip: SingleClip | null; outputUri: string | null; loadError?: string };
type TemplateDraft = TemplateDraftEdits & {
  source: string | null;
  outputUri: string | null;
  missingSlots: readonly string[];
  missingMusic: boolean;
  loadError?: string;
};
type TemplateDrafts = Readonly<Record<string, Readonly<Record<string, TemplateDraft>>>>;
type HistoryLabels = Pick<TemplateDraftSession, "undoLabel" | "redoLabel">;
type HistoryDirection = "undo" | "redo";
type Home = { kind: "home"; tab: HomeTab; filter?: MobileTemplate };
type TemplateEditor = {
  kind: "template";
  template: MobileTemplate;
  draftId: string;
  slots: TemplateVideoSlot[];
  home: Home;
};
type Editor = Home | { kind: "single"; home: Home } | TemplateEditor;
type ImportOperation = { kind: "import"; source: VideoPickerSource; slotId?: string };
type SlotEdit = {
  kind: "trim" | "reframe" | "volume";
  editor: TemplateEditor;
  slot: TemplateVideoSlot;
  clip: TemplateClip;
};
type SingleTrimEdit = { kind: "single-trim"; clip: SingleClip };
type MusicVolumeEdit = { kind: "music-volume"; editor: TemplateEditor; music: TemplateMusic };
type SlotSwap = { kind: "swap"; editor: TemplateEditor; draft: TemplateDraft };
type TextEdit = { kind: "text"; editor: TemplateEditor; textOverrides: TemplateTextOverrides };
type ExportJob = { kind: "export"; id: string; cancelling: boolean };
type Operation =
  | ImportOperation
  | { kind: "fullscreen" }
  | SlotEdit
  | SingleTrimEdit
  | MusicVolumeEdit
  | SlotSwap
  | TextEdit
  | { kind: HistoryDirection }
  | { kind: "duplicate"; templateId: string; draftId: string }
  | { kind: "clear-video" | "import-music" | "remove-music" | "share" | "save-photos" | "rename" | "delete" }
  | ExportJob;
type Activity = Exclude<Operation, ExportJob> | (ExportJob & { progress: number });
type Feedback = {
  kind: "error" | "status";
  message: string;
  slotId?: string;
  scope?: "music" | "swap" | "history" | "framing";
};

const homeTabs = [
  { id: "templates", label: "Templates" },
  { id: "projects", label: "Projects" },
] as const;
type HomeTab = (typeof homeTabs)[number]["id"];

const emptyTemplateDraft: TemplateDraft = {
  clips: {},
  textOverrides: {},
  music: null,
  source: null,
  outputUri: null,
  missingSlots: [],
  missingMusic: false,
};

const firstScreen: Home = { kind: "home", tab: "templates" };
const framingOptions = [
  { fit: "contain", label: "Fit" },
  { fit: "cover", label: "Fill" },
] as const;
const emptyHistoryLabels: HistoryLabels = { undoLabel: null, redoLabel: null };
const slotEditLabels: Record<SlotEdit["kind"], string> = {
  trim: "trim",
  reframe: "reframe",
  volume: "clip volume",
};

function getEditorDraft(drafts: TemplateDrafts | null, editor: Editor) {
  return editor.kind === "template"
    ? (drafts?.[editor.template.id]?.[editor.draftId] ?? emptyTemplateDraft)
    : emptyTemplateDraft;
}

function openDraftSession(editor: Editor, drafts: TemplateDrafts | null) {
  return editor.kind === "template" && !getEditorDraft(drafts, editor).loadError
    ? createTemplateDraftSession(editor.template, editor.draftId)
    : null;
}

function getSlotPreviewTemplateGainDb(template: MobileTemplate, slotId: string) {
  // An isolated preview uses the first authored occurrence of a slot.
  for (const track of template.tracks) {
    if (track.type !== "video") continue;
    const item = track.items.find((item) => item.slot === slotId);
    if (item) return item.gainDb;
  }
  return undefined;
}

export default function App() {
  const mounted = useRef(false);
  const editorScreenRef = useRef<ScreenRef>(null);
  const activeOperation = useRef<Operation | null>(null);
  const currentEditor = useRef<Editor>(firstScreen);
  const currentTemplateDrafts = useRef<TemplateDrafts | null>(null);
  const currentDraftSession = useRef<TemplateDraftSession | null>(null);
  const [discoveryErrors, setDiscoveryErrors] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor>(firstScreen);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [singleDraft, setSingleDraft] = useState<SingleDraft>({ clip: null, outputUri: null });
  const currentSingleDraft = useRef(singleDraft);
  const [templateDrafts, setTemplateDrafts] = useState<TemplateDrafts | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [historyLabels, setHistoryLabels] = useState(emptyHistoryLabels);

  const template = editor.kind === "template" ? editor.template : null;
  const textFields = template ? getTemplateTextFields(template) : [];
  const templateDraft = getEditorDraft(templateDrafts, editor);
  const source = template ? templateDraft.source : (singleDraft.clip?.source ?? null);
  const outputUri = template ? templateDraft.outputUri : singleDraft.outputUri;
  const canvas = template?.canvas ?? singleClipCanvas;
  const fullScreen = activity?.kind === "fullscreen";
  const busy = activity !== null && !fullScreen;

  useEffect(() => {
    reopenSingleDraft();
    const drafts: Record<string, Record<string, TemplateDraft>> = {};
    const failed: string[] = [];
    for (const template of mobileTemplates) {
      const siblings: Record<string, TemplateDraft> = {};
      drafts[template.id] = siblings;
      let ids: string[];
      try {
        ids = listTemplateDraftIds(template);
      } catch {
        failed.push(template.name);
        // The original single-draft path can still be opened directly.
        ids = [template.id];
      }
      for (const draftId of ids) {
        try {
          const saved = loadTemplateDraft(template, draftId);
          if (saved) {
            const source = createTemplateSource(template, saved.clips, saved.textOverrides, saved.music);
            siblings[draftId] = { ...saved, source, outputUri: null };
          }
        } catch {
          const name = draftId === template.id ? template.name : `${template.name} (${draftId.slice(0, 8)})`;
          siblings[draftId] = { ...emptyTemplateDraft, name, loadError: "Couldn’t reopen the saved draft." };
        }
      }
    }
    setDiscoveryErrors(failed);
    storeTemplateDrafts(drafts);
  }, []);

  useEffect(() => {
    mounted.current = true;
    setActivity(null);
    currentDraftSession.current = openDraftSession(currentEditor.current, currentTemplateDrafts.current);
    setHistoryLabels(emptyHistoryLabels);
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
      mounted.current = false;
      subscription.remove();
      const job = activeOperation.current;
      activeOperation.current = null;
      if (job?.kind === "export" && !job.cancelling) void cancelExport(job.id).catch(() => undefined);
      currentDraftSession.current?.close();
      currentDraftSession.current = null;
    };
  }, []);

  function isCurrentScreen() {
    if (!mounted.current || currentEditor.current !== editor) return false;
    // Ignore queued handlers from before a synchronous commit or a change to the Projects list.
    if (editor.kind === "home") return currentTemplateDrafts.current === templateDrafts;
    if (editor.kind === "single") return currentSingleDraft.current === singleDraft;
    return getEditorDraft(currentTemplateDrafts.current, editor) === templateDraft;
  }

  function isCurrentOperation(operation: Operation) {
    return activeOperation.current === operation && isCurrentScreen();
  }

  function begin(operation: Operation) {
    if (activeOperation.current || !isCurrentScreen()) return false;
    activeOperation.current = operation;
    setActivity(operation.kind === "export" ? { ...operation, progress: 0 } : operation);
    if (operation.kind !== "fullscreen") setFeedback(null);
    return true;
  }

  function finish(operation: Operation) {
    if (activeOperation.current !== operation) return;
    activeOperation.current = null;
    setActivity(null);
  }

  function navigate(next: Editor) {
    if (!mounted.current || activeOperation.current || currentEditor.current !== editor) return;
    currentDraftSession.current?.close();
    currentDraftSession.current = openDraftSession(next, currentTemplateDrafts.current);
    currentEditor.current = next;
    setFeedback(null);
    setHistoryLabels(emptyHistoryLabels);
    setEditor(next);
  }

  function selectHomeTab(tab: HomeTab) {
    navigate({ kind: "home", tab });
  }

  function storeTemplateDrafts(drafts: TemplateDrafts) {
    currentTemplateDrafts.current = drafts;
    setTemplateDrafts(drafts);
  }

  function storeTemplateDraft(
    { template, draftId }: Pick<TemplateEditor, "template" | "draftId">,
    draft: TemplateDraft,
  ) {
    const siblings = { ...currentTemplateDrafts.current?.[template.id], [draftId]: draft };
    storeTemplateDrafts({ ...currentTemplateDrafts.current, [template.id]: siblings });
  }

  function openDraft(template: MobileTemplate, slots: TemplateVideoSlot[], draftId: string) {
    if (editor.kind !== "home" || !isCurrentScreen() || !templateDrafts?.[template.id]?.[draftId]) return;
    navigate({ kind: "template", template, slots, draftId, home: editor });
  }

  function openTemplate(template: MobileTemplate, slots: TemplateVideoSlot[]) {
    if (editor.kind !== "home" || activeOperation.current || !isCurrentScreen()) return;
    const ids = Object.keys(templateDrafts?.[template.id] ?? {});
    if (ids.length > 1) navigate({ kind: "home", tab: "projects", filter: template });
    else if (ids[0]) openDraft(template, slots, ids[0]);
    else navigate({ kind: "template", template, slots, draftId: randomUUID(), home: editor });
  }

  function createDraft(template: MobileTemplate, slots: TemplateVideoSlot[]) {
    if (editor.kind !== "home" || activeOperation.current || !isCurrentScreen()) return;
    const next: TemplateEditor = { kind: "template", template, slots, draftId: randomUUID(), home: editor };
    const name = nextDraftName(template.name, templateDrafts?.[template.id] ?? {});
    try {
      const draft = { ...emptyTemplateDraft, name };
      storeTemplateDraft(next, { ...draft, ...commitTemplateDraftUpdate(template, draft, next.draftId) });
      navigate(next);
      AccessibilityInfo.announceForAccessibilityWithOptions(`Created ${name}.`, { queue: true });
    } catch {
      Alert.alert("Couldn’t create the draft", "Try again from Templates.");
    }
  }

  async function duplicateDraft(template: MobileTemplate, draftId: string) {
    const siblings = templateDrafts?.[template.id];
    const original = siblings?.[draftId];
    const operation = { kind: "duplicate", templateId: template.id, draftId } as const;
    if (!siblings || !original || original.loadError || !begin(operation)) return;

    try {
      const name = nextDraftName(template.name, siblings, original.name ?? template.name);
      const copy = await duplicateTemplateDraft(template, draftId, name);
      if (!isCurrentOperation(operation)) return;
      storeTemplateDraft({ template, draftId: copy.draftId }, { ...copy.draft, source: copy.source, outputUri: null });
      AccessibilityInfo.announceForAccessibilityWithOptions(`Created ${name}.`, { queue: true });
    } catch {
      if (isCurrentOperation(operation)) Alert.alert("Couldn’t duplicate the draft", "Try again from Projects.");
    } finally {
      finish(operation);
    }
  }

  function promptRenameDraft(template: MobileTemplate, draftId: string) {
    const draft = templateDrafts?.[template.id]?.[draftId];
    const operation = { kind: "rename" } as const;
    if (!draft || draft.loadError || !begin(operation)) return;
    const currentName = draft.name ?? template.name;

    Alert.prompt(
      "Rename draft",
      undefined,
      [
        { text: "Cancel", style: "cancel", onPress: () => finish(operation) },
        {
          text: "Save",
          onPress: (input) => {
            if (!isCurrentOperation(operation)) return;
            finish(operation);
            const name = input?.trim();
            if (!name) {
              Alert.alert("Enter a name for the draft.");
              return;
            }
            if (name === currentName) return;
            try {
              renameTemplateDraft(template, name, draftId);
              storeTemplateDraft({ template, draftId }, { ...draft, name });
              AccessibilityInfo.announceForAccessibilityWithOptions(`Renamed draft to ${name}.`, { queue: true });
            } catch {
              Alert.alert("Couldn’t rename the draft", "Try again from Projects.");
            }
          },
        },
      ],
      "plain-text",
      currentName,
    );
  }

  function confirmDeleteDraft(template: MobileTemplate, draftId: string, deleteTarget: string) {
    const draft = templateDrafts?.[template.id]?.[draftId];
    const operation = { kind: "delete" } as const;
    if (!draft || !begin(operation)) return;

    Alert.alert(
      `Delete ${deleteTarget}?`,
      "Your edits and StackReel’s copies of the videos and music will be removed. Your original files will stay in place.",
      [
        { text: "Cancel", style: "cancel", onPress: () => finish(operation) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (!isCurrentOperation(operation)) return;
            finish(operation);
            try {
              deleteTemplateDraft(template, draftId);
              const siblings = { ...currentTemplateDrafts.current?.[template.id] };
              delete siblings[draftId];
              storeTemplateDrafts({ ...currentTemplateDrafts.current, [template.id]: siblings });
              removeCachedFile(draft.outputUri);
              AccessibilityInfo.announceForAccessibilityWithOptions(`Deleted ${deleteTarget}.`, {
                queue: true,
              });
            } catch {
              Alert.alert("Couldn’t delete the draft", "Try again from Projects.");
            }
          },
        },
      ],
    );
  }

  function publishDraftEdit(
    editor: TemplateEditor,
    draft: TemplateDraft,
    previousOutputUri: string | null,
    { undoLabel, redoLabel }: TemplateDraftSession,
  ) {
    storeTemplateDraft(editor, draft);
    setHistoryLabels({ undoLabel, redoLabel });
    if (draft.outputUri !== previousOutputUri) removeCachedFile(previousOutputUri);
  }

  function commitDraftEdit(editor: TemplateEditor, draft: TemplateDraft, label: string) {
    const session = currentDraftSession.current;
    if (!session || draft.loadError) throw new Error(draft.loadError ?? "The draft editor is closed.");
    const edits = { ...draft, name: draft.name ?? editor.template.name };
    const saved = session.commit(edits, label);
    publishDraftEdit(editor, { ...edits, ...saved }, draft.outputUri, session);
  }

  function applyDraftHistory(direction: HistoryDirection) {
    const session = currentDraftSession.current;
    if (editor.kind !== "template" || !session) return;
    const label = direction === "undo" ? session.undoLabel : session.redoLabel;
    const operation = { kind: direction };
    if (!label || !begin(operation)) return;

    try {
      const restored = session[direction]({ source, outputUri });
      if (!restored) return;
      publishDraftEdit(editor, restored, outputUri, session);
      AccessibilityInfo.announceForAccessibilityWithOptions(
        direction === "undo" ? "Undo complete." : "Redo complete.",
        {
          queue: true,
        },
      );
    } catch (cause) {
      setFeedback({ kind: "error", scope: "history", message: errorMessage(`Couldn’t ${direction} the edit.`, cause) });
    } finally {
      finish(operation);
    }
  }

  function confirmClearVideo(slot: TemplateVideoSlot) {
    if (editor.kind !== "template") return;
    if (!Object.hasOwn(templateDraft.clips, slot.id) && !templateDraft.missingSlots.includes(slot.id)) return;
    const operation = { kind: "clear-video" } as const;
    if (!begin(operation)) return;

    Alert.alert(
      `Clear video for ${slot.label}?`,
      "This empties the slot in this draft. Your original video stays in place.",
      [
        { text: "Cancel", style: "cancel", onPress: () => finish(operation) },
        {
          text: "Clear video",
          style: "destructive",
          onPress: () => {
            if (!isCurrentOperation(operation)) return;
            try {
              commitDraftEdit(
                editor,
                { ...templateDraft, ...clearTemplateVideoSlot(templateDraft, slot.id) },
                "clear video",
              );
            } catch (cause) {
              setFeedback({
                kind: "error",
                slotId: slot.id,
                message: errorMessage(`Couldn’t clear the video for ${slot.label}.`, cause),
              });
            } finally {
              finish(operation);
            }
          },
        },
      ],
    );
  }

  function openSlotEdit(kind: SlotEdit["kind"], slot: TemplateVideoSlot) {
    const clip = templateDraft.clips[slot.id];
    if (kind === "volume" && templateDraft.missingSlots.includes(slot.id)) return;
    if (editor.kind === "template" && clip) begin({ kind, editor, slot, clip });
  }

  function applySlotEdit(operation: SlotEdit, update: (clip: TemplateClip) => TemplateClip) {
    if (!isCurrentOperation(operation)) return;
    const { editor, slot, clip } = operation;
    const draft = getEditorDraft(currentTemplateDrafts.current, editor);
    if (draft.clips[slot.id] !== clip) {
      throw new Error("This slot changed. Close the editor and open it again.");
    }

    const updated = update(clip);
    if (updated !== clip) {
      const clips = { ...draft.clips, [slot.id]: updated };
      commitDraftEdit(editor, { ...draft, clips }, slotEditLabels[operation.kind]);
    }
    finish(operation);
  }

  function startSlotSwap(pair?: readonly [TemplateVideoSlot, TemplateVideoSlot]) {
    if (editor.kind !== "template") return;
    const operation: SlotSwap = { kind: "swap", editor, draft: templateDraft };
    if (!begin(operation)) return;
    if (pair) applySlotSwap(operation, ...pair);
  }

  function applySlotSwap(operation: SlotSwap, first: TemplateVideoSlot, second: TemplateVideoSlot) {
    if (!isCurrentOperation(operation)) return;
    const { editor, draft } = operation;
    try {
      const clips = swapTemplateClips(draft.clips, first, second);
      commitDraftEdit(editor, { ...draft, clips }, "swap clips");
    } catch (cause) {
      setFeedback({ kind: "error", scope: "swap", message: errorMessage("Couldn’t swap the clips.", cause) });
      return;
    } finally {
      finish(operation);
    }
    AccessibilityInfo.announceForAccessibilityWithOptions(`Swapped ${first.label} and ${second.label}.`, {
      queue: true,
    });
  }

  function applyTextEdit(operation: TextEdit, textOverrides: TemplateTextOverrides) {
    if (!isCurrentOperation(operation)) return;
    const { editor } = operation;
    const draft = getEditorDraft(currentTemplateDrafts.current, editor);
    if (draft.textOverrides !== operation.textOverrides) {
      throw new Error("This template text changed. Close the editor and open it again.");
    }

    if (textOverrides !== draft.textOverrides) commitDraftEdit(editor, { ...draft, textOverrides }, "text edit");
    finish(operation);
  }

  async function selectTemplateVideos(slots: readonly TemplateVideoSlot[], source: VideoPickerSource) {
    if (editor.kind !== "template" || !slots.length) return;
    const operation: ImportOperation = { kind: "import", source, ...(slots.length === 1 && { slotId: slots[0]!.id }) };
    if (!begin(operation)) return;
    try {
      await importTemplateVideos({
        template: editor.template,
        draftId: editor.draftId,
        slots,
        source,
        isCurrent: () => isCurrentOperation(operation),
        commit: (imported) => {
          const clips = { ...templateDraft.clips, ...imported };
          const missingSlots = templateDraft.missingSlots.filter((id) => !Object.hasOwn(imported, id));
          const ids = Object.keys(imported);
          const replaced = ids.some(
            (id) => Object.hasOwn(templateDraft.clips, id) || templateDraft.missingSlots.includes(id),
          );
          const label = ids.length > 1 ? "import videos" : replaced ? "replace video" : "add video";
          commitDraftEdit(editor, { ...templateDraft, clips, missingSlots }, label);
        },
      });
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        if (cause instanceof SlotImportError) {
          setFeedback({ kind: "error", slotId: cause.slot.id, message: cause.message });
        } else {
          const summary = slots.length > 1 ? "Couldn’t import the selected videos." : "Couldn’t import the video.";
          setFeedback({ ...operation, kind: "error", message: errorMessage(summary, cause) });
        }
      }
    } finally {
      finish(operation);
    }
  }

  function storeSingleDraft(draft: SingleDraft) {
    currentSingleDraft.current = draft;
    setSingleDraft(draft);
  }

  function reopenSingleDraft() {
    try {
      storeSingleDraft({ clip: loadSingleClipDraft(), outputUri: null });
    } catch {
      storeSingleDraft({ clip: null, outputUri: null, loadError: "Couldn’t reopen the saved single-clip draft." });
    }
  }

  function confirmDeleteSingleDraft() {
    const operation = { kind: "delete" } as const;
    if (editor.kind !== "single" || !begin(operation)) return;
    Alert.alert(
      "Delete single-clip draft?",
      "This removes your saved trim and StackReel’s copy of the video. Your original video stays in place.",
      [
        { text: "Cancel", style: "cancel", onPress: () => finish(operation) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (!isCurrentOperation(operation)) return;
            try {
              deleteSingleClipDraft();
              storeSingleDraft({ clip: null, outputUri: null });
              removeCachedFile(singleDraft.outputUri);
              setFeedback({ kind: "status", message: "Single-clip draft deleted." });
            } catch (cause) {
              setFeedback({ kind: "error", message: errorMessage("Couldn’t delete the draft.", cause) });
            } finally {
              finish(operation);
            }
          },
        },
      ],
    );
  }

  function applySingleTrim(operation: SingleTrimEdit, selection: ClipFrameRange) {
    if (!isCurrentOperation(operation)) return;
    publishSingleEdit(trimSingleClipDraft(operation.clip, selection));
    finish(operation);
  }

  function publishSingleEdit(clip: SingleClip) {
    if (clip === singleDraft.clip) return;
    storeSingleDraft({ clip, outputUri: null });
    removeCachedFile(singleDraft.outputUri);
  }

  function changeSingleFraming(fit: SingleClipFit) {
    const clip = singleDraft.clip;
    if (!clip || clip.fit === fit || activeOperation.current || !isCurrentScreen()) return;
    try {
      publishSingleEdit(setSingleClipFit(clip, fit));
      setFeedback(null);
    } catch (cause) {
      setFeedback({ kind: "error", scope: "framing", message: errorMessage("Couldn’t save the framing.", cause) });
    }
  }

  async function selectSingleVideo(source: VideoPickerSource) {
    const operation: ImportOperation = { kind: "import", source };
    if (singleDraft.loadError || !begin(operation)) return;
    let pickedUri: string | undefined;
    try {
      const asset = await pickVideo(source);
      if (!asset) return;
      pickedUri = asset.uri;
      if (!isCurrentOperation(operation)) return;
      const metadata = await probeVideo(pickedUri);
      if (!isCurrentOperation(operation)) return;
      const clip = await importSingleClipDraft(asset, metadata, () => isCurrentOperation(operation));
      if (!clip || !isCurrentOperation(operation)) return;
      storeSingleDraft({ clip, outputUri: null });
      removeCachedFile(outputUri);
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        setFeedback({ kind: "error", message: errorMessage("Couldn’t import the video.", cause) });
      }
    } finally {
      discardPickerCopy(pickedUri);
      finish(operation);
    }
  }

  async function selectMusic() {
    if (editor.kind !== "template") return;
    const operation = { kind: "import-music" } as const;
    if (!begin(operation)) return;
    let pickedUri: string | undefined;
    let draftMedia: File | undefined;
    try {
      const result = await getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (result.canceled) return;
      const [asset] = result.assets;
      if (!asset) throw new Error("Files did not return an audio file.");
      pickedUri = asset.uri;
      if (!isCurrentOperation(operation)) return;

      const metadata = await probeAudio(pickedUri);
      if (!isCurrentOperation(operation)) return;

      const music = createTemplateMusic(pickedUri, asset.name, metadata);
      draftMedia = createDraftMediaFile(editor.template, asset.name, editor.draftId);
      await new File(pickedUri).move(draftMedia);
      if (!isCurrentOperation(operation)) return;
      commitDraftEdit(
        editor,
        { ...templateDraft, music: { ...music, uri: draftMedia.uri }, missingMusic: false },
        templateDraft.music || templateDraft.missingMusic ? "replace music" : "add music",
      );
      draftMedia = undefined;
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        setFeedback({ kind: "error", scope: "music", message: errorMessage("Couldn’t import the music.", cause) });
      }
    } finally {
      if (draftMedia) removeDraftFile(draftMedia);
      removeCachedFile(pickedUri);
      finish(operation);
    }
  }

  function openMusicVolume() {
    const { music, missingMusic } = templateDraft;
    if (editor.kind === "template" && music && !missingMusic) begin({ kind: "music-volume", editor, music });
  }

  function applyMusicVolume(operation: MusicVolumeEdit, percent: number) {
    if (!isCurrentOperation(operation)) return;
    const { editor, music } = operation;
    const draft = getEditorDraft(currentTemplateDrafts.current, editor);
    if (draft.music !== music || draft.missingMusic) {
      throw new Error("The soundtrack changed. Close the editor and open it again.");
    }
    const updated = setTemplateMusicVolume(music, percent);
    if (updated !== music) commitDraftEdit(editor, { ...draft, music: updated }, "music volume");
    finish(operation);
  }

  function removeMusic() {
    if (editor.kind !== "template") return;
    const operation = { kind: "remove-music" } as const;
    if ((!templateDraft.music && !templateDraft.missingMusic) || !begin(operation)) return;
    try {
      commitDraftEdit(editor, clearTemplateMusic(templateDraft), "remove music");
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
      if (isCurrentOperation(job)) {
        if (editor.kind === "template") {
          storeTemplateDraft(editor, { ...templateDraft, outputUri: uri });
        } else {
          storeSingleDraft({ ...singleDraft, outputUri: uri });
        }
        if (uri !== outputUri) removeCachedFile(outputUri);
      } else {
        removeCachedFile(uri);
      }
    } catch (cause) {
      if (isCurrentOperation(job)) {
        if (job.cancelling) setFeedback({ kind: "status", message: "Export cancelled." });
        else setFeedback({ kind: "error", message: errorMessage("Couldn’t export the MP4.", cause) });
      }
    } finally {
      finish(job);
    }
  }

  async function requestCancel(exportId: string) {
    const job = activeOperation.current;
    if (job?.kind !== "export" || job.id !== exportId || job.cancelling || !isCurrentScreen()) return;
    job.cancelling = true;
    setFeedback(null);
    setActivity((current) => (current?.kind === "export" ? { ...current, cancelling: true } : current));
    try {
      await cancelExport(job.id);
    } catch (cause) {
      if (isCurrentOperation(job)) {
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
      if (isCurrentOperation(operation)) await shareAsync(outputUri, { UTI: "public.mpeg-4" });
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        setFeedback({ kind: "error", message: errorMessage("Couldn’t share the MP4.", cause) });
      }
    } finally {
      finish(operation);
    }
  }

  async function saveVideoToPhotos() {
    const operation = { kind: "save-photos" } as const;
    if (!outputUri || !begin(operation)) return;

    function reportResult(kind: Feedback["kind"], message: string) {
      if (!isCurrentOperation(operation)) return;
      setFeedback({ kind, message });
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    }

    try {
      const { granted, canAskAgain } = await requestPermissionsAsync(true);
      if (!isCurrentOperation(operation)) return;
      if (!granted) {
        reportResult(
          "error",
          canAskAgain
            ? "Allow Photos access to save the video, or use Share MP4."
            : "Allow StackReel to add to Photos in Settings, or use Share MP4.",
        );
        return;
      }
      await Asset.create(outputUri);
      reportResult("status", "Saved to Photos.");
    } catch (cause) {
      reportResult("error", errorMessage("Couldn’t save the MP4 to Photos.", cause));
    } finally {
      finish(operation);
    }
  }

  if (editor.kind === "home") {
    const homeTab = editor.tab;
    return (
      <Screen
        page={editor.filter?.id ?? homeTab}
        footer={templateDrafts && <HomeTabBar activeTab={homeTab} disabled={busy} onSelect={selectHomeTab} />}
      >
        {discoveryErrors.length > 0 && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            Couldn’t list all saved drafts for {discoveryErrors.join(", ")}. Reopen StackReel to try again.
          </Text>
        )}
        {!templateDrafts ? (
          <Text style={textStyles.muted}>Opening saved drafts…</Text>
        ) : homeTab === "projects" ? (
          <TemplateProjects
            drafts={templateDrafts}
            filter={editor.filter}
            singleClipDraftName={singleDraft.clip?.name ?? (singleDraft.loadError ? "Single-clip draft" : null)}
            singleClipLoadError={singleDraft.loadError}
            onSelectSingleClip={() => navigate({ kind: "single", home: editor })}
            duplicating={activity?.kind === "duplicate" ? activity : null}
            onShowAll={() => selectHomeTab("projects")}
            onOpenDraft={openDraft}
            onDuplicateDraft={duplicateDraft}
            onRenameDraft={promptRenameDraft}
            onDeleteDraft={confirmDeleteDraft}
            onBrowseTemplates={() => selectHomeTab("templates")}
          />
        ) : (
          <TemplateGallery
            drafts={templateDrafts}
            onSelectTemplate={openTemplate}
            onNewDraft={createDraft}
            onSelectSingleClip={() => navigate({ kind: "single", home: editor })}
          />
        )}
      </Screen>
    );
  }

  const fromProjects = editor.home.tab === "projects";
  const backLabel = fromProjects ? "Back to projects" : "Back to templates";
  if (editor.kind === "template" && templateDraft.loadError) {
    return (
      <Screen page={editor.draftId}>
        <Text accessibilityRole="header" style={textStyles.heading}>
          {templateDraft.name ?? editor.template.name}
        </Text>
        <Text accessibilityRole="alert" style={textStyles.error}>
          {templateDraft.loadError}
        </Text>
        <Text style={textStyles.body}>
          To keep this draft and start another, choose New draft on the template’s card in Templates. You can also
          delete this draft from Projects.
        </Text>
        {!fromProjects && <Action label="Go to Projects" onPress={() => selectHomeTab("projects")} primary />}
        <Action label={backLabel} onPress={() => navigate({ ...editor.home })} />
      </Screen>
    );
  }

  const importing = activity?.kind === "import";
  const exporting = activity?.kind === "export";
  const trimming = activity?.kind === "trim";
  const reframing = activity?.kind === "reframe";
  const adjustingVolume = activity?.kind === "volume";
  const previewTemplateGainDb =
    trimming || reframing || adjustingVolume
      ? getSlotPreviewTemplateGainDb(activity.editor.template, activity.slot.id)
      : undefined;
  const swapping = activity?.kind === "swap";
  const editingText = activity?.kind === "text";
  const clip = singleDraft.clip;
  const { undoLabel, redoLabel } = historyLabels;
  const editorDetails = (
    <>
      <View style={styles.navigation}>
        <Action label={backLabel} onPress={() => navigate({ ...editor.home })} disabled={busy} />
      </View>
      <View style={styles.details}>
        <Text accessibilityRole="header" style={textStyles.heading}>
          {templateDraft.name ?? template?.name ?? "Single-clip editor"}
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
      {editor.kind === "template" && (
        <>
          <View role="toolbar" accessibilityLabel="Edit history" style={styles.buttonRow}>
            <Action
              label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
              testID="template-undo"
              onPress={() => applyDraftHistory("undo")}
              disabled={busy || !undoLabel}
            />
            <Action
              label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
              testID="template-redo"
              onPress={() => applyDraftHistory("redo")}
              disabled={busy || !redoLabel}
            />
          </View>
          {feedback?.scope === "history" && (
            <Text accessibilityRole="alert" style={textStyles.error}>
              {feedback.message}
            </Text>
          )}
        </>
      )}
      {editor.kind === "template" && textFields.length > 0 && (
        <View style={styles.navigation}>
          <Action
            label="Edit text"
            testID="edit-template-text"
            onPress={() => begin({ kind: "text", editor, textOverrides: templateDraft.textOverrides })}
            disabled={busy}
          />
        </View>
      )}
      {editor.kind === "template" && (
        <TemplateVideoSlots
          slots={editor.slots}
          clips={templateDraft.clips}
          missingSlots={templateDraft.missingSlots}
          busy={busy}
          importingSlotId={importing ? activity.slotId : undefined}
          importingFrom={importing ? activity.source : undefined}
          slotError={feedback?.kind === "error" && feedback.slotId !== undefined ? feedback : null}
          swapError={feedback?.scope === "swap" ? feedback.message : undefined}
          onSelectOrdered={(slots) => selectTemplateVideos(slots, "Photos")}
          onSelect={(slot, source) => selectTemplateVideos([slot], source)}
          onTrim={(slot) => openSlotEdit("trim", slot)}
          onReframe={(slot) => openSlotEdit("reframe", slot)}
          onVolume={(slot) => openSlotEdit("volume", slot)}
          onClear={confirmClearVideo}
          onChooseSwap={() => startSlotSwap()}
          onSwap={(first, second) =>
            swapping ? applySlotSwap(activity, first, second) : startSlotSwap([first, second])
          }
          onCancelSwap={swapping ? () => finish(activity) : undefined}
        />
      )}
      {editor.kind === "single" && !singleDraft.loadError && (
        <VideoImportActions
          replace={clip !== null}
          importingFrom={importing ? activity.source : undefined}
          busy={busy}
          primary={clip === null}
          onSelect={selectSingleVideo}
        />
      )}
      {editor.kind === "single" && (clip || singleDraft.loadError) && (
        <>
          {singleDraft.loadError && (
            <Text accessibilityRole="alert" style={textStyles.error}>
              {singleDraft.loadError} Try again or delete this draft to start another.
            </Text>
          )}
          <View style={styles.navigation}>
            {clip ? (
              <Action
                label="Trim clip"
                testID="single-trim-open"
                onPress={() => begin({ kind: "single-trim", clip })}
                disabled={busy}
              />
            ) : (
              <Action
                label="Try again"
                onPress={() => {
                  if (activeOperation.current || !isCurrentScreen()) return;
                  setFeedback(null);
                  reopenSingleDraft();
                }}
                disabled={busy}
              />
            )}
            <Action
              label="Delete draft"
              testID="single-draft-delete"
              onPress={confirmDeleteSingleDraft}
              disabled={busy}
            />
          </View>
          {clip && (
            <View style={styles.details}>
              <Text style={textStyles.body}>Framing</Text>
              <View style={styles.buttonRow}>
                {framingOptions.map(({ fit, label }) => (
                  <Action
                    key={fit}
                    label={clip.fit === fit ? `✓ ${label}` : label}
                    accessibilityLabel={label}
                    testID={`single-framing-${label.toLowerCase()}`}
                    selected={clip.fit === fit}
                    primary={clip.fit === fit}
                    disabled={busy}
                    onPress={() => changeSingleFraming(fit)}
                  />
                ))}
              </View>
              {feedback?.scope === "framing" && (
                <Text accessibilityRole="alert" style={textStyles.error}>
                  {feedback.message}
                </Text>
              )}
            </View>
          )}
        </>
      )}
    </>
  );
  const editorActions = (
    <>
      {editor.kind === "single" && !source && !singleDraft.loadError && (
        <PreviewFrame canvas={canvas}>
          <Text style={textStyles.muted}>Choose a video to preview.</Text>
        </PreviewFrame>
      )}
      {editor.kind === "template" && !source && (
        <Text style={textStyles.muted}>Add all required videos to preview and export.</Text>
      )}
      {editor.kind === "template" && editor.template.audio?.music && (
        <TemplateMusicControls
          music={templateDraft.music}
          missingMusic={templateDraft.missingMusic}
          busy={busy}
          importing={activity?.kind === "import-music"}
          error={feedback?.scope === "music" ? feedback.message : undefined}
          onVolume={openMusicVolume}
          onSelect={selectMusic}
          onRemove={removeMusic}
        />
      )}
      <View style={styles.actions}>
        {feedback && feedback.slotId === undefined && feedback.scope === undefined && (
          <Text accessibilityRole="alert" style={feedback.kind === "error" ? textStyles.error : textStyles.muted}>
            {feedback.message}
          </Text>
        )}
        {exporting && (
          <>
            <ExportProgress percentage={Math.floor(activity.progress * 100)} />
            <Action
              label={activity.cancelling ? "Cancelling…" : "Cancel export"}
              onPress={() => requestCancel(activity.id)}
              disabled={activity.cancelling}
            />
          </>
        )}
        {outputUri && (
          <>
            <Action
              label={activity?.kind === "save-photos" ? "Saving to Photos…" : "Save to Photos"}
              onPress={saveVideoToPhotos}
              disabled={busy}
            />
            <Action
              label={activity?.kind === "share" ? "Sharing…" : "Share MP4"}
              onPress={shareVideo}
              disabled={busy}
              primary
            />
          </>
        )}
        {(editor.kind === "template" || source) && !exporting && (
          <Action
            label="Export MP4"
            onPress={startExport}
            disabled={busy || !source}
            primary={!!source && !outputUri}
          />
        )}
      </View>
    </>
  );
  const editorScreen = (
    <Screen
      ref={editorScreenRef}
      page={editor.kind === "template" ? editor.draftId : "single-clip"}
      fullScreen={fullScreen}
    >
      {activity?.kind === "single-trim" && (
        <SingleClipTrim
          clip={activity.clip}
          onApply={(selection) => applySingleTrim(activity, selection)}
          onCancel={() => finish(activity)}
        />
      )}
      {trimming && (
        <TemplateTrim
          slot={activity.slot}
          clip={activity.clip}
          previewGainDb={getTemplateGainDb(activity.clip.volumePercent, previewTemplateGainDb)}
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
          canvas={activity.editor.template.canvas}
          previewGainDb={getTemplateGainDb(activity.clip.volumePercent, previewTemplateGainDb)}
          onApply={(reframe) =>
            applySlotEdit(activity, (clip) => setTemplateClipReframe(clip, activity.editor.template.canvas, reframe))
          }
          onCancel={() => finish(activity)}
        />
      )}
      {adjustingVolume && (
        <TemplateVolume
          slot={activity.slot}
          clip={activity.clip}
          canvas={activity.editor.template.canvas}
          templateGainDb={previewTemplateGainDb}
          onApply={(percent) => applySlotEdit(activity, (clip) => setTemplateClipVolume(clip, percent))}
          onCancel={() => finish(activity)}
        />
      )}
      {activity?.kind === "music-volume" && (
        <VolumeSheet
          id="music"
          title="Music volume"
          filename={activity.music.name}
          levelLabel="Background music"
          accessibilitySubject="background music"
          sliderLabel="Background music volume"
          initialVolume={activity.music.volumePercent ?? 100}
          canvas={activity.editor.template.canvas}
          createPreview={(percent) =>
            createTemplateSource(
              activity.editor.template,
              templateDraft.clips,
              templateDraft.textOverrides,
              setTemplateMusicVolume(activity.music, percent),
            )
          }
          onApply={(percent) => applyMusicVolume(activity, percent)}
          onCancel={() => finish(activity)}
        />
      )}
      {!fullScreen && editorDetails}
      {source && (
        <ClipPreview
          key={source}
          canvas={canvas}
          source={source}
          suspended={busy && !exporting}
          fullScreen={{
            active: fullScreen,
            disabled: busy,
            onChange: (expanded) => {
              if (expanded) {
                if (begin({ kind: "fullscreen" })) editorScreenRef.current?.saveScrollPosition();
              } else if (fullScreen) {
                finish(activity);
              }
            },
          }}
          safeZoneGuide={template ? getTemplateSafeZoneGuide(template) : null}
        />
      )}
      {!fullScreen && editorActions}
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

function HomeTabBar({
  activeTab,
  disabled,
  onSelect,
}: {
  activeTab: HomeTab;
  disabled: boolean;
  onSelect: (tab: HomeTab) => void;
}) {
  return (
    <View style={styles.tabBar}>
      <View accessibilityRole="tablist" style={styles.tabRow}>
        {homeTabs.map(({ id, label }) => {
          const selected = id === activeTab;
          return (
            <Pressable
              key={id}
              testID={`home-tab-${id}`}
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(id)}
              style={({ pressed }) => [styles.tab, (selected || pressed) && styles.activeTab]}
            >
              <Text style={[styles.tabLabel, selected && styles.activeTabLabel]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ExportProgress({ percentage }: { percentage: number }) {
  useKeepAwake();

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

const styles = StyleSheet.create({
  tabBar: {
    alignItems: "center",
    paddingHorizontal: space[5],
    paddingTop: space[2],
    borderTopColor: darkColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabRow: { flexDirection: "row", width: "100%", maxWidth: 440, gap: space[2] },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    padding: space[2],
  },
  activeTab: { backgroundColor: darkColors.elevated },
  tabLabel: { color: darkColors.textMuted, fontSize: fontSize.md, fontWeight: "600", textAlign: "center" },
  activeTabLabel: { color: darkColors.accent },
  navigation: { alignSelf: "flex-start" },
  details: { gap: space[1] },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  actions: { gap: space[2] },
  progress: { gap: space[2], marginBottom: space[1] },
  progressTrack: { height: 6, borderRadius: radius.full, backgroundColor: darkColors.border, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: darkColors.accent },
});
