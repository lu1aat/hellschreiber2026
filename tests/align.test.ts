import { describe, expect, it } from 'vitest';

import { PhaseTracker } from '../src/hell/align';
import { encodeText } from '../src/hell/encoder';
import { FELD_HELL, dotsPerColumn, dotsPerPixel } from '../src/hell/modes';
import { rasterToElements } from '../src/hell/raster';

const mode = FELD_HELL;
const lanes = dotsPerColumn(mode);

const MESSAGE = 'CQ CQ DE N0CALL N0CALL PSE K ';

/**
 * The element stream a sender puts on the air, starting `offset` elements in —
 * which is all a receiver that started counting at an arbitrary moment sees.
 * A receiver starting `offset` late has to place the cell boundary at
 * `-offset` to get the picture upright in the lane.
 */
function streamFrom(offset: number, repeats = 6): Uint8Array {
  const raster = encodeText(MESSAGE, mode, { leadingBlankCols: 0, trailingBlankCols: 0 });
  const one = rasterToElements(raster, dotsPerPixel(mode));
  const out = new Uint8Array(one.length * repeats);
  for (let r = 0; r < repeats; r++) out.set(one, r * one.length);
  return out.subarray(offset);
}

const expectedPhase = (offset: number): number => (lanes - (offset % lanes)) % lanes;

describe('phase tracker', () => {
  it('recovers the cell boundary from any starting offset', () => {
    for (let offset = 0; offset < lanes; offset++) {
      const tracker = new PhaseTracker(mode);
      tracker.push(streamFrom(offset));
      expect(tracker.track(), `offset ${offset}`).toBe(expectedPhase(offset));
    }
  });

  it('reports the gap it found with real confidence', () => {
    const tracker = new PhaseTracker(mode);
    tracker.push(streamFrom(5));
    const { phase, confidence } = tracker.estimate();
    expect(phase).toBe(expectedPhase(5));
    // The blank rows are genuinely empty, so the contrast should be strong.
    expect(confidence).toBeGreaterThan(0.8);
  });

  it('stays put on noise instead of chasing it', () => {
    // A seeded PRNG: a DSP test that fails one run in twenty is worse than none.
    let seed = 20260816;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const noise = new Uint8Array(lanes * 400);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.round(random() * 255);

    const tracker = new PhaseTracker(mode);
    tracker.phase = 3;
    tracker.push(noise);

    // Noise tops out near 0.06 across seeds, well below the 0.2 the tracker
    // needs before it will move the picture.
    expect(tracker.estimate().confidence).toBeLessThan(0.1);
    expect(tracker.track()).toBe(3);
  });

  it('holds sync once acquired rather than twitching between candidates', () => {
    const tracker = new PhaseTracker(mode);
    const stream = streamFrom(9);

    const seen = new Set<number>();
    const chunk = lanes * 20;
    for (let i = 0; i < stream.length; i += chunk) {
      tracker.push(stream.subarray(i, i + chunk));
      seen.add(tracker.track());
    }

    // It may take a moment to leave the default, but it must not oscillate.
    expect(tracker.phase).toBe(expectedPhase(9));
    expect(seen.size).toBeLessThanOrEqual(2);
  });
});
