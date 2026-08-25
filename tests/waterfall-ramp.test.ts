/**
 * The waterfall colour ramp is a sequential magnitude encoding, so it has to
 * increase in perceived lightness from end to end. A ramp that dips somewhere
 * in the middle draws a visual boundary the data does not have — the operator
 * reads it as an edge in the signal.
 *
 * This is easy to break by "just tweaking a colour", hence the test.
 */

import { describe, expect, it } from 'vitest';

import { RAMP, RAMP_STOPS } from '../src/render/tuning-display';

/** WCAG relative luminance: the standard proxy for perceived lightness. */
function luminance(r: number, g: number, b: number): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

describe('waterfall ramp', () => {
  it('covers the full 256-entry lookup table', () => {
    expect(RAMP.length).toBe(256 * 3);
  });

  it('runs from the panel background to near-white', () => {
    expect(luminance(RAMP[0], RAMP[1], RAMP[2])).toBeLessThan(0.01);
    expect(luminance(RAMP[255 * 3], RAMP[255 * 3 + 1], RAMP[255 * 3 + 2])).toBeGreaterThan(0.85);
  });

  it('never decreases any channel between stops', () => {
    // This is the structural property that guarantees monotonic lightness: a
    // segment where green falls while red rises dips in luminance even though
    // both endpoints are brighter, because green carries ~0.72 of the weight.
    for (let i = 1; i < RAMP_STOPS.length; i++) {
      const [, prevR, prevG, prevB] = RAMP_STOPS[i - 1];
      const [, r, g, b] = RAMP_STOPS[i];
      expect(r, `red decreases into stop ${i}`).toBeGreaterThanOrEqual(prevR);
      expect(g, `green decreases into stop ${i}`).toBeGreaterThanOrEqual(prevG);
      expect(b, `blue decreases into stop ${i}`).toBeGreaterThanOrEqual(prevB);
    }
  });

  it('increases in lightness monotonically across every entry', () => {
    let previous = -Infinity;
    for (let i = 0; i < 256; i++) {
      const current = luminance(RAMP[i * 3], RAMP[i * 3 + 1], RAMP[i * 3 + 2]);
      expect(current, `lightness drops at entry ${i}`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('has stop positions in ascending order spanning 0..1', () => {
    expect(RAMP_STOPS[0][0]).toBe(0);
    expect(RAMP_STOPS[RAMP_STOPS.length - 1][0]).toBe(1);
    for (let i = 1; i < RAMP_STOPS.length; i++) {
      expect(RAMP_STOPS[i][0]).toBeGreaterThan(RAMP_STOPS[i - 1][0]);
    }
  });
});
