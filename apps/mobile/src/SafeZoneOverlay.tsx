import { safeZoneOverlayStyle } from "@stackreel/ui";
import type { Rect } from "@stackreel/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { fitPreviewCanvas } from "./template-safe-zones";
import type { SafeZoneGuide } from "./template-safe-zones";

const outlineWidth = 1;

export function SafeZoneOverlay({ canvas, guide }: { canvas: Pick<Rect, "width" | "height">; guide: SafeZoneGuide }) {
  const [viewport, setViewport] = useState<Pick<Rect, "width" | "height"> | null>(null);
  const frame = viewport && viewport.width > 0 && viewport.height > 0 ? fitPreviewCanvas(canvas, viewport) : null;
  const scale = frame ? frame.width / canvas.width : 0;

  function placeRegion({ x, y, width, height }: Rect, outset = 0) {
    return {
      left: x * scale - outset,
      top: y * scale - outset,
      width: width * scale + 2 * outset,
      height: height * scale + 2 * outset,
    };
  }

  return (
    <View
      testID="template-safe-zones-overlay"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent: { layout } }) => setViewport(layout)}
      style={StyleSheet.absoluteFill}
    >
      {frame && (
        <View style={[styles.canvas, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]}>
          {guide.covered.map((region) => (
            <View key={`${region.x},${region.y}`} style={[styles.shade, placeRegion(region)]} />
          ))}
          {guide.safe && <View style={[styles.outline, placeRegion(guide.safe, outlineWidth)]} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: "absolute", overflow: "hidden" },
  shade: {
    position: "absolute",
    backgroundColor: safeZoneOverlayStyle.shade,
    opacity: safeZoneOverlayStyle.shadeOpacity,
  },
  outline: {
    position: "absolute",
    borderWidth: outlineWidth,
    borderColor: safeZoneOverlayStyle.outline,
    borderStyle: "dashed",
  },
});
