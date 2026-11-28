import { darkColors, fontSize, space } from "@stackreel/ui";
import { StyleSheet, Text, View } from "react-native";
import { Action, textStyles } from "./Screen";
import type { TemplateDraftEdits } from "./template-drafts";
import type { TemplateMusic } from "./template-editor";
import type { MusicSource } from "./template-music-import";

export function TemplateMusicControls({
  music,
  missingMusic,
  recoverableMusic,
  busy,
  importing,
  error,
  onSelect,
  onRemove,
  onStart,
  onVolume,
}: {
  music: TemplateMusic | null;
  missingMusic: boolean;
  recoverableMusic: TemplateDraftEdits["recoverableMusic"];
  busy: boolean;
  importing: { source: MusicSource; relink: boolean } | null;
  error: string | undefined;
  onSelect: (source: MusicSource, relink?: boolean) => void;
  onRemove: () => void;
  onStart: () => void;
  onVolume: () => void;
}) {
  const selectLabel = missingMusic ? "Replace music from Files" : music ? "Replace music" : "Choose music from Files";
  const usingDaybreak = music?.starterId === "daybreak";
  const restoreDaybreak = missingMusic && recoverableMusic?.starterId === "daybreak";
  const importSource = importing?.relink ? null : importing?.source;

  return (
    <View testID="template-music" style={styles.section}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          Background music
        </Text>
        <Text style={textStyles.muted}>Optional</Text>
      </View>
      {music && (
        <Text
          testID="template-music-name"
          accessibilityLabel={`Selected music: ${music.name}`}
          numberOfLines={1}
          style={textStyles.body}
        >
          {music.name}
        </Text>
      )}
      {missingMusic && (
        <Text testID="template-music-missing" accessibilityRole="alert" style={textStyles.error}>
          {recoverableMusic
            ? `“${recoverableMusic.name}” is missing. Restore it to keep your music start and volume.`
            : "Saved music is missing."}
        </Text>
      )}
      <View style={styles.actions}>
        {missingMusic && recoverableMusic && (
          <Action
            label={
              importing?.relink ? "Restoring music…" : restoreDaybreak ? "Restore Daybreak" : "Relink music from Files"
            }
            testID={restoreDaybreak ? "restore-daybreak-music" : "relink-template-music"}
            onPress={() => onSelect(restoreDaybreak ? "daybreak" : "files", true)}
            disabled={busy}
            primary
          />
        )}
        <Action
          label={importSource === "files" ? "Importing music…" : selectLabel}
          testID={music ? "replace-template-music" : "choose-template-music"}
          onPress={() => onSelect("files")}
          disabled={busy}
        />
        {!restoreDaybreak && (
          <Action
            label={
              importSource === "daybreak" ? "Adding Daybreak…" : usingDaybreak ? "Daybreak selected" : "Use Daybreak"
            }
            testID="use-daybreak-music"
            onPress={() => onSelect("daybreak")}
            disabled={busy || usingDaybreak}
          />
        )}
        {music && !missingMusic && (
          <>
            <Action label="Music start" testID="edit-music-start" onPress={onStart} disabled={busy} />
            <Action label="Music volume" testID="edit-music-volume" onPress={onVolume} disabled={busy} />
          </>
        )}
        {(music || missingMusic) && (
          <Action
            label={missingMusic ? "Remove missing music" : "Remove music"}
            testID={missingMusic ? "remove-missing-template-music" : "remove-template-music"}
            onPress={onRemove}
            disabled={busy}
          />
        )}
      </View>
      {error && (
        <Text testID="template-music-error" accessibilityRole="alert" style={textStyles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  heading: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space[2] },
  title: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
