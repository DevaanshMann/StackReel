import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export function Screen({
  children,
  page,
  title = "StackReel",
  scrollEnabled = true,
}: {
  children: ReactNode;
  page?: string;
  title?: string;
  scrollEnabled?: boolean;
}) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <ScrollView key={page} contentContainerStyle={styles.scroll} scrollEnabled={scrollEnabled}>
          <View style={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {children}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export function Action({
  label,
  accessibilityLabel = label,
  testID,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  accessibilityLabel?: string;
  testID?: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={[styles.buttonLabel, primary && styles.primaryLabel]}>{label}</Text>
    </Pressable>
  );
}

export const textStyles = StyleSheet.create({
  heading: { color: darkColors.text, fontSize: fontSize["2xl"], fontWeight: "700" },
  body: { color: darkColors.text, fontSize: fontSize.md },
  muted: { color: darkColors.textMuted, fontSize: fontSize.sm, lineHeight: 21 },
  error: { color: darkColors.danger, fontSize: fontSize.sm, lineHeight: 21 },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: darkColors.bg },
  scroll: { alignItems: "center", padding: space[5] },
  content: { width: "100%", maxWidth: 440, gap: space[4] },
  title: { color: darkColors.text, fontSize: fontSize["3xl"], fontWeight: "700" },
  button: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  primary: { backgroundColor: darkColors.accent, borderColor: darkColors.accent },
  dimmed: { opacity: 0.55 },
  buttonLabel: { color: darkColors.text, fontSize: fontSize.md, fontWeight: "600", textAlign: "center" },
  primaryLabel: { color: darkColors.onAccent },
});
