import { addExportProgressListener, cancelExport, exportMP4, probeVideo } from "@stackreel/engine";
import { darkColors, radius, space } from "@stackreel/ui";
import { randomUUID } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClipPreview, PreviewFrame, errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { canvas, createClipSource } from "./clip-source";

type Clip = { name: string; uri: string; source: string };
type ExportJob = { kind: "export"; id: string; cancelling: boolean };
type Operation = { kind: "import" | "share" } | ExportJob;
type Activity = { kind: "import" | "share" } | (ExportJob & { progress: number });

export default function App() {
  const activeOperation = useRef<Operation | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [outputUri, setOutputUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
    setError(null);
    setStatus(null);
    return true;
  }

  function finish(operation: Operation) {
    if (activeOperation.current !== operation) return;
    activeOperation.current = null;
    setActivity(null);
  }

  async function selectVideo() {
    const operation = { kind: "import" } as const;
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
      const source = createClipSource(pickedUri, metadata);
      if (activeOperation.current !== operation) return;

      setClip({ name: asset.name, uri: pickedUri, source });
      setOutputUri(null);
      pickedUri = undefined;
      removeCachedFile(clip?.uri);
      removeCachedFile(outputUri);
    } catch (cause) {
      if (activeOperation.current === operation) setError(errorMessage("Couldn’t import the video.", cause));
    } finally {
      removeCachedFile(pickedUri);
      finish(operation);
    }
  }

  async function startExport() {
    if (!clip) return;
    const job: ExportJob = { kind: "export", id: randomUUID(), cancelling: false };
    if (!begin(job)) return;
    try {
      const { uri } = await exportMP4(clip.source, job.id);
      if (activeOperation.current === job) {
        setOutputUri(uri);
        if (uri !== outputUri) removeCachedFile(outputUri);
      } else {
        removeCachedFile(uri);
      }
    } catch (cause) {
      if (activeOperation.current === job) {
        if (job.cancelling) setStatus("Export cancelled.");
        else setError(errorMessage("Couldn’t export the MP4.", cause));
      }
    } finally {
      finish(job);
    }
  }

  async function requestCancel() {
    const job = activeOperation.current;
    if (job?.kind !== "export" || job.cancelling) return;
    job.cancelling = true;
    setError(null);
    setActivity((current) => (current?.kind === "export" ? { ...current, cancelling: true } : current));
    try {
      await cancelExport(job.id);
    } catch (cause) {
      if (activeOperation.current === job) {
        job.cancelling = false;
        setActivity((current) => (current?.kind === "export" ? { ...current, cancelling: false } : current));
        setError(errorMessage("Couldn’t cancel the export.", cause));
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
      if (activeOperation.current === operation) setError(errorMessage("Couldn’t share the MP4.", cause));
    } finally {
      finish(operation);
    }
  }

  const exporting = activity?.kind === "export";
  return (
    <Screen>
      <View style={styles.details}>
        <Text numberOfLines={1} style={textStyles.body}>
          {clip?.name ?? "Single-clip editor"}
        </Text>
        <Text style={textStyles.muted}>
          {canvas.width} × {canvas.height} · {canvas.fps} fps
        </Text>
      </View>
      {clip ? (
        <ClipPreview
          key={clip.uri}
          source={clip.source}
          suspended={activity?.kind === "import" || activity?.kind === "share"}
        />
      ) : (
        <PreviewFrame>
          <Text style={textStyles.muted}>Choose a clip from Files</Text>
        </PreviewFrame>
      )}
      {error && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {error}
        </Text>
      )}
      {status && (
        <Text accessibilityRole="alert" style={textStyles.muted}>
          {status}
        </Text>
      )}
      <View style={styles.actions}>
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
            disabled={activity !== null}
            primary
          />
        )}
        {clip && !exporting && (
          <Action label="Export MP4" onPress={startExport} disabled={activity !== null} primary={!outputUri} />
        )}
        <Action
          label={activity?.kind === "import" ? "Opening video…" : clip ? "Replace video" : "Choose video"}
          onPress={selectVideo}
          disabled={activity !== null}
          primary={clip === null}
        />
      </View>
    </Screen>
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
  details: { gap: space[1] },
  actions: { gap: space[2] },
  progress: { gap: space[2], marginBottom: space[1] },
  progressTrack: { height: 6, borderRadius: radius.full, backgroundColor: darkColors.border, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: darkColors.accent },
});
