/**
 * Receive gain normalization.
 *
 * Tracks the signal peak and the noise floor separately and maps the span
 * between them onto 0..1. Both trackers are deliberately slow: they should
 * follow band conditions and QSB over seconds, not chase individual dots. An
 * AGC fast enough to react within a character will flatten the very contrast
 * the operator is reading.
 */

export interface AgcOptions {
  /** Seconds for the peak tracker to rise toward a louder signal. */
  peakAttackSec?: number;
  /** Seconds for the peak tracker to fall after a signal goes away. */
  peakDecaySec?: number;
  /** Seconds for the noise-floor tracker to follow the band down / up. */
  floorAttackSec?: number;
  floorDecaySec?: number;
  /** Minimum peak-to-floor span; stops pure noise from being amplified to full scale. */
  minSpan?: number;
}

const DEFAULTS: Required<AgcOptions> = {
  peakAttackSec: 0.05,
  peakDecaySec: 2.0,
  floorAttackSec: 2.0,
  floorDecaySec: 0.2,
  minSpan: 1e-4,
};

/** Per-sample smoothing coefficient for a given time constant. */
function coeff(timeConstantSec: number, updateRateHz: number): number {
  return 1 - Math.exp(-1 / Math.max(timeConstantSec * updateRateHz, 1e-9));
}

export class Agc {
  private peak = 0;
  private floor = 0;
  private readonly peakAttack: number;
  private readonly peakDecay: number;
  private readonly floorAttack: number;
  private readonly floorDecay: number;
  private readonly minSpan: number;

  /** @param updateRateHz how often `normalize` is called, in Hz. */
  constructor(updateRateHz: number, options: AgcOptions = {}) {
    const o = { ...DEFAULTS, ...options };
    this.peakAttack = coeff(o.peakAttackSec, updateRateHz);
    this.peakDecay = coeff(o.peakDecaySec, updateRateHz);
    this.floorAttack = coeff(o.floorAttackSec, updateRateHz);
    this.floorDecay = coeff(o.floorDecaySec, updateRateHz);
    this.minSpan = o.minSpan;
  }

  /** Feed one magnitude sample, get back 0..1. */
  normalize(magnitude: number): number {
    this.peak += (magnitude - this.peak) * (magnitude > this.peak ? this.peakAttack : this.peakDecay);
    this.floor += (magnitude - this.floor) * (magnitude < this.floor ? this.floorDecay : this.floorAttack);

    const span = Math.max(this.peak - this.floor, this.minSpan);
    const value = (magnitude - this.floor) / span;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  reset(): void {
    this.peak = 0;
    this.floor = 0;
  }

  /** Current peak-to-floor ratio in dB — drives the UI's signal indicator. */
  get snrEstimateDb(): number {
    if (this.floor <= 0) return 0;
    return 20 * Math.log10(Math.max(this.peak, 1e-12) / this.floor);
  }
}
