import { TEMPLATE_DEFAULTS as t } from "@stackreel/template-schema";
import jsonSchema from "@stackreel/template-schema/schema.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { PLAN_DEFAULTS } from "../src/index.js";

const defs = jsonSchema.$defs;

describe("PLAN_DEFAULTS", () => {
  it("matches the template format's defaults", () => {
    expect(PLAN_DEFAULTS).toEqual({
      background: t.canvas.background,
      fit: t.mediaItem.fit,
      speed: t.mediaItem.speed,
      gainDb: t.mediaItem.gainDb,
      direction: t.transition.direction,
      musicStartUs: t.music.startUs,
      style: t.style,
      position: t.position,
      animationDurationUs: t.animation.inDurationUs,
      duckGainDb: t.music.duckGainDb,
      duckRampUs: t.music.duckRampUs,
    });
    // resolve() uses one value for both of each pair.
    expect(t.music.gainDb).toBe(PLAN_DEFAULTS.gainDb);
    expect(t.animation.outDurationUs).toBe(PLAN_DEFAULTS.animationDurationUs);
  });

  it("matches the default keywords in the committed JSON Schema", () => {
    expect(PLAN_DEFAULTS).toEqual({
      background: defs.Canvas.properties.background.default,
      fit: defs.MediaItem.properties.fit.default,
      speed: defs.MediaItem.properties.speed.default,
      gainDb: defs.MediaItem.properties.gainDb.default,
      direction: defs.Transition.properties.direction.default,
      musicStartUs: defs.Music.properties.startUs.default,
      style: defs.TextItem.properties.style.default,
      position: defs.TextItem.properties.position.default,
      animationDurationUs: defs.Animation.properties.inDurationUs.default,
      duckGainDb: defs.Music.properties.duckGainDb.default,
      duckRampUs: defs.Music.properties.duckRampUs.default,
    });
    expect(defs.StickerItem.properties.position.default).toEqual(PLAN_DEFAULTS.position);
    expect(defs.Music.properties.gainDb.default).toBe(PLAN_DEFAULTS.gainDb);
    expect(defs.Animation.properties.outDurationUs.default).toBe(PLAN_DEFAULTS.animationDurationUs);
  });
});
