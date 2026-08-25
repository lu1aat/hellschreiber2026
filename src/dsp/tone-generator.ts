/**
 * Transmit signal generation: raster -> on/off keyed audio.
 *
 * Plain class, no AudioWorklet types, so the loopback test can run it. The
 * worklet in ./worklets/hell-tx.worklet.ts is a thin wrapper around this.
 *
 * Two properties matter for being a good neighbour on a shared band:
 *
 *  1. The oscillator phase is continuous across element boundaries. Restarting
 *     phase per dot produces broadband clicks.
 *  2. Element transitions are raised-cosine shaped, not hard switched. Hard
 *     keying of a 1500 Hz tone at 245 Hz splatters sidebands across hundreds of
 *     hertz; the shaping is what keeps Feld Hell inside ~350 Hz.
 */

import type { HellMode } from '../hell/modes';
import { dotDurationSec, dotsPerPixel } from '../hell/modes';
import { rasterToElements, type Raster } from '../hell/raster';

export interface ToneGeneratorOptions {
  /** Audio centre frequency, Hz. Where the tone lands in the rig's passband. */
  freqHz?: number;
  /** Output amplitude, 0..1. Leave headroom: clipping in the sound card splatters. */
  amplitude?: number;
  /** Raised-cosine rise/fall time, seconds. Longer = cleaner but softer dots. */
  rampSec?: number;
}

const DEFAULTS: Required<ToneGeneratorOptions> = {
  freqHz: 1500,
  amplitude: 0.5,
  rampSec: 0.002,
};

export class HellToneGenerator {
  private readonly samplesPerElement: number;
  private readonly rampSamples: number;

  private elements: Uint8Array = new Uint8Array(0);
  private elementIndex = 0;
  private sampleInElement = 0;

  private phase = 0;
  private phaseIncrement: number;
  private amplitude: number;

  private envelope = 0;
  private envelopeStart = 0;
  private envelopeTarget = 0;
  private rampPosition = 1;

  constructor(
    private readonly sampleRate: number,
    private readonly mode: HellMode,
    options: ToneGeneratorOptions = {},
  ) {
    const o = { ...DEFAULTS, ...options };
    this.samplesPerElement = sampleRate * dotDurationSec(mode);
    this.rampSamples = Math.max(1, Math.round(sampleRate * o.rampSec));
    this.phaseIncrement = (2 * Math.PI * o.freqHz) / sampleRate;
    this.amplitude = o.amplitude;
  }

  /** Queue a raster for transmission, replacing anything still pending. */
  send(raster: Raster): void {
    this.elements = rasterToElements(raster, dotsPerPixel(this.mode));
    this.elementIndex = 0;
    this.sampleInElement = 0;
  }

  /** Stop immediately, ramping the envelope down rather than cutting it. */
  stop(): void {
    this.elements = new Uint8Array(0);
    this.elementIndex = 0;
    this.sampleInElement = 0;
    this.setEnvelopeTarget(0);
  }

  /** Retune without restarting the oscillator, so tuning never clicks. */
  setFrequency(freqHz: number): void {
    this.phaseIncrement = (2 * Math.PI * freqHz) / this.sampleRate;
  }

  setAmplitude(amplitude: number): void {
    this.amplitude = Math.max(0, Math.min(1, amplitude));
  }

  get isTransmitting(): boolean {
    return this.elementIndex < this.elements.length || this.envelope > 1e-4;
  }

  /** Fraction of the queued message already sent, 0..1. */
  get progress(): number {
    if (this.elements.length === 0) return 1;
    return Math.min(1, this.elementIndex / this.elements.length);
  }

  /**
   * Render the next block of samples. Always fills `out` completely, writing
   * silence once the message is done. Returns true while still transmitting.
   */
  fill(out: Float32Array): boolean {
    for (let i = 0; i < out.length; i++) {
      // Advance the element clock by counting samples. Sample counting is the
      // only timing source accurate enough for 4 ms slots; nothing here may
      // depend on wall-clock time or block scheduling.
      if (this.sampleInElement >= this.samplesPerElement) {
        this.sampleInElement -= this.samplesPerElement;
        this.elementIndex++;
      }

      const on = this.elementIndex < this.elements.length && this.elements[this.elementIndex] > 127;
      this.setEnvelopeTarget(on ? 1 : 0);
      this.advanceEnvelope();

      out[i] = Math.sin(this.phase) * this.envelope * this.amplitude;

      this.phase += this.phaseIncrement;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      this.sampleInElement++;
    }

    return this.isTransmitting;
  }

  private setEnvelopeTarget(target: number): void {
    if (target === this.envelopeTarget) return;
    this.envelopeStart = this.envelope;
    this.envelopeTarget = target;
    this.rampPosition = 0;
  }

  private advanceEnvelope(): void {
    if (this.rampPosition >= 1) {
      this.envelope = this.envelopeTarget;
      return;
    }
    this.rampPosition = Math.min(1, this.rampPosition + 1 / this.rampSamples);
    // Raised cosine: smooth in value *and* slope at both ends, which is what
    // actually suppresses the key clicks.
    const shaped = 0.5 - 0.5 * Math.cos(Math.PI * this.rampPosition);
    this.envelope = this.envelopeStart + (this.envelopeTarget - this.envelopeStart) * shaped;
  }
}
