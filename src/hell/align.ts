/**
 * Print sync: where the sender's character cell starts in our element stream.
 *
 * A Hell receiver has no frame sync. It counts elements from whenever the
 * operator pressed Start, so the picture lands at an arbitrary vertical offset
 * inside the print lane and a character can end up split across the join
 * between the two print copies. On the original machines the fix was a phasing
 * knob. This finds the same setting from the signal.
 *
 * It works because every on-air Hell font leaves the top and bottom rows of the
 * 7x7 cell blank (see `hell/font.ts`, and fldigi's `feld7x7_14`). Those two rows
 * are *adjacent* in the cyclic element order — the bottom pad is transmitted
 * first, the top pad last — so the quietest run of `2 * dotsPerPixel` lane
 * positions is the gap between lines, and the cell boundary sits a fixed
 * distance from it.
 *
 * Note what this is not. It does not look at characters, match templates, or
 * threshold anything, and it never changes a pixel's intensity: it only decides
 * *where on the canvas* the raster is drawn. That is the same judgement an
 * operator makes by eye when nudging a phasing control until the white gap
 * lines up, and it leaves CLAUDE.md's fourth constraint intact.
 */

import type { HellMode } from './modes';
import { dotsPerColumn, dotsPerPixel } from './modes';

export interface PhaseTrackerOptions {
  /** Averaging time constant, in columns. ~80 is 4.6 s of Feld Hell. */
  windowCols?: number;
  /** Gap contrast below which the estimate is not acted on. */
  minConfidence?: number;
  /** How much quieter a candidate gap must be before the picture is moved. */
  margin?: number;
}

const DEFAULTS: Required<PhaseTrackerOptions> = {
  windowCols: 80,
  // Below this the "gap" is just noise shaped by the AGC, and following it
  // would make the picture wander while the band is empty. Measured against
  // off-air recordings: band noise scores 0.03-0.06, a clean machine-generated
  // clip 0.87, a real 80 m QSO through QSB 0.84, and a drifting off-tape
  // recording 0.30 at its most readable. 0.2 sits well clear of the noise floor and still acts on
  // the worst signal here.
  minConfidence: 0.2,
  // Without a margin the estimate flips between two near-equal candidates every
  // few columns and the text visibly twitches.
  margin: 0.15,
};

export interface PhaseEstimate {
  /** Lane position the sender's column starts on, 0..lanes-1. */
  phase: number;
  /**
   * How pronounced the inter-line gap is. 0 when every lane position carries
   * the same energy — no signal, or a sender whose font has no padding — and
   * approaches 1 as the gap empties out.
   */
  confidence: number;
}

export class PhaseTracker {
  /** Element positions in one column: 14 for Feld Hell. */
  private readonly lanes: number;
  /** Length of the blank run: the cell's top and bottom rows, 4 elements. */
  private readonly gapLanes: number;
  /** Element index within the cell where that blank run starts. */
  private readonly gapOffset: number;

  private readonly bins: Float64Array;
  private readonly alpha: number;
  private readonly minConfidence: number;
  private readonly margin: number;

  private pos = 0;
  private accepted = 0;

  constructor(mode: HellMode, options: PhaseTrackerOptions = {}) {
    const o = { ...DEFAULTS, ...options };
    this.lanes = dotsPerColumn(mode);
    this.gapLanes = 2 * dotsPerPixel(mode);
    // Elements go bottom first, so the cell's bottom row is elements 0..dpp-1
    // and its top row is the last dpp elements; cyclically that is one run
    // starting here.
    this.gapOffset = (mode.rows - 1) * dotsPerPixel(mode);

    this.bins = new Float64Array(this.lanes);
    // One bin is updated once per column, so the time constant is in columns.
    this.alpha = 1 - Math.exp(-1 / o.windowCols);
    this.minConfidence = o.minConfidence;
    this.margin = o.margin;
  }

  /**
   * Feed received elements, in the same order and from the same starting point
   * as the display, so that lane positions agree.
   */
  push(elements: Uint8Array, count = elements.length): void {
    for (let k = 0; k < count; k++) {
      const bin = this.pos % this.lanes;
      this.bins[bin] += (elements[k] - this.bins[bin]) * this.alpha;
      this.pos++;
    }
  }

  /** Energy in the `gapLanes` lane positions starting at `start`. */
  private gapEnergy(start: number): number {
    let sum = 0;
    for (let k = 0; k < this.gapLanes; k++) sum += this.bins[(start + k) % this.lanes];
    return sum;
  }

  /** Best phase for the energy seen so far, ignoring hysteresis. */
  estimate(): PhaseEstimate {
    let total = 0;
    for (let i = 0; i < this.lanes; i++) total += this.bins[i];

    let quietest = 0;
    let quietestEnergy = Infinity;
    for (let start = 0; start < this.lanes; start++) {
      const energy = this.gapEnergy(start);
      if (energy < quietestEnergy) {
        quietestEnergy = energy;
        quietest = start;
      }
    }

    // Compare against a flat distribution: a picture with no gap scores 0.
    const flat = (total * this.gapLanes) / this.lanes;
    const confidence = flat > 0 ? Math.max(0, 1 - quietestEnergy / flat) : 0;

    return { phase: this.toPhase(quietest), confidence };
  }

  /**
   * Recompute and return the phase to display at, moving only when a candidate
   * is convincingly better than the one in use.
   */
  track(): number {
    const { phase, confidence } = this.estimate();
    if (confidence < this.minConfidence || phase === this.accepted) return this.accepted;

    const candidate = this.gapEnergy(this.toGapStart(phase));
    const inUse = this.gapEnergy(this.toGapStart(this.accepted));
    if (candidate < inUse * (1 - this.margin)) this.accepted = phase;

    return this.accepted;
  }

  /** The phase in use, without recomputing. */
  get phase(): number {
    return this.accepted;
  }

  /** Adopt a phase chosen by hand, so auto-sync resumes from where it is. */
  set phase(value: number) {
    this.accepted = ((Math.round(value) % this.lanes) + this.lanes) % this.lanes;
  }

  private toPhase(gapStart: number): number {
    return ((gapStart - this.gapOffset) % this.lanes + this.lanes) % this.lanes;
  }

  private toGapStart(phase: number): number {
    return (phase + this.gapOffset) % this.lanes;
  }

  reset(): void {
    this.bins.fill(0);
  }
}
