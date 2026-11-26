import { space } from "@stackreel/ui";
import { useState } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from "react-native";
import { CaptionField } from "./CaptionField";
import { errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { captionLimit, captionParagraph } from "./single-clip-caption";

export function SingleClipCaptionEditor({
  caption,
  onApply,
  onCancel,
}: {
  caption: string | undefined;
  onApply: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(caption ?? "");
  const [error, setError] = useState<string | null>(null);
  const count = [...captionParagraph(value)].length;
  const overLimit = count > captionLimit;

  function edit(text: string) {
    setValue(text);
    setError(null);
  }

  function apply() {
    try {
      onApply(value);
    } catch (cause) {
      const message = errorMessage("Couldn’t save the caption.", cause);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen title={caption ? "Edit caption" : "Add caption"} adjustForKeyboard>
        <Text style={textStyles.muted}>The caption appears throughout your selected cut.</Text>
        <CaptionField
          label="Caption"
          testID="single-caption-input"
          value={value}
          count={count}
          maxChars={captionLimit}
          overLimit={overLimit}
          onChange={edit}
        />
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Clear caption" testID="single-caption-clear" disabled={!value} onPress={() => edit("")} />
          <Action label="Cancel" testID="single-caption-cancel" onPress={onCancel} />
          <Action label="Apply caption" testID="single-caption-apply" disabled={overLimit} onPress={apply} primary />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
