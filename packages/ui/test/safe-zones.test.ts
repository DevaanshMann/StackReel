import { SafeZonePreset } from "@stackreel/template-schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { safeZoneInsetsPx, safeZones, type SafeZonePresetName } from "../src/index.js";

describe("safe zones", () => {
  it("has exactly one entry per template schema safeZones.preset value", () => {
    expect(Object.keys(safeZones).sort()).toEqual([...SafeZonePreset.options].sort());
    expectTypeOf<SafeZonePresetName>().toEqualTypeOf<SafeZonePreset>();
  });

  it.each(Object.entries(safeZones))("%s insets are normalized and leave room in the middle", (_preset, insets) => {
    for (const value of Object.values(insets)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(0.5);
    }
    expect(insets.top + insets.bottom).toBeLessThan(1);
    expect(insets.left + insets.right).toBeLessThan(1);
  });

  it("none covers nothing", () => {
    expect(safeZones.none).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("tiktok-reels-shorts covers every single-platform preset", () => {
    const combined = safeZones["tiktok-reels-shorts"];
    for (const preset of ["tiktok", "instagram-reels", "youtube-shorts"] as const) {
      for (const side of ["top", "bottom", "left", "right"] as const) {
        expect(combined[side]).toBeGreaterThanOrEqual(safeZones[preset][side]);
      }
    }
  });

  it("converts to pixels", () => {
    expect(safeZoneInsetsPx({ top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 }, 1080, 1920)).toEqual({
      top: 192,
      bottom: 384,
      left: 54,
      right: 162,
    });
  });
});
