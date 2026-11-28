import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { ComponentRef, ReactNode, Ref } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import type { ScrollViewProps } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export type ScreenRef = { saveScrollPosition: () => void };

export function Screen({
  ref,
  children,
  footer,
  page,
  title = "StackReel",
  scrollEnabled = true,
  adjustForKeyboard = false,
  fullScreen,
}: {
  ref?: Ref<ScreenRef>;
  children: ReactNode;
  footer?: ReactNode;
  page?: string;
  title?: string | null;
  scrollEnabled?: boolean;
  adjustForKeyboard?: boolean;
  fullScreen?: boolean;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const savedOffset = useRef<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      saveScrollPosition() {
        savedOffset.current = scroll.current?.scrollTop ?? 0;
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    if (fullScreen) {
      scroll.current?.scrollTo({ y: 0, animated: false });
    } else if (savedOffset.current !== null) {
      const frame = requestAnimationFrame(() => {
        if (savedOffset.current !== null) scroll.current?.scrollTo({ y: savedOffset.current, animated: false });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [fullScreen]);

  const previewScrollProps: ScrollViewProps | undefined =
    fullScreen === undefined
      ? undefined
      : {
          removeClippedSubviews: false,
          onContentSizeChange: () => {
            // iOS may clamp an early restore while the inline editor is still laying out.
            if (!fullScreen && savedOffset.current !== null) {
              scroll.current?.scrollTo({ y: savedOffset.current, animated: false });
            }
          },
          onScroll: ({ nativeEvent }) => {
            if (
              !fullScreen &&
              savedOffset.current !== null &&
              Math.abs(nativeEvent.contentOffset.y - savedOffset.current) < 1
            ) {
              savedOffset.current = null;
            }
          },
          onScrollBeginDrag: () => {
            savedOffset.current = null;
          },
        };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" hidden={fullScreen} />
        <ScrollView
          ref={scroll}
          key={page}
          {...previewScrollProps}
          contentContainerStyle={fullScreen ? undefined : styles.scroll}
          scrollEnabled={scrollEnabled && !fullScreen}
          automaticallyAdjustKeyboardInsets={adjustForKeyboard}
          keyboardDismissMode={adjustForKeyboard ? "interactive" : "none"}
          keyboardShouldPersistTaps={adjustForKeyboard ? "always" : "never"}
        >
          <View style={fullScreen ? undefined : styles.content}>
            {!fullScreen && title !== null && (
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            )}
            {children}
          </View>
        </ScrollView>
        {footer}
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
  selected,
}: {
  label: string;
  accessibilityLabel?: string;
  testID?: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
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
