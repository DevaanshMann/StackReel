import { darkColors, fontSize, MIN_HIT_TARGET, radius, space } from "@stackreel/ui";
import type { ComponentRef, Ref } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

export function SingleClipToolDock({
  disabled,
  frameExpanded,
  frameButtonRef,
  hasCaption,
  onTrim,
  onFrame,
  onVolume,
  onCaption,
}: {
  disabled: boolean;
  frameExpanded: boolean;
  frameButtonRef?: Ref<ComponentRef<typeof Pressable>>;
  hasCaption: boolean;
  onTrim: () => void;
  onFrame: () => void;
  onVolume: () => void;
  onCaption: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const availableWidth = Math.min(width - space[3] * 2, 440);
  const twoColumns = availableWidth / 4 < 52 * fontScale + space[2];
  const tools = [
    {
      name: "Trim",
      label: "Trim clip",
      hint: "Adjusts the start and end of the clip.",
      onPress: onTrim,
      icon: (
        <Text allowFontScaling={false} style={styles.scissors}>
          ✂︎
        </Text>
      ),
    },
    {
      name: "Frame",
      label: "Frame clip",
      hint: "Choose how the clip fits the reel or adjust its crop.",
      onPress: onFrame,
      icon: (
        <View style={styles.frameIcon}>
          <View style={styles.innerFrame} />
        </View>
      ),
    },
    {
      name: "Volume",
      label: "Original audio volume",
      hint: "Adjusts or mutes the clip’s sound.",
      onPress: onVolume,
      icon: (
        <View style={styles.waveform}>
          {[8, 16, 22, 12, 6].map((height) => (
            <View key={height} style={[styles.bar, { height }]} />
          ))}
        </View>
      ),
    },
    {
      name: "Caption",
      label: hasCaption ? "Edit caption" : "Add caption",
      hint: "Opens the clip’s caption editor.",
      onPress: onCaption,
      icon: (
        <Text allowFontScaling={false} style={styles.captionIcon}>
          Aa
        </Text>
      ),
    },
  ];

  return (
    <View role="toolbar" accessibilityLabel="Clip editing tools" testID="single-tool-dock" style={styles.dock}>
      <View style={styles.row}>
        {tools.map(({ name, label, hint, onPress, icon }) => (
          <Pressable
            key={name}
            ref={name === "Frame" ? frameButtonRef : undefined}
            testID={`single-${name.toLowerCase()}-open`}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={name === "Frame" ? { disabled, expanded: frameExpanded } : { disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
              styles.tool,
              twoColumns ? styles.halfWidth : styles.quarterWidth,
              name === "Frame" && frameExpanded && styles.activeFrame,
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
              {icon}
            </View>
            <Text style={styles.label}>{name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: "center",
    backgroundColor: darkColors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: darkColors.border,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  row: { width: "100%", maxWidth: 440, flexDirection: "row", flexWrap: "wrap" },
  tool: {
    minHeight: MIN_HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    padding: space[2],
    borderRadius: radius.lg,
  },
  halfWidth: { width: "50%", flexDirection: "row" },
  quarterWidth: { width: "25%" },
  pressed: { backgroundColor: darkColors.elevated },
  activeFrame: { backgroundColor: darkColors.surface, borderColor: darkColors.accent, borderWidth: 1 },
  disabled: { opacity: 0.55 },
  label: { color: darkColors.text, fontSize: fontSize.sm, fontWeight: "600", textAlign: "center", flexShrink: 1 },
  icon: { width: 28, height: 24, alignItems: "center", justifyContent: "center" },
  scissors: { fontSize: 24, lineHeight: 26, color: darkColors.accent },
  frameIcon: {
    width: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: radius.sm,
    borderColor: darkColors.accent,
  },
  innerFrame: { width: 7, height: 11, borderWidth: 1, borderColor: darkColors.accent },
  waveform: { flexDirection: "row", alignItems: "center", gap: 2 },
  bar: { width: 3, borderRadius: radius.full, backgroundColor: darkColors.accent },
  captionIcon: { fontSize: 20, fontWeight: "600", color: darkColors.accent, letterSpacing: -1 },
});
