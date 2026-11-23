import { frameToUs } from "@stackreel/core";
import { getVideoThumbnails } from "@stackreel/engine";
import { darkColors } from "@stackreel/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { textStyles } from "./Screen";
import { canvas } from "./clip-source";
import type { getTemplateTrimWindow } from "./template-editor";
import { filmstripGrabOffset, filmstripSamples, filmstripStartFrame, filmstripWindow } from "./trim-filmstrip";

export function TrimFilmstrip({
  slotId,
  uri,
  bounds,
  selectedFrame,
  onDrag,
  onRelease,
}: {
  slotId: string;
  uri: string;
  bounds: ReturnType<typeof getTemplateTrimWindow>;
  selectedFrame: number;
  onDrag: (frame: number) => void;
  onRelease: (frame: number | null) => void;
}) {
  const { firstFrame, sourceEndFrame } = bounds;
  const [width, setWidth] = useState(0);
  const [thumbnails, setThumbnails] = useState<(string | null)[] | null>(null);
  const timesUs = useMemo(
    () => filmstripSamples(firstFrame, sourceEndFrame).map((frame) => frameToUs(frame, canvas.fps)),
    [firstFrame, sourceEndFrame],
  );
  const grabOffset = useRef<number | null>(null);
  const { left, right } = filmstripWindow(bounds, selectedFrame, width);
  // A short window on a long recording can be narrower than one display point.
  const outlineWidth = Math.max(1, right - left);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getVideoThumbnails(uri, timesUs);
        if (active) setThumbnails(result);
      } catch {
        if (active) setThumbnails([]);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [uri, timesUs]);

  function frameAt(x: number) {
    return grabOffset.current === null || width <= 0 ? null : filmstripStartFrame(bounds, x, width, grabOffset.current);
  }

  return (
    <>
      <View
        testID={`trim-filmstrip-${slotId}`}
        style={styles.strip}
        pointerEvents="box-only"
        accessible={false}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        onStartShouldSetResponder={() => width > 0 && bounds.lastStartFrame > firstFrame}
        onResponderGrant={({ nativeEvent: { locationX } }) => {
          grabOffset.current = filmstripGrabOffset(bounds, selectedFrame, locationX, width);
          onDrag(filmstripStartFrame(bounds, locationX, width, grabOffset.current));
        }}
        onResponderMove={({ nativeEvent: { locationX } }) => {
          const frame = frameAt(locationX);
          if (frame !== null) onDrag(frame);
        }}
        onResponderRelease={({ nativeEvent: { locationX } }) => {
          const frame = frameAt(locationX);
          grabOffset.current = null;
          onRelease(frame);
        }}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => {
          grabOffset.current = null;
          onRelease(null);
        }}
      >
        {timesUs.map((time, index) => {
          const uri = thumbnails?.[index];
          return (
            <View key={time} style={styles.tile}>
              {uri && <Image accessible={false} resizeMode="cover" source={{ uri }} style={StyleSheet.absoluteFill} />}
            </View>
          );
        })}
        {width > 0 && (
          <>
            <View style={[styles.dim, { left: 0, width: left }]} />
            <View style={[styles.dim, { left: right, right: 0 }]} />
            <View
              testID={`trim-window-${slotId}`}
              style={[
                styles.outline,
                { left: Math.min(left, width - outlineWidth), width: outlineWidth },
                outlineWidth < 4 && styles.marker,
              ]}
            />
          </>
        )}
      </View>
      {thumbnails !== null && !thumbnails.some(Boolean) && (
        <Text style={textStyles.muted}>Thumbnails unavailable.</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    direction: "ltr",
    height: 52,
    overflow: "hidden",
    backgroundColor: darkColors.elevated,
  },
  tile: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderColor: darkColors.border },
  dim: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
  outline: { position: "absolute", top: 0, bottom: 0, borderWidth: 2, borderColor: darkColors.accent },
  marker: { borderWidth: 0, backgroundColor: darkColors.accent },
});
