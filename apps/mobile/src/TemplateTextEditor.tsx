import { darkColors, radius, space } from "@stackreel/ui";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { errorMessage } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import { setTemplateText } from "./template-editor";
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
      const updated = inputs.reduce((current, { field, value }) => setTemplateText(field, current, value), overrides);
      onApply(updated);
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
          <TextField
            key={field.id}
            field={field}
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

function TextField({
  field: { id, label, defaultText, maxChars },
  value,
  count,
  overLimit,
  onChange,
}: {
  field: TemplateTextField;
  value: string;
  count: number;
  overLimit: boolean;
  onChange: (value: string) => void;
}) {
  useEffect(() => {
    if (overLimit) AccessibilityInfo.announceForAccessibility(`${label} has a limit of ${maxChars} characters.`);
  }, [label, maxChars, overLimit]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={maxChars === undefined ? undefined : `Up to ${maxChars} characters`}
        testID={`template-text-${id}`}
        value={value}
        onChangeText={onChange}
        placeholder="Hidden"
        placeholderTextColor={darkColors.textMuted}
        keyboardAppearance="dark"
        multiline
        style={[styles.input, overLimit && styles.invalid]}
      />
      {maxChars !== undefined && (
        <Text style={overLimit ? textStyles.error : textStyles.muted}>
          {count} / {maxChars} characters{overLimit ? " · limit exceeded" : ""}
        </Text>
      )}
      <Text style={textStyles.muted}>{defaultText ? `Default “${defaultText}”` : "Default is blank"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  label: { ...textStyles.body, fontWeight: "600" },
  input: {
    ...textStyles.body,
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  invalid: { borderColor: darkColors.danger },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
});
