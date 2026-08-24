/**
 * Unit tests for canonical floating-layer z-index scale.
 * Validates exact boundary values, reserved gaps, and strict ordering hierarchy
 * across content, modals, shell chrome, first-run chooser, and system diagnostic layers.
 */

import { describe, expect, it } from "vitest";
import {
  CONFIG_SELECT_FLOATING_LAYER_NAME,
  CONFIG_SELECT_FLOATING_LAYER_Z_INDEX,
  Z_BASE,
  Z_BUILD_BADGE,
  Z_DIALOG,
  Z_DIALOG_OVERLAY,
  Z_DROPDOWN,
  Z_FIRST_RUN_CHOOSER,
  Z_GLOBAL_EMOTE,
  Z_MODAL,
  Z_MODAL_BACKDROP,
  Z_OVERLAY,
  Z_SHELL_OVERLAY,
  Z_STICKY,
  Z_SYSTEM_BANNER,
  Z_SYSTEM_CRITICAL,
  Z_TOOLTIP,
  Z_VIEW_MODAL,
  Z_VIEW_MODAL_BACKDROP,
} from "./floating-layers.js";

describe("floating-layers", () => {
  it("pins exact canonical z-index scale values", () => {
    expect(Z_BASE).toBe(0);
    expect(Z_DROPDOWN).toBe(10);
    expect(Z_STICKY).toBe(20);
    expect(Z_MODAL_BACKDROP).toBe(50);
    expect(Z_MODAL).toBe(100);
    expect(Z_DIALOG_OVERLAY).toBe(160);
    expect(Z_DIALOG).toBe(170);
    expect(Z_OVERLAY).toBe(200);
    expect(Z_TOOLTIP).toBe(300);
    expect(Z_VIEW_MODAL_BACKDROP).toBe(8800);
    expect(Z_VIEW_MODAL).toBe(8810);
    expect(Z_SHELL_OVERLAY).toBe(9000);
    expect(Z_FIRST_RUN_CHOOSER).toBe(9400);
    expect(Z_SYSTEM_BANNER).toBe(9998);
    expect(Z_SYSTEM_CRITICAL).toBe(9999);
    expect(Z_GLOBAL_EMOTE).toBe(11000);
    expect(CONFIG_SELECT_FLOATING_LAYER_Z_INDEX).toBe(12000);
    expect(Z_BUILD_BADGE).toBe(13000);
    expect(CONFIG_SELECT_FLOATING_LAYER_NAME).toBe("config-select");
  });

  it("enforces strict ascending ordering across full canonical chain", () => {
    const scale = [
      Z_BASE,
      Z_DROPDOWN,
      Z_STICKY,
      Z_MODAL_BACKDROP,
      Z_MODAL,
      Z_DIALOG_OVERLAY,
      Z_DIALOG,
      Z_OVERLAY,
      Z_TOOLTIP,
      Z_VIEW_MODAL_BACKDROP,
      Z_VIEW_MODAL,
      Z_SHELL_OVERLAY,
      Z_FIRST_RUN_CHOOSER,
      Z_SYSTEM_BANNER,
      Z_SYSTEM_CRITICAL,
      Z_GLOBAL_EMOTE,
      CONFIG_SELECT_FLOATING_LAYER_Z_INDEX,
      Z_BUILD_BADGE,
    ];

    for (let i = 0; i < scale.length - 1; i++) {
      expect(scale[i]).toBeLessThan(scale[i + 1]);
      // Verify reserved gap spacing between tiers
      expect(scale[i + 1] - scale[i]).toBeGreaterThanOrEqual(1);
    }
  });

  it("first-run chooser sits between shell overlay and system banner", () => {
    expect(Z_FIRST_RUN_CHOOSER).toBeGreaterThan(Z_SHELL_OVERLAY);
    expect(Z_FIRST_RUN_CHOOSER).toBeLessThan(Z_SYSTEM_BANNER);
  });
});
