import { darkColors, radius, space } from "@stackreel/ui";
import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from "react-native";
import { textStyles } from "./Screen";

export function CaptionField({
  label,
  testID,
  defaultText,
  maxChars,
  value,
  count,
  overLimit,
  onChange,
}: {
  label: string;
  testID: string;
  defaultText?: string;
  maxChars?: number | undefined;
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
        testID={testID}
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
      {defaultText !== undefined && (
        <Text style={textStyles.muted}>{defaultText ? `Default “${defaultText}”` : "Default is blank"}</Text>
      )}
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
});
