import { space } from "@stackreel/ui";
import { StyleSheet, View } from "react-native";
import { Action } from "./Screen";
import type { VideoPickerSource } from "./video-picker";

const sources = ["Photos", "Files"] as const;

export function VideoImportActions({
  action,
  importingFrom,
  busy,
  primary,
  slotLabel,
  onSelect,
}: {
  action: "Choose" | "Replace" | "Relink";
  importingFrom: VideoPickerSource | undefined;
  busy: boolean;
  primary: boolean;
  slotLabel?: string;
  onSelect: (source: VideoPickerSource) => void;
}) {
  return (
    <View style={styles.actions}>
      {sources.map((source) => {
        const label = importingFrom === source ? `Importing from ${source}…` : `${action} from ${source}`;
        return (
          <Action
            key={source}
            label={label}
            accessibilityLabel={slotLabel ? `${label} for ${slotLabel}` : label}
            onPress={() => onSelect(source)}
            disabled={busy}
            primary={primary && source === "Photos"}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
