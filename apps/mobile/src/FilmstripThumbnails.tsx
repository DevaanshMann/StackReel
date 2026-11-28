import { frameToUs } from "@stackreel/core";
import { getVideoThumbnails } from "@stackreel/engine";
import { darkColors } from "@stackreel/ui";
import { memo, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { canvas } from "./clip-source";
import { filmstripSamples } from "./trim-filmstrip";

type ThumbnailRequest = { uri: string; timesUs: number[] };

export const FilmstripThumbnails = memo(function FilmstripThumbnails({
  uri,
  firstFrame,
  endFrame,
  onUnavailableChange,
}: {
  uri: string;
  firstFrame: number;
  endFrame: number;
  onUnavailableChange?: (unavailable: boolean) => void;
}) {
  const request = useMemo<ThumbnailRequest>(
    () => ({
      uri,
      timesUs: filmstripSamples(firstFrame, endFrame).map((frame) => frameToUs(frame, canvas.fps)),
    }),
    [uri, firstFrame, endFrame],
  );
  const [result, setResult] = useState<{ request: ThumbnailRequest; frames: (string | null)[] } | null>(null);
  const frames = result?.request === request ? result.frames : null;
  const unavailable = frames !== null && !frames.some(Boolean);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const frames = await getVideoThumbnails(request.uri, request.timesUs);
        if (active) setResult({ request, frames });
      } catch {
        if (active) setResult({ request, frames: [] });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [request]);

  useEffect(() => {
    onUnavailableChange?.(unavailable);
  }, [onUnavailableChange, unavailable]);

  function markUnavailable(index: number) {
    setResult((previous) => {
      if (previous?.request !== request || !previous.frames[index]) return previous;
      const frames = [...previous.frames];
      frames[index] = null;
      return { request, frames };
    });
  }

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.track}
    >
      {request.timesUs.map((time, index) => {
        const frame = frames?.[index];
        return (
          <View key={time} style={styles.tile}>
            {frame && (
              <Image
                accessible={false}
                resizeMode="cover"
                source={{ uri: frame }}
                style={StyleSheet.absoluteFill}
                onError={() => markUnavailable(index)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    direction: "ltr",
    backgroundColor: darkColors.elevated,
  },
  tile: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderColor: darkColors.border },
});
