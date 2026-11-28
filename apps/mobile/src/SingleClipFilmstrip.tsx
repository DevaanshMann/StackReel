import { darkColors, radius, space } from "@stackreel/ui";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { FilmstripThumbnails } from "./FilmstripThumbnails";
import { textStyles } from "./Screen";
import type { ClipFrameRange } from "./clip-source";
import { draggedTrimFrame, filmstripIntent, trimHandleAt } from "./trim-filmstrip";
import type { FilmstripIntent } from "./trim-filmstrip";

const gutter = 22;
type Boundary = keyof ClipFrameRange;

export function SingleClipFilmstrip({
  uri,
  bounds,
  selection,
  activeBoundary,
  onDrag,
  onRelease,
}: {
  uri: string;
  bounds: ClipFrameRange;
  selection: ClipFrameRange;
  activeBoundary?: Boundary | undefined;
  onDrag: (boundary: Boundary, frame: number) => void;
  onRelease: (boundary: Boundary, frame: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const gesture = useRef<{
    pageX: number;
    pageY: number;
    selection: ClipFrameRange;
    boundary: Boundary;
    trackWidth: number;
    intent: FilmstripIntent;
  } | null>(null);
  const trackWidth = Math.max(0, width - 2 * gutter);
  const sourceFrames = bounds.endFrame - bounds.startFrame;
  const left = gutter + ((selection.startFrame - bounds.startFrame) / sourceFrames) * trackWidth;
  const right = gutter + ((selection.endFrame - bounds.startFrame) / sourceFrames) * trackWidth;

  function move({ nativeEvent }: GestureResponderEvent, release: boolean) {
    const touch = gesture.current;
    if (!touch) return;
    if (release) gesture.current = null;
    const dx = nativeEvent.pageX - touch.pageX;
    touch.intent = filmstripIntent(touch.intent, dx, nativeEvent.pageY - touch.pageY);
    if (touch.intent !== "drag") return;
    const frame = draggedTrimFrame(bounds, touch.selection, touch.boundary, dx, touch.trackWidth);
    if (release) onRelease(touch.boundary, frame);
    else onDrag(touch.boundary, frame);
  }

  return (
    <>
      <View
        testID="single-trim-filmstrip"
        accessible={false}
        pointerEvents="box-only"
        style={styles.strip}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        onStartShouldSetResponder={() => trackWidth > 0 && sourceFrames > 1}
        onResponderGrant={({ nativeEvent: { pageX, pageY, locationX } }) => {
          gesture.current = {
            pageX,
            pageY,
            selection,
            trackWidth,
            boundary: trimHandleAt(bounds, selection, locationX - gutter, trackWidth),
            intent: "pending",
          };
        }}
        onResponderMove={(event) => move(event, false)}
        onResponderRelease={(event) => move(event, true)}
        onResponderTerminationRequest={() => gesture.current?.intent !== "drag"}
        onResponderTerminate={() => {
          const touch = gesture.current;
          gesture.current = null;
          if (touch?.intent === "drag") onRelease(touch.boundary, null);
        }}
      >
        <View style={styles.track}>
          <FilmstripThumbnails
            uri={uri}
            firstFrame={bounds.startFrame}
            endFrame={bounds.endFrame}
            onUnavailableChange={setUnavailable}
          />
        </View>
        {trackWidth > 0 && (
          <>
            <View style={[styles.shade, { left: gutter, width: left - gutter }]} />
            <View style={[styles.shade, { left: right, right: gutter }]} />
            <View style={[styles.range, { left, width: right - left }]} />
            <View
              style={[
                styles.handle,
                styles.inHandle,
                { left: left - gutter },
                activeBoundary === "startFrame" && styles.active,
              ]}
            >
              <View style={styles.grip} />
            </View>
            <View
              style={[styles.handle, styles.outHandle, { left: right }, activeBoundary === "endFrame" && styles.active]}
            >
              <View style={styles.grip} />
            </View>
          </>
        )}
      </View>
      {unavailable && <Text style={textStyles.muted}>Thumbnails unavailable.</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  strip: { height: 60, direction: "ltr" },
  track: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: gutter,
    right: gutter,
    overflow: "hidden",
    backgroundColor: darkColors.elevated,
  },
  shade: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.68)" },
  range: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: darkColors.accent,
  },
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: gutter,
    backgroundColor: darkColors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  inHandle: { borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  outHandle: { borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  active: { backgroundColor: darkColors.text },
  grip: { width: 3, height: space[5], borderRadius: radius.full, backgroundColor: darkColors.onAccent },
});
