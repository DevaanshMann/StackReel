import { frameToUs } from "@stackreel/core";
import { addExportProgressListener, cancelExport, exportMP4, probeVideo } from "@stackreel/engine";
import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { useKeepAwake } from "expo-keep-awake";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ClipPreview, PreviewFrame, errorMessage } from "./ClipPreview";
import type { ClipPreviewRef } from "./ClipPreview";
import { ReframeSheet } from "./ReframeSheet";
import { Action, Screen, textStyles } from "./Screen";
import type { ScreenRef } from "./Screen";
import { SingleClipCaptionEditor } from "./SingleClipCaptionEditor";
import { SingleClipFramePanel } from "./SingleClipFramePanel";
import { SingleClipToolDock } from "./SingleClipToolDock";
import { SingleClipTrim } from "./SingleClipTrim";
import { TemplateExample } from "./TemplateExample";
import { TemplateMusicControls } from "./TemplateMusicControls";
import { TemplateMusicStart } from "./TemplateMusicStart";
import { TemplateGallery, TemplateProjects, TemplateVideoSlots } from "./TemplateSelection";
import type { ImportRecovery } from "./TemplateSelection";
import { TemplateTextEditor } from "./TemplateTextEditor";
import { TemplateTrim } from "./TemplateTrim";
import { TemplateVolume, VolumeSheet } from "./TemplateVolume";
import { VideoImportActions } from "./VideoImportActions";
import { canvas as singleClipCanvas } from "./clip-source";
import type { ClipFrameRange, SingleClipFit, SingleClipResolution } from "./clip-source";
import { clearDraftExport, restoreDraftExport, retainDraftExport } from "./draft-export";
import { discardPickerCopy } from "./draft-files";
import { getNamedDrafts, nextDraftName } from "./draft-names";
import {
  createSingleClipDraftId,
  createSingleClipDraftSession,
  createSingleClipSource,
  deleteSingleClipDraft,
  importSingleClipDraft,
  legacySingleClipDraftId,
  listSingleClipDraftIds,
  loadSingleClipDraft,
  MissingSingleClipVideoError,
  relinkSingleClipDraft,
  setSingleClipCaption,
  setSingleClipExportResolution,
  setSingleClipFit,
  setSingleClipReframe,
  setSingleClipVolume,
  trimSingleClipDraft,
} from "./single-clip-draft";
import type { SingleClip, SingleClipRecovery } from "./single-clip-draft";
import {
  clearTemplateMusic,
  clearTemplateVideoSlot,
  commitTemplateDraftUpdate,
  createTemplateDraftSession,
  deleteTemplateDraft,
  duplicateTemplateDraft,
  listTemplateDraftIds,
  loadTemplateDraft,
  renameTemplateDraft,
} from "./template-drafts";
import type { TemplateDraftEdits, TemplateDraftSession } from "./template-drafts";
import {
  createTemplateSource,
  getTemplateGainDb,
  getTemplateTextFields,
  mobileTemplates,
  setTemplateClipReframe,
  setTemplateClipTrim,
  setTemplateClipVolume,
  setTemplateMusicStart,
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
import { importTemplateMusic } from "./template-music-import";
import type { MusicSource } from "./template-music-import";
import { getTemplateSafeZoneGuide } from "./template-safe-zones";
import { createBeforeAfterSample } from "./template-sample";
import { getStoryboardCueTimes } from "./template-storyboard";
import { importTemplateVideos, removeCachedFile, SlotImportError } from "./template-video-import";
import { pickVideo } from "./video-picker";
import type { VideoPickerSource } from "./video-picker";
import { getVolumeGainDb } from "./volume";

type SingleDraft = {
  clip: SingleClip | null;
  outputUri: string | null;
  loadError?: string;
  recovery?: SingleClipRecovery;
};
type SingleDrafts = Readonly<Record<string, SingleDraft>>;
type TemplateDraft = TemplateDraftEdits & {
  source: string | null;
  outputUri: string | null;
  missingSlots: readonly string[];
  recoverableSlots: Readonly<Record<string, string>>;
  missingMusic: boolean;
  loadError?: string;
};
type TemplateDrafts = Readonly<Record<string, Readonly<Record<string, TemplateDraft>>>>;
type HistoryLabels = Pick<TemplateDraftSession, "undoLabel" | "redoLabel">;
type HistoryDirection = "undo" | "redo";
type Home = { kind: "home"; tab: HomeTab; filter?: MobileTemplate | "single" };
type TemplateEditor = {
  kind: "template";
  template: MobileTemplate;
  draftId: string;
  slots: TemplateVideoSlot[];
  home: Home;
};
type Editor = Home | { kind: "single"; draftId: string; home: Home } | TemplateEditor;
type ImportOperation = { kind: "import"; source: VideoPickerSource; slotId?: string; relink?: boolean };
type SlotEdit = {
  kind: "trim" | "reframe" | "volume";
  editor: TemplateEditor;
  slot: TemplateVideoSlot;
  clip: TemplateClip;
};
type SingleTrimEdit = { kind: "single-trim"; clip: SingleClip };
type MusicEdit = { kind: "music-volume" | "music-start"; editor: TemplateEditor; music: TemplateMusic };
type SlotSwap = { kind: "swap"; editor: TemplateEditor; draft: TemplateDraft };
type TextEdit = { kind: "text"; editor: TemplateEditor; textOverrides: TemplateTextOverrides };
type ExportJob = { kind: "export"; id: string; cancelling: boolean };
type Operation =
  | ImportOperation
  | { kind: "sample" }
  | { kind: "example"; template: MobileTemplate; source: number }
  | { kind: "fullscreen" }
  | SlotEdit
  | SingleTrimEdit
  | { kind: "single-reframe" | "single-volume" | "single-caption"; clip: SingleClip }
  | MusicEdit
  | SlotSwap
  | TextEdit
  | { kind: HistoryDirection }
  | { kind: "duplicate"; templateId: string; draftId: string }
  | { kind: "import-music"; source: MusicSource; relink: boolean }
  | { kind: "clear-video" | "remove-music" | "share" | "save-photos" | "rename" | "delete" }
  | ExportJob;
type Activity =
  | Exclude<Operation, ExportJob | ImportOperation>
  | (ImportOperation & { recovery?: ImportRecovery })
  | (ExportJob & { progress: number });
type Feedback = {
  kind: "error" | "status";
  message: string;
  slotId?: string;
  scope?: "music" | "swap" | "history" | "framing" | "relink";
};

const homeTabs = [
  { id: "templates", label: "Templates" },
  { id: "projects", label: "Projects" },
] as const;
type HomeTab = (typeof homeTabs)[number]["id"];

const emptySingleDraft: SingleDraft = { clip: null, outputUri: null };
const emptyTemplateDraft: TemplateDraft = {
  clips: {},
  textOverrides: {},
  music: null,
  source: null,
  outputUri: null,
  missingSlots: [],
  recoverableSlots: {},
  missingMusic: false,
  recoverableMusic: null,
};

const firstScreen: Home = { kind: "home", tab: "templates" };
const emptyHistoryLabels: HistoryLabels = { undoLabel: null, redoLabel: null };
const slotEditLabels: Record<SlotEdit["kind"], string> = {
  trim: "trim",
  reframe: "reframe",
  volume: "clip volume",
};

function readSingleDraft(draftId: string): SingleDraft | null {
  try {
    const clip = loadSingleClipDraft(draftId);
    return clip ? { clip, outputUri: null } : null;
  } catch (cause) {
    if (cause instanceof MissingSingleClipVideoError) {
      return { ...emptySingleDraft, loadError: "Saved video unavailable. Relink to resume.", recovery: cause.recovery };
    }
    return { ...emptySingleDraft, loadError: "Couldn’t reopen the saved single-clip draft." };
  }
}

function singleExportSource(clip: SingleClip) {
  return clip.exportResolution === 720 ? clip.source : createSingleClipSource(clip, clip.exportResolution);
}

function restoreSingleOutput(draftId: string, draft: SingleDraft | null) {
  if (!draft?.clip || draft.outputUri) return draft;
  const uri = restoreDraftExport({ kind: "single", draftId }, singleExportSource(draft.clip));
  return uri ? { ...draft, outputUri: uri } : draft;
}

function getEditorDraft(drafts: TemplateDrafts | null, editor: Editor) {
  return editor.kind === "template"
    ? (drafts?.[editor.template.id]?.[editor.draftId] ?? emptyTemplateDraft)
    : emptyTemplateDraft;
}

function openDraftSession(editor: Editor, drafts: TemplateDrafts | null, singles: SingleDrafts) {
  if (editor.kind === "single" && !singles[editor.draftId]?.loadError) {
    return { kind: editor.kind, history: createSingleClipDraftSession(editor.draftId) } as const;
  }
  if (editor.kind === "template" && !getEditorDraft(drafts, editor).loadError) {
    return { kind: editor.kind, history: createTemplateDraftSession(editor.template, editor.draftId) } as const;
  }
  return null;
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
  const reelPreviewRef = useRef<ClipPreviewRef>(null);
  const frameButtonRef = useRef<ComponentRef<typeof Pressable>>(null);
  const [frameOpen, setFrameOpen] = useState(false);
  const activeOperation = useRef<Operation | null>(null);
  const pendingImportChoice = useRef<ImportRecovery["answer"] | null>(null);
  const currentEditor = useRef<Editor>(firstScreen);
  const currentTemplateDrafts = useRef<TemplateDrafts | null>(null);
  const currentDraftSession = useRef<ReturnType<typeof openDraftSession>>(null);
  const [discoveryErrors, setDiscoveryErrors] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor>(firstScreen);
  const [selectedSlotId, setSelectedSlotId] = useState<string>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [singleDrafts, setSingleDrafts] = useState<SingleDrafts>({});
  const currentSingleDrafts = useRef(singleDrafts);
  const [templateDrafts, setTemplateDrafts] = useState<TemplateDrafts | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [historyLabels, setHistoryLabels] = useState(emptyHistoryLabels);

  const template = editor.kind === "template" ? editor.template : null;
  const cueTimes = useMemo(() => (template ? getStoryboardCueTimes(template) : {}), [template]);
  const textFields = template ? getTemplateTextFields(template) : [];
  const templateDraft = getEditorDraft(templateDrafts, editor);
  const singleDraft = editor.kind === "single" ? (singleDrafts[editor.draftId] ?? emptySingleDraft) : emptySingleDraft;
  const singleProjects = useMemo(
    () => getNamedDrafts(singleDrafts, (draft) => draft.clip?.name ?? draft.recovery?.name ?? "Single-clip draft"),
    [singleDrafts],
  );
  const singleProjectLabel =
    editor.kind === "single" ? singleProjects.find((project) => project.draftId === editor.draftId)?.label : undefined;
  const source = template ? templateDraft.source : (singleDraft.clip?.source ?? null);
  const outputUri = template ? templateDraft.outputUri : singleDraft.outputUri;
  const canvas = template?.canvas ?? singleClipCanvas;
  const fullScreen = activity?.kind === "fullscreen";
  const busy = activity !== null && !fullScreen;

  useEffect(() => {
    const drafts: Record<string, Record<string, TemplateDraft>> = {};
    const failed: string[] = [];
    let singleIds: string[];
    try {
      singleIds = listSingleClipDraftIds();
    } catch {
      failed.push("Single-clip editor");
      singleIds = [legacySingleClipDraftId];
    }
    const singles: Record<string, SingleDraft> = {};
    for (const id of singleIds) {
      const draft = readSingleDraft(id);
      if (draft) singles[id] = draft;
    }
    storeSingleDrafts(singles);
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
    resetDraftSession(currentEditor.current);
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
      pendingImportChoice.current?.(false);
      subscription.remove();
      const job = activeOperation.current;
      activeOperation.current = null;
      if (job?.kind === "export" && !job.cancelling) void cancelExport(job.id).catch(() => undefined);
      currentDraftSession.current?.history.close();
      currentDraftSession.current = null;
    };
  }, []);

  function isCurrentScreen() {
    if (!mounted.current || currentEditor.current !== editor) return false;
    // Ignore queued handlers from before a synchronous commit or a change to the Projects list.
    if (editor.kind === "home")
      return currentTemplateDrafts.current === templateDrafts && currentSingleDrafts.current === singleDrafts;
    if (editor.kind === "single") return currentSingleDrafts.current === singleDrafts;
    return getEditorDraft(currentTemplateDrafts.current, editor) === templateDraft;
  }

  function isCurrentOperation(operation: Operation) {
    return activeOperation.current === operation && isCurrentScreen();
  }

  function begin(operation: Operation) {
    if (activeOperation.current || !isCurrentScreen()) return false;
    activeOperation.current = operation;
    setActivity(operation.kind === "export" ? { ...operation, progress: 0 } : operation);
    if (operation.kind !== "fullscreen") {
      setFrameOpen(false);
      setFeedback(null);
    }
    return true;
  }

  function finish(operation: Operation) {
    if (activeOperation.current !== operation) return;
    activeOperation.current = null;
    setActivity(null);
  }

  function resetDraftSession(next: Editor) {
    currentDraftSession.current?.history.close();
    currentDraftSession.current = openDraftSession(next, currentTemplateDrafts.current, currentSingleDrafts.current);
    setHistoryLabels(emptyHistoryLabels);
  }

  function navigate(next: Editor) {
    if (!mounted.current || activeOperation.current || currentEditor.current !== editor) return;
    resetDraftSession(next);
    currentEditor.current = next;
    setSelectedSlotId(undefined);
    setFrameOpen(false);
    setFeedback(null);
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
    const draft = templateDrafts?.[template.id]?.[draftId];
    if (editor.kind !== "home" || activeOperation.current || !isCurrentScreen() || !draft) return;
    const next: TemplateEditor = { kind: "template", template, slots, draftId, home: editor };
    if (!draft.loadError && !draft.outputUri) {
      const uri = restoreDraftExport(next, draft.source);
      if (uri) storeTemplateDraft(next, { ...draft, outputUri: uri });
    }
    navigate(next);
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

  async function editSampleReel(template: MobileTemplate, slots: TemplateVideoSlot[]) {
    const operation = { kind: "sample" } as const;
    if (editor.kind !== "home" || editor.tab !== "templates" || !begin(operation)) return;
    try {
      const base = "Balcony in bloom";
      const siblings = templateDrafts?.[template.id] ?? {};
      const name = Object.values(siblings).some((draft) => draft.name?.toLowerCase() === base.toLowerCase())
        ? nextDraftName(base, siblings)
        : base;
      const draftId = randomUUID();
      AccessibilityInfo.announceForAccessibility("Preparing sample reel.");
      const sample = await createBeforeAfterSample(template, draftId, name, () => isCurrentOperation(operation));
      if (!isCurrentOperation(operation)) return;
      if (!sample) throw new Error("The sample is unavailable.");
      storeTemplateDraft({ template, draftId }, { ...sample.draft, source: sample.source, outputUri: null });
      finish(operation);
      navigate({ kind: "template", template, slots, draftId, home: editor });
      AccessibilityInfo.announceForAccessibilityWithOptions(`Opened ${name}.`, { queue: true });
    } catch {
      if (isCurrentOperation(operation)) {
        const message = "Couldn’t prepare the sample reel. Tap Edit sample reel to try again.";
        setFeedback({ kind: "error", message });
        AccessibilityInfo.announceForAccessibility(message);
      }
    } finally {
      finish(operation);
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
              clearDraftExport({ kind: "template", template, draftId });
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
    if (draft.outputUri !== previousOutputUri) {
      clearDraftExport(editor);
      removeCachedFile(previousOutputUri);
    }
  }

  function commitDraftEdit(editor: TemplateEditor, draft: TemplateDraft, label: string) {
    const session = currentDraftSession.current;
    if (session?.kind !== "template" || draft.loadError)
      throw new Error(draft.loadError ?? "The draft editor is closed.");
    const edits = { ...draft, name: draft.name ?? editor.template.name };
    const saved = session.history.commit(edits, label);
    publishDraftEdit(editor, { ...edits, ...saved }, draft.outputUri, session.history);
  }

  function applyDraftHistory(direction: HistoryDirection) {
    const session = currentDraftSession.current;
    if (!session) return;
    const label = direction === "undo" ? session.history.undoLabel : session.history.redoLabel;
    const operation = { kind: direction };
    if (!label || !begin(operation)) return;

    try {
      if (session.kind === "single") {
        publishSingleEdit(session.history[direction]());
      } else if (editor.kind === "template") {
        const restored = session.history[direction]({ source, outputUri });
        if (!restored) return;
        publishDraftEdit(editor, restored, outputUri, session.history);
      }
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

  async function selectTemplateVideos(slots: readonly TemplateVideoSlot[], source: VideoPickerSource, relink = false) {
    if (editor.kind !== "template" || !slots.length) return;
    const session = currentDraftSession.current;
    if (session?.kind !== "template") return;
    const operation: ImportOperation = {
      kind: "import",
      source,
      relink,
      ...(slots.length === 1 && { slotId: slots[0]!.id }),
    };
    if (!begin(operation)) return;
    try {
      await importTemplateVideos({
        template: editor.template,
        draftId: editor.draftId,
        slots,
        source,
        isCurrent: () => isCurrentOperation(operation),
        ...(relink && operation.slotId && { validateClip: session.history.prepareRelink(operation.slotId) }),
        onInvalidVideo: (error) =>
          new Promise<boolean>((resolve) => {
            if (!isCurrentOperation(operation)) return resolve(false);
            const answer = (replace: boolean) => {
              if (pendingImportChoice.current !== answer) return;
              pendingImportChoice.current = null;
              const current = isCurrentOperation(operation);
              if (current) setActivity(operation);
              resolve(current && replace);
            };
            pendingImportChoice.current = answer;
            setActivity({ ...operation, recovery: { error, answer } });
            AccessibilityInfo.announceForAccessibility(error.message);
          }),
        commit: (imported) => {
          if (relink && operation.slotId) {
            const restored = session.history.relink(operation.slotId, imported[operation.slotId]!, templateDraft);
            publishDraftEdit(editor, restored, templateDraft.outputUri, session.history);
            return;
          }
          const clips = { ...templateDraft.clips, ...imported };
          const missingSlots = templateDraft.missingSlots.filter((id) => !Object.hasOwn(imported, id));
          const ids = Object.keys(imported);
          const replaced = ids.some(
            (id) => Object.hasOwn(templateDraft.clips, id) || templateDraft.missingSlots.includes(id),
          );
          const label = ids.length > 1 ? "import videos" : replaced ? "replace video" : "add video";
          const recoverableSlots = Object.fromEntries(
            Object.entries(templateDraft.recoverableSlots).filter(([id]) => !Object.hasOwn(imported, id)),
          );
          commitDraftEdit(editor, { ...templateDraft, clips, missingSlots, recoverableSlots }, label);
        },
      });
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        if (cause instanceof SlotImportError) {
          setSelectedSlotId(cause.slot.id);
          setFeedback({ kind: "error", slotId: cause.slot.id, message: cause.message });
        } else {
          const summary = relink
            ? "Couldn’t relink the video."
            : slots.length > 1
              ? "Couldn’t import the selected videos."
              : "Couldn’t import the video.";
          setFeedback({ ...operation, kind: "error", message: errorMessage(summary, cause) });
        }
      }
    } finally {
      finish(operation);
    }
  }

  function storeSingleDrafts(drafts: SingleDrafts) {
    currentSingleDrafts.current = drafts;
    setSingleDrafts(drafts);
  }

  function storeSingleDraft(draftId: string, draft: SingleDraft | null) {
    const drafts = { ...currentSingleDrafts.current };
    if (draft) drafts[draftId] = draft;
    else delete drafts[draftId];
    storeSingleDrafts(drafts);
  }

  function newSingleDraft() {
    if (editor.kind !== "home" || activeOperation.current || !isCurrentScreen()) return;
    try {
      navigate({ kind: "single", draftId: createSingleClipDraftId(), home: editor });
    } catch {
      Alert.alert("Couldn’t start the draft", "Try again from Templates.");
    }
  }

  function openSingleDraft(draftId: string) {
    const draft = singleDrafts[draftId];
    if (editor.kind !== "home" || activeOperation.current || !isCurrentScreen() || !draft) return;
    const saved = readSingleDraft(draftId);
    if (!saved) {
      storeSingleDraft(draftId, null);
      Alert.alert("Draft unavailable", "This draft is no longer in Projects.");
      return;
    }
    // Keep a live export (including a cache fallback) only while the source and export settings still match.
    if (
      saved.clip &&
      draft.clip?.source === saved.clip.source &&
      draft.clip.exportResolution === saved.clip.exportResolution
    ) {
      saved.outputUri = draft.outputUri;
    }
    storeSingleDraft(draftId, restoreSingleOutput(draftId, saved));
    navigate({ kind: "single", draftId, home: editor });
  }

  function openSingleEditor() {
    if (editor.kind !== "home" || !isCurrentScreen()) return;
    const ids = Object.keys(singleDrafts);
    if (ids.length > 1) navigate({ kind: "home", tab: "projects", filter: "single" });
    else if (ids[0]) openSingleDraft(ids[0]);
    else newSingleDraft();
  }

  function confirmDeleteSingleDraft() {
    const operation = { kind: "delete" } as const;
    if (editor.kind !== "single" || !singleProjectLabel || !begin(operation)) return;
    Alert.alert(
      `Delete “${singleProjectLabel}”?`,
      "This removes this draft’s edits and StackReel’s copy of its video. Your original video stays in place.",
      [
        { text: "Cancel", style: "cancel", onPress: () => finish(operation) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (!isCurrentOperation(operation)) return;
            try {
              deleteSingleClipDraft(editor.draftId);
              clearDraftExport(editor);
              storeSingleDraft(editor.draftId, null);
              resetDraftSession(editor);
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
    const session = currentDraftSession.current;
    if (session?.kind === "single") {
      setHistoryLabels({ undoLabel: session.history.undoLabel, redoLabel: session.history.redoLabel });
    }
    const sameOutput =
      singleDraft.outputUri && singleDraft.clip && singleExportSource(clip) === singleExportSource(singleDraft.clip);
    storeSingleDraft(clip.draftId, { clip, outputUri: sameOutput ? singleDraft.outputUri : null });
    if (sameOutput) return;
    clearDraftExport({ kind: "single", draftId: clip.draftId });
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

  function changeExportResolution(resolution: SingleClipResolution) {
    const clip = singleDraft.clip;
    if (!clip || clip.exportResolution === resolution || activeOperation.current || !isCurrentScreen()) return;
    try {
      publishSingleEdit(setSingleClipExportResolution(clip, resolution));
      setFeedback(null);
    } catch (cause) {
      setFeedback({ kind: "error", message: errorMessage("Couldn’t save the export resolution.", cause) });
    }
  }

  async function selectSingleVideo(source: VideoPickerSource) {
    const operation: ImportOperation = { kind: "import", source };
    const recovery = singleDraft.recovery;
    if (editor.kind !== "single" || (singleDraft.loadError && !recovery) || !begin(operation)) return;
    let pickedUri: string | undefined;
    try {
      const asset = await pickVideo(source);
      if (!asset) return;
      pickedUri = asset.uri;
      if (!isCurrentOperation(operation)) return;
      const metadata = await probeVideo(pickedUri);
      if (!isCurrentOperation(operation)) return;
      const isCurrent = () => isCurrentOperation(operation);
      const clip = recovery
        ? await relinkSingleClipDraft(recovery, asset, metadata, isCurrent)
        : await importSingleClipDraft(asset, metadata, isCurrent, editor.draftId);
      if (!clip || !isCurrentOperation(operation)) return;
      publishSingleEdit(clip);
      if (recovery) {
        resetDraftSession(editor);
        setFeedback({ kind: "status", scope: "relink", message: "Video relinked. Your saved edits are ready." });
      }
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        setFeedback(
          recovery
            ? { kind: "error", scope: "relink", message: errorMessage("Couldn’t relink the video.", cause) }
            : { kind: "error", message: errorMessage("Couldn’t import the video.", cause) },
        );
      }
    } finally {
      discardPickerCopy(pickedUri);
      finish(operation);
    }
  }

  async function selectMusic(source: MusicSource, relink = false) {
    if (editor.kind !== "template" || !editor.template.audio?.music) return;
    const session = currentDraftSession.current;
    if (session?.kind !== "template") return;
    const operation = { kind: "import-music", source, relink } as const;
    if (!begin(operation)) return;
    try {
      await importTemplateMusic({
        template: editor.template,
        draftId: editor.draftId,
        source,
        currentMusic: templateDraft.music,
        isCurrent: () => isCurrentOperation(operation),
        ...(relink && { validateMusic: session.history.prepareMusicRelink() }),
        commit: (music) => {
          if (relink) {
            const restored = session.history.relinkMusic(music, templateDraft);
            publishDraftEdit(editor, restored, templateDraft.outputUri, session.history);
            AccessibilityInfo.announceForAccessibilityWithOptions("Soundtrack restored with its saved edits.", {
              queue: true,
            });
            return;
          }
          commitDraftEdit(
            editor,
            { ...templateDraft, music, missingMusic: false, recoverableMusic: null },
            templateDraft.music || templateDraft.missingMusic ? "replace music" : "add music",
          );
        },
      });
    } catch (cause) {
      if (isCurrentOperation(operation)) {
        const summary = relink ? "Couldn’t restore the soundtrack." : "Couldn’t import the music.";
        setFeedback({ kind: "error", scope: "music", message: errorMessage(summary, cause) });
      }
    } finally {
      finish(operation);
    }
  }

  function openMusicEdit(kind: MusicEdit["kind"]) {
    const { music, missingMusic } = templateDraft;
    if (editor.kind === "template" && music && !missingMusic) begin({ kind, editor, music });
  }

  function applyMusicEdit(operation: MusicEdit, updated: TemplateMusic) {
    if (!isCurrentOperation(operation)) return;
    const { editor, music } = operation;
    const draft = getEditorDraft(currentTemplateDrafts.current, editor);
    if (draft.music !== music || draft.missingMusic) {
      throw new Error("The soundtrack changed. Close the editor and open it again.");
    }
    if (updated !== music) {
      const label = operation.kind === "music-start" ? "music start" : "music volume";
      commitDraftEdit(editor, { ...draft, music: updated }, label);
    }
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
    if (editor.kind === "home" || !source) return;
    const job: ExportJob = { kind: "export", id: randomUUID(), cancelling: false };
    if (!begin(job)) return;
    try {
      const clip = singleDraft.clip;
      const exportSource = clip ? singleExportSource(clip) : source;
      const { uri } = await exportMP4(exportSource, job.id);
      if (isCurrentOperation(job)) {
        const retainedUri = retainDraftExport(editor, exportSource, uri, outputUri);
        if (editor.kind === "template") {
          storeTemplateDraft(editor, { ...templateDraft, outputUri: retainedUri });
        } else {
          storeSingleDraft(editor.draftId, { ...singleDraft, outputUri: retainedUri });
        }
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

  function hasExportFile(uri: string) {
    const file = new File(uri);
    if (file.exists && file.size > 0) return true;
    if (editor.kind === "template") storeTemplateDraft(editor, { ...templateDraft, outputUri: null });
    if (editor.kind === "single") storeSingleDraft(editor.draftId, { ...singleDraft, outputUri: null });
    setFeedback({ kind: "error", message: "The cached MP4 is unavailable. Tap Export MP4 to make a new copy." });
    return false;
  }

  async function shareVideo() {
    const operation = { kind: "share" } as const;
    if (!outputUri || !begin(operation)) return;
    try {
      if (!hasExportFile(outputUri)) return;
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
      if (!hasExportFile(outputUri)) return;
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
        page={editor.filter === "single" ? "single-projects" : (editor.filter?.id ?? homeTab)}
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
            singleProjects={singleProjects}
            onSelectSingleClip={openSingleDraft}
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
            busy={busy}
            preparingSample={activity?.kind === "sample"}
            sampleError={feedback?.kind === "error" ? feedback.message : undefined}
            onEditSample={editSampleReel}
            onWatchExample={(template, source) => begin({ kind: "example", template, source })}
            onSelectTemplate={openTemplate}
            onNewDraft={createDraft}
            singleDraftCount={singleProjects.length}
            onNewSingleClip={newSingleDraft}
            onSelectSingleClip={openSingleEditor}
          />
        )}
        {activity?.kind === "example" && (
          <TemplateExample template={activity.template} source={activity.source} onClose={() => finish(activity)} />
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
  const backAction = (
    <Action
      label={fromProjects ? "‹ Projects" : "‹ Templates"}
      accessibilityLabel={backLabel}
      onPress={() => navigate({ ...editor.home })}
      disabled={busy}
    />
  );
  const historyControls = (
    <View role="toolbar" accessibilityLabel="Edit history" style={styles.buttonRow}>
      <Action
        label={undoLabel && !clip ? `Undo ${undoLabel}` : "Undo"}
        accessibilityLabel={undoLabel ? `Undo ${undoLabel}` : "Undo"}
        testID={`${editor.kind}-undo`}
        onPress={() => applyDraftHistory("undo")}
        disabled={busy || !undoLabel}
      />
      <Action
        label={redoLabel && !clip ? `Redo ${redoLabel}` : "Redo"}
        accessibilityLabel={redoLabel ? `Redo ${redoLabel}` : "Redo"}
        testID={`${editor.kind}-redo`}
        onPress={() => applyDraftHistory("redo")}
        disabled={busy || !redoLabel}
      />
    </View>
  );
  const editorHeader = (
    <>
      <View style={styles.editorNavigation}>
        {backAction}
        {(template || clip) && historyControls}
      </View>
      <View style={styles.details}>
        <Text accessibilityRole="header" style={textStyles.heading} numberOfLines={clip ? 2 : undefined}>
          {templateDraft.name ?? template?.name ?? singleProjectLabel ?? "Single-clip editor"}
        </Text>
        {(template || clip) && (
          <Text style={textStyles.muted}>
            {template ? `${canvas.width} × ${canvas.height}` : "9:16"} · {canvas.fps} fps
            {clip && ` · Original audio ${clip.volumePercent}%`}
          </Text>
        )}
      </View>
      {feedback?.scope === "history" && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {feedback.message}
        </Text>
      )}
    </>
  );
  const editorDetails = (
    <>
      {editor.kind === "template" && (
        <TemplateVideoSlots
          slots={editor.slots}
          selectedSlotId={selectedSlotId}
          onSelectSlot={setSelectedSlotId}
          cueTimes={source ? cueTimes : {}}
          onCueShot={(timeUs) => {
            if (!activeOperation.current && isCurrentScreen()) reelPreviewRef.current?.cueShot(timeUs);
          }}
          clips={templateDraft.clips}
          missingSlots={templateDraft.missingSlots}
          recoverableSlots={templateDraft.recoverableSlots}
          relinking={importing && activity.relink === true}
          busy={busy}
          importingSlotId={importing ? activity.slotId : undefined}
          importingFrom={importing ? activity.source : undefined}
          recovery={importing ? activity.recovery : undefined}
          slotError={feedback?.kind === "error" && feedback.slotId !== undefined ? feedback : null}
          swapError={feedback?.scope === "swap" ? feedback.message : undefined}
          onRelink={(slot, source) => selectTemplateVideos([slot], source, true)}
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
      {singleDraft.recovery && (
        <Text accessibilityRole="alert" style={textStyles.body}>
          StackReel can’t read its saved copy of this video. Choose the original from Photos or Files to restore it with
          your edits.
        </Text>
      )}
      {feedback?.scope === "relink" && (
        <Text accessibilityRole="alert" style={feedback.kind === "error" ? textStyles.error : textStyles.muted}>
          {feedback.message}
        </Text>
      )}
      {editor.kind === "single" && (!singleDraft.loadError || singleDraft.recovery) && (
        <VideoImportActions
          action={singleDraft.recovery ? "Relink" : clip ? "Replace" : "Choose"}
          importingFrom={importing ? activity.source : undefined}
          busy={busy}
          primary={clip === null}
          onSelect={selectSingleVideo}
        />
      )}
      {editor.kind === "single" && (clip || singleDraft.loadError) && (
        <>
          {singleDraft.loadError && !singleDraft.recovery && (
            <Text accessibilityRole="alert" style={textStyles.error}>
              {singleDraft.loadError} Try again, or choose New draft in Templates to start another reel.
            </Text>
          )}
          <View style={[styles.navigation, styles.actions]}>
            {!clip && (
              <Action
                label="Try again"
                onPress={() => {
                  if (activeOperation.current || !isCurrentScreen()) return;
                  setFeedback(null);
                  storeSingleDraft(
                    editor.draftId,
                    restoreSingleOutput(editor.draftId, readSingleDraft(editor.draftId)),
                  );
                  resetDraftSession(editor);
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
          recoverableMusic={templateDraft.recoverableMusic}
          busy={busy}
          importing={activity?.kind === "import-music" ? activity : null}
          error={feedback?.scope === "music" ? feedback.message : undefined}
          onVolume={() => openMusicEdit("music-volume")}
          onStart={() => openMusicEdit("music-start")}
          onSelect={selectMusic}
          onRemove={removeMusic}
        />
      )}
      <View style={styles.actions}>
        {clip && (
          <View style={styles.details}>
            <Text style={textStyles.body}>Export resolution</Text>
            <View style={styles.buttonRow}>
              {([720, 1080] as const).map((resolution) => {
                const selected = clip.exportResolution === resolution;
                return (
                  <Action
                    key={resolution}
                    label={`${selected ? "✓ " : ""}${resolution}p`}
                    accessibilityLabel={`${resolution}p export resolution`}
                    testID={`single-export-${resolution}p`}
                    selected={selected}
                    primary={selected}
                    disabled={busy}
                    onPress={() => changeExportResolution(resolution)}
                  />
                );
              })}
            </View>
          </View>
        )}
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
      page={editor.draftId}
      title={null}
      fullScreen={fullScreen}
      footer={
        !fullScreen &&
        clip && (
          <View>
            {frameOpen && (
              <SingleClipFramePanel
                fit={clip.fit}
                onChangeFit={changeSingleFraming}
                onReframe={() => begin({ kind: "single-reframe", clip })}
                onClose={() => {
                  setFrameOpen(false);
                  requestAnimationFrame(() => {
                    if (frameButtonRef.current)
                      AccessibilityInfo.sendAccessibilityEvent(frameButtonRef.current, "focus");
                  });
                }}
                error={feedback?.scope === "framing" ? feedback.message : undefined}
              />
            )}
            <SingleClipToolDock
              disabled={busy}
              frameExpanded={frameOpen}
              frameButtonRef={frameButtonRef}
              hasCaption={!!clip.caption}
              onTrim={() => begin({ kind: "single-trim", clip })}
              onFrame={() => {
                if (!activeOperation.current && isCurrentScreen()) setFrameOpen((open) => !open);
              }}
              onVolume={() => begin({ kind: "single-volume", clip })}
              onCaption={() => begin({ kind: "single-caption", clip })}
            />
          </View>
        )
      }
    >
      {activity?.kind === "single-reframe" && (
        <ReframeSheet
          id="single"
          title="Reframe clip"
          canvas={singleClipCanvas}
          previewGainDb={getVolumeGainDb(activity.clip.volumePercent)}
          clip={{
            uri: activity.clip.uri,
            width: activity.clip.media.width,
            height: activity.clip.media.height,
            trimInUs: frameToUs(activity.clip.selection.startFrame, singleClipCanvas.fps),
            trimOutUs: frameToUs(activity.clip.selection.endFrame, singleClipCanvas.fps),
            reframe: activity.clip.reframe,
          }}
          onApply={(reframe) => {
            if (!isCurrentOperation(activity)) return;
            publishSingleEdit(setSingleClipReframe(activity.clip, reframe));
            finish(activity);
          }}
          onCancel={() => finish(activity)}
        />
      )}
      {activity?.kind === "single-volume" && (
        <VolumeSheet
          id="single"
          title="Clip volume"
          filename={activity.clip.name}
          levelLabel="Original audio"
          accessibilitySubject="original audio"
          sliderLabel="Original audio volume"
          initialVolume={activity.clip.volumePercent}
          canvas={singleClipCanvas}
          createPreview={(volumePercent) => createSingleClipSource({ ...activity.clip, volumePercent })}
          onApply={(volumePercent) => {
            if (!isCurrentOperation(activity)) return;
            publishSingleEdit(setSingleClipVolume(activity.clip, volumePercent));
            finish(activity);
          }}
          onCancel={() => finish(activity)}
        />
      )}
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
        <ReframeSheet
          id={activity.slot.id}
          title={`Reframe ${activity.slot.label}`}
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
          onApply={(percent) => applyMusicEdit(activity, setTemplateMusicVolume(activity.music, percent))}
          onCancel={() => finish(activity)}
        />
      )}
      {activity?.kind === "music-start" && (
        <TemplateMusicStart
          music={activity.music}
          reelDurationUs={activity.editor.template.durationUs}
          canvas={activity.editor.template.canvas}
          createPreview={(startFrame) =>
            createTemplateSource(
              activity.editor.template,
              templateDraft.clips,
              templateDraft.textOverrides,
              setTemplateMusicStart(activity.music, startFrame, activity.editor.template.durationUs),
            )
          }
          onApply={(startFrame) =>
            applyMusicEdit(
              activity,
              setTemplateMusicStart(activity.music, startFrame, activity.editor.template.durationUs),
            )
          }
          onCancel={() => finish(activity)}
        />
      )}
      {!fullScreen && editorHeader}
      {source && (
        <ClipPreview
          key={source}
          ref={reelPreviewRef}
          storyboard={!!template}
          singleWorkspace={!!clip}
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
      {!fullScreen && !clip && editorDetails}
      {!fullScreen && editorActions}
      {!fullScreen && clip && (
        <View style={styles.projectMedia}>
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            Project media
          </Text>
          {editorDetails}
        </View>
      )}
    </Screen>
  );

  return (
    <>
      {editorScreen}
      {activity?.kind === "single-caption" && (
        <SingleClipCaptionEditor
          caption={activity.clip.caption}
          onApply={(value) => {
            if (!isCurrentOperation(activity)) return;
            publishSingleEdit(setSingleClipCaption(activity.clip, value));
            finish(activity);
          }}
          onCancel={() => finish(activity)}
        />
      )}
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
              style={({ pressed }) => [
                styles.tab,
                (selected || pressed) && styles.activeTab,
                disabled && styles.disabled,
              ]}
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
  disabled: { opacity: 0.55 },
  tabLabel: { color: darkColors.textMuted, fontSize: fontSize.md, fontWeight: "600", textAlign: "center" },
  activeTabLabel: { color: darkColors.accent },
  editorNavigation: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  navigation: { alignSelf: "flex-start" },
  details: { gap: space[1] },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", maxWidth: "100%", gap: space[2] },
  actions: { gap: space[2] },
  projectMedia: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: darkColors.border,
    paddingTop: space[4],
    gap: space[3],
  },
  sectionHeading: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700" },
  progress: { gap: space[2], marginBottom: space[1] },
  progressTrack: { height: 6, borderRadius: radius.full, backgroundColor: darkColors.border, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: darkColors.accent },
});
