import { space } from "@stackreel/ui";
import { useState } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from "react-native";
import { CaptionField } from "./CaptionField";
import { errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { applyTemplateTextEdits } from "./template-editor";
import type { TemplateTextField, TemplateTextOverrides } from "./template-editor";

export function TemplateTextEditor({
  fields,
  overrides,
  onApply,
  onCancel,
}: {
  fields: readonly TemplateTextField[];
  overrides: TemplateTextOverrides;
  onApply: (overrides: TemplateTextOverrides) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(overrides);
  const [error, setError] = useState<string | null>(null);
  const inputs = fields.map((field) => {
    const value = values[field.id] ?? field.defaultText;
    const count = [...value].length;
    return { field, value, count, overLimit: field.maxChars !== undefined && count > field.maxChars };
  });

  function reset() {
    setValues({});
    setError(null);
  }

  function apply() {
    try {
      onApply(applyTemplateTextEdits(fields, overrides, values));
    } catch (cause) {
      const message = errorMessage("Couldn’t apply the text.", cause);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <Screen title="Edit text" adjustForKeyboard>
        <Text style={textStyles.muted}>Clear a field to hide its text on the video.</Text>
        {inputs.map(({ field, value, count, overLimit }) => (
          <CaptionField
            key={field.id}
            testID={`template-text-${field.id}`}
            label={field.label}
            defaultText={field.defaultText}
            maxChars={field.maxChars}
            value={value}
            count={count}
            overLimit={overLimit}
            onChange={(value) => {
              setError(null);
              setValues((current) => ({ ...current, [field.id]: value }));
            }}
          />
        ))}
        {error && (
          <Text accessibilityRole="alert" style={textStyles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Action label="Reset" testID="template-text-reset" onPress={reset} />
          <Action label="Cancel" testID="template-text-cancel" onPress={onCancel} />
          <Action
            label="Apply text"
            testID="template-text-apply"
            onPress={apply}
            disabled={inputs.some(({ overLimit }) => overLimit)}
            primary
          />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
