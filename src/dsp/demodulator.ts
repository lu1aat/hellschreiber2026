/**
 * Receive chain: audio samples -> per-element intensity.
 *
 * Quadrature mixer at the tuned frequency, two-pole lowpass on each arm, then
 * magnitude. The lowpass cutoff *is* the user's "width" control: it sets the
 * receive bandwidth directly, which is why the UI can expose width as a single
 * slider with an honest meaning.
 *
 *   narrow width  -> less noise, but dots smear into each other
 *   wide width    -> crisp dots, but every crackle on the band comes through
 *
 * Note what this class does NOT do: it never decides what character it is
 * looking at. It reports intensity and the operator reads the picture. See
 * CLAUDE.md > Hard constraints.
 */

import type { HellMode } from '../hell/modes';
import { dotRate } from '../hell/modes';
import { Agc } from './agc';

export interface DemodulatorOptions {
  centerFreqHz?: number;
  /** Receive bandwidth, Hz. Feld Hell occupies roughly 350 Hz. */
  bandwidthHz?: number;
  /**
   * Receive clock trim in parts per million. Sound card crystals differ between
   * the two ends; an uncorrected error shows up as text that slants steadily up
   * or down across the strip. This is the manual "slant" control every Hell
   * program has.
   */
  clockPpm?: number;
  agc?: ConstructorParameters<typeof Agc>[1];
}

const DEFAULTS = {
  centerFreqHz: 1500,
  bandwidthHz: 350,
  clockPpm: 0,
};

/** One-pole lowpass, cascaded twice for a steeper skirt. */
class LowPass2 {
  private z1 = 0;
  private z2 = 0;
  private alpha: number;

  constructor(cutoffHz: number, sampleRate: number) {
    this.alpha = LowPass2.alphaFor(cutoffHz, sampleRate);
  }

  static alphaFor(cutoffHz: number, sampleRate: number): number {
    const clamped = Math.max(1, Math.min(cutoffHz, sampleRate / 2 - 1));
    return 1 - Math.exp((-2 * Math.PI * clamped) / sampleRate);
  }

  setCutoff(cutoffHz: number, sampleRate: number): void {
    this.alpha = LowPass2.alphaFor(cutoffHz, sampleRate);
  }

  process(x: number): number {
    this.z1 += (x - this.z1) * this.alpha;
    this.z2 += (this.z1 - this.z2) * this.alpha;
    return this.z2;
  }
}

export class HellDemodulator {
  private phase = 0;
  private phaseIncrement: number;

  private readonly lpI: LowPass2;
  private readonly lpQ: LowPass2;
  private readonly agc: Agc;

  private bandwidthHz: number;
  private clockPpm: number;

  /** Element integrator. */
  private accumulator = 0;
  private accumulatedSamples = 0;
  private samplesPerElement: number;
  private sampleInElement = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly mode: HellMode,
    options: DemodulatorOptions = {},
  ) {
    const o = { ...DEFAULTS, ...options };
    this.phaseIncrement = (2 * Math.PI * o.centerFreqHz) / sampleRate;
    this.bandwidthHz = o.bandwidthHz;
    this.clockPpm = o.clockPpm;

    const cutoff = this.bandwidthHz / 2;
    this.lpI = new LowPass2(cutoff, sampleRate);
    this.lpQ = new LowPass2(cutoff, sampleRate);

    this.samplesPerElement = this.computeSamplesPerElement();
    this.agc = new Agc(dotRate(mode), options.agc);
  }

  private computeSamplesPerElement(): number {
    return this.sampleRate / (dotRate(this.mode) * (1 + this.clockPpm * 1e-6));
  }

  setCenterFrequency(freqHz: number): void {
    this.phaseIncrement = (2 * Math.PI * freqHz) / this.sampleRate;
  }

  setBandwidth(bandwidthHz: number): void {
    this.bandwidthHz = bandwidthHz;
    this.lpI.setCutoff(bandwidthHz / 2, this.sampleRate);
    this.lpQ.setCutoff(bandwidthHz / 2, this.sampleRate);
  }

  setClockPpm(ppm: number): void {
    this.clockPpm = ppm;
    this.samplesPerElement = this.computeSamplesPerElement();
  }

  get snrEstimateDb(): number {
    return this.agc.snrEstimateDb;
  }

  /**
   * Process a block of input samples, appending one 0..255 intensity per
   * received element to `out`. Returns how many elements were written.
   *
   * `out` is caller-owned and reused so the audio thread never allocates.
   */
  process(input: Float32Array, out: Uint8Array): number {
    let written = 0;

    for (let i = 0; i < input.length; i++) {
      const x = input[i];

      // Mix down to baseband. Both arms are needed: with only one, the output
      // depends on the phase relationship to the transmitter and the envelope
      // would beat in and out.
      const i0 = this.lpI.process(x * Math.cos(this.phase));
      const q0 = this.lpQ.process(x * -Math.sin(this.phase));

      this.phase += this.phaseIncrement;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;

      this.accumulator += Math.sqrt(i0 * i0 + q0 * q0);
      this.accumulatedSamples++;
      this.sampleInElement++;

      if (this.sampleInElement >= this.samplesPerElement) {
        this.sampleInElement -= this.samplesPerElement;

        const mean = this.accumulator / Math.max(1, this.accumulatedSamples);
        this.accumulator = 0;
        this.accumulatedSamples = 0;

        if (written < out.length) {
          out[written++] = Math.round(this.agc.normalize(mean) * 255);
        }
      }
    }

    return written;
  }

  /** Upper bound on elements produced by a block of `n` samples. */
  maxElementsFor(n: number): number {
    return Math.ceil(n / this.samplesPerElement) + 1;
  }

  reset(): void {
    this.accumulator = 0;
    this.accumulatedSamples = 0;
    this.sampleInElement = 0;
    this.agc.reset();
  }
}
