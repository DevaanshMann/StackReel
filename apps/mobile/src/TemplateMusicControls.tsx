import { darkColors, fontSize, space } from "@stackreel/ui";
import { StyleSheet, Text, View } from "react-native";
import { Action, textStyles } from "./Screen";
import type { TemplateMusic } from "./template-editor";

export function TemplateMusicControls({
  music,
  missingMusic,
  busy,
  importing,
  error,
  onSelect,
  onRemove,
}: {
  music: TemplateMusic | null;
  missingMusic: boolean;
  busy: boolean;
  importing: boolean;
  error: string | undefined;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const selectLabel = music ? "Replace music" : "Choose music from Files";

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
      <View style={styles.actions}>
        <Action
          label={importing ? "Importing music…" : selectLabel}
          testID={music ? "replace-template-music" : "choose-template-music"}
          onPress={onSelect}
          disabled={busy}
        />
        {(music || missingMusic) && (
          <Action
            label={missingMusic ? "Remove missing music" : "Remove music"}
            testID={missingMusic ? "remove-missing-template-music" : "remove-template-music"}
            onPress={onRemove}
            disabled={busy}
          />
        )}
      </View>
      {missingMusic && (
        <Text testID="template-music-missing" accessibilityRole="alert" style={textStyles.error}>
          Saved music is missing.
        </Text>
      )}
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
