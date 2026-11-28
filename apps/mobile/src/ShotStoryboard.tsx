import { US_PER_SECOND } from "@stackreel/core";
import { getVideoThumbnails } from "@stackreel/engine";
import { darkColors, fontSize, radius, space } from "@stackreel/ui";
import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { timeLabel } from "./ClipPreview";
import type { StoryboardShot } from "./template-storyboard";

function ShotThumbnail({ uri, timeUs }: { uri: string; timeUs: number }) {
  const [image, setImage] = useState<string | null>();
  useEffect(() => {
    let active = true;
    async function extract() {
      try {
        const [frame] = await getVideoThumbnails(uri, [timeUs]);
        if (active) setImage(frame ?? null);
      } catch {
        if (active) setImage(null);
      }
    }
    void extract();
    return () => {
      active = false;
    };
  }, [uri, timeUs]);

  if (image === undefined) return null;
  if (!image) return <Text style={styles.fallback}>No preview</Text>;
  return (
    <Image
      accessible={false}
      source={{ uri: image }}
      resizeMode="cover"
      style={StyleSheet.absoluteFill}
      onError={() => setImage(null)}
    />
  );
}

export function ShotStoryboard({
  shots,
  selected,
  busy,
  cueTimes,
  onSelectSlot,
  onCueShot,
}: {
  shots: readonly StoryboardShot[];
  selected: StoryboardShot;
  busy: boolean;
  cueTimes: Readonly<Record<string, number>>;
  onSelectSlot: (id: string) => void;
  onCueShot: (timeUs: number) => void;
}) {
  const strip = useRef<ComponentRef<typeof ScrollView>>(null);
  const [viewport, setViewport] = useState(0);
  const [focusedId, setFocusedId] = useState<string>();
  const { fontScale } = useWindowDimensions();
  const gap = space[2];
  const minWidth = 112 * Math.max(1, fontScale);
  const width = Math.min(
    viewport || minWidth,
    Math.max(minWidth, (viewport - gap * (shots.length - 1)) / shots.length),
  );
  const readyCount = shots.filter(({ status }) => status === "Ready").length;
  const selectedOffset = (selected.number - 1) * (width + gap) - (viewport - width) / 2;
  useEffect(() => {
    if (viewport > 0) strip.current?.scrollTo({ x: Math.max(0, selectedOffset), animated: false });
  }, [selectedOffset, viewport]);

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          Storyboard
        </Text>
        <Text style={styles.progress}>
          {readyCount} of {shots.length} ready
        </Text>
      </View>
      <ScrollView
        ref={strip}
        horizontal
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.strip}
        onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout.width)}
      >
        {shots.map(({ slot, number, clip, status, thumbnailTimeUs }) => {
          const chosen = selected.slot.id === slot.id;
          const cueUs = status === "Ready" && Object.hasOwn(cueTimes, slot.id) ? cueTimes[slot.id] : undefined;
          const cueLabel = cueUs === undefined ? undefined : timeLabel(cueUs / US_PER_SECOND);
          return (
            <Pressable
              key={slot.id}
              testID={`storyboard-shot-${slot.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Shot ${number} of ${shots.length}, ${slot.label}, ${status}`}
              accessibilityState={{ selected: chosen, disabled: busy }}
              accessibilityHint={
                cueLabel
                  ? `Pauses the preview at ${cueLabel} and shows controls for this shot. Play continues from there.`
                  : "Shows controls for this shot."
              }
              disabled={busy}
              focusable={!busy}
              onFocus={() => setFocusedId(slot.id)}
              onBlur={() => setFocusedId(undefined)}
              onPress={() => {
                onSelectSlot(slot.id);
                if (cueUs !== undefined) onCueShot(cueUs);
              }}
              style={({ pressed }) => [
                styles.card,
                { width },
                chosen && styles.selected,
                focusedId === slot.id && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.frame, cueLabel && styles.cueFrame]}>
                {clip && thumbnailTimeUs !== undefined ? (
                  <ShotThumbnail key={`${clip.uri}/${thumbnailTimeUs}`} uri={clip.uri} timeUs={thumbnailTimeUs} />
                ) : (
                  <Text style={[styles.placeholder, status === "Missing" && styles.missing]}>
                    {status === "Missing" ? "!" : "+"}
                  </Text>
                )}
                {cueLabel && (
                  <View style={styles.cueBadge}>
                    <Text style={styles.cueTime}>{cueLabel}</Text>
                  </View>
                )}
              </View>
              <View style={styles.caption}>
                <Text style={styles.label}>
                  {number}. {slot.label}
                </Text>
                <Text
                  style={[styles.status, status === "Missing" && styles.missing, status === "Ready" && styles.ready]}
                >
                  {status}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: space[2],
  },
  title: { color: darkColors.text, fontSize: fontSize.lg, fontWeight: "700" },
  progress: { color: darkColors.textMuted, fontSize: fontSize.sm, fontVariant: ["tabular-nums"] },
  strip: { gap: space[2], paddingBottom: space[1] },
  card: {
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: darkColors.border,
    backgroundColor: darkColors.surface,
  },
  selected: { borderColor: darkColors.accent, backgroundColor: darkColors.elevated },
  focused: { borderColor: darkColors.text },
  pressed: { opacity: 0.8 },
  frame: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.elevated,
    padding: space[1],
  },
  cueFrame: { justifyContent: "flex-end", gap: space[1] },
  cueBadge: {
    alignSelf: "flex-end",
    maxWidth: "100%",
    borderRadius: radius.sm,
    paddingHorizontal: space[1],
    paddingVertical: 2,
    backgroundColor: darkColors.bg,
  },
  cueTime: { color: darkColors.text, fontSize: fontSize.sm, fontWeight: "600", fontVariant: ["tabular-nums"] },
  placeholder: { color: darkColors.textMuted, fontWeight: "500", fontSize: fontSize["2xl"] },
  fallback: { color: darkColors.textMuted, fontSize: fontSize.sm, textAlign: "center" },
  caption: { paddingVertical: space[1], paddingHorizontal: space[2], gap: 2 },
  label: { color: darkColors.text, fontSize: fontSize.sm, fontWeight: "700" },
  status: { color: darkColors.textMuted, fontSize: fontSize.xs, fontWeight: "600" },
  ready: { color: darkColors.success },
  missing: { color: darkColors.warning },
});
