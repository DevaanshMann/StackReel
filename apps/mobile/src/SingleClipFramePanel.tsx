import { darkColors, fontSize, space } from "@stackreel/ui";
import { useRef } from "react";
import type { ComponentRef } from "react";
import { AccessibilityInfo, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Action, textStyles } from "./Screen";
import type { SingleClipFit } from "./clip-source";

const framingOptions = [
  { fit: "contain", label: "Fit", description: "Show the whole clip" },
  { fit: "cover", label: "Fill", description: "Crop to fill the reel" },
] as const;

export function SingleClipFramePanel({
  fit,
  onChangeFit,
  onReframe,
  onClose,
  error,
}: {
  fit: SingleClipFit;
  onChangeFit: (fit: SingleClipFit) => void;
  onReframe: () => void;
  onClose: () => void;
  error?: string | undefined;
}) {
  const { height } = useWindowDimensions();
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const focusedOnOpen = useRef(false);

  function focusHeadingOnOpen() {
    if (heading.current && !focusedOnOpen.current) {
      focusedOnOpen.current = true;
      AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
    }
  }

  return (
    <ScrollView
      testID="single-frame-panel"
      style={[styles.panel, { maxHeight: height * 0.42 }]}
      contentContainerStyle={styles.content}
      onAccessibilityEscape={onClose}
      alwaysBounceVertical={false}
    >
      <View style={styles.headingRow}>
        <Text ref={heading} accessible accessibilityRole="header" onLayout={focusHeadingOnOpen} style={styles.heading}>
          Clip framing
        </Text>
        <Action label="Done" testID="single-frame-done" onPress={onClose} />
      </View>
      <View style={styles.actions}>
        {framingOptions.map((option) => (
          <Action
            key={option.fit}
            label={fit === option.fit ? `✓ ${option.label}` : option.label}
            accessibilityLabel={`${option.label}, ${option.description}`}
            testID={`single-framing-${option.label.toLowerCase()}`}
            selected={fit === option.fit}
            primary={fit === option.fit}
            onPress={() => onChangeFit(option.fit)}
          />
        ))}
        {fit === "cover" && <Action label="Reframe" testID="single-reframe-open" onPress={onReframe} />}
      </View>
      {error && (
        <Text accessibilityRole="alert" style={textStyles.error}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexGrow: 0,
    backgroundColor: darkColors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: darkColors.border,
  },
  content: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[2],
  },
  headingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  heading: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700", flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
