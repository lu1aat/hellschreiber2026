/**
 * End-to-end loopback: text -> raster -> audio samples -> demodulator ->
 * elements, compared against what was sent.
 *
 * This is the test that matters. Unit tests on the encoder pass happily while
 * the real signal comes out slanted, half width, or upside down; only running
 * actual samples through both halves catches that. See CLAUDE.md > Testing.
 */

import { describe, expect, it } from 'vitest';

import { HellDemodulator } from '../src/dsp/demodulator';
import { HellToneGenerator } from '../src/dsp/tone-generator';
import { encodeText } from '../src/hell/encoder';
import { FELD_HELL, dotsPerPixel } from '../src/hell/modes';
import { rasterToElements } from '../src/hell/raster';

const mode = FELD_HELL;
const BLOCK = 128; // one render quantum, as the worklets will see it

/** Deterministic PRNG: a flaky DSP test is worse than no DSP test. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Box-Muller, so the added noise is actually Gaussian. */
function makeNoise(seed: number): () => number {
  const random = makeRandom(seed);
  return () => {
    const u1 = Math.max(random(), 1e-12);
    const u2 = random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

interface LoopbackOptions {
  sampleRate?: number;
  freqHz?: number;
  bandwidthHz?: number;
  /** Standard deviation of added Gaussian noise, relative to a 0.5 amplitude tone. */
  noise?: number;
  seed?: number;
}

function runLoopback(text: string, options: LoopbackOptions = {}): {
  sent: Uint8Array;
  received: Uint8Array;
} {
  const {
    sampleRate = 48000,
    freqHz = 1500,
    bandwidthHz = 350,
    noise = 0,
    seed = 12345,
  } = options;

  const raster = encodeText(text, mode);
  const sent = rasterToElements(raster, dotsPerPixel(mode));

  const generator = new HellToneGenerator(sampleRate, mode, { freqHz, amplitude: 0.5 });
  generator.send(raster);

  const demodulator = new HellDemodulator(sampleRate, mode, {
    centerFreqHz: freqHz,
    bandwidthHz,
  });

  const block = new Float32Array(BLOCK);
  const scratch = new Uint8Array(64);
  const received: number[] = [];
  const noiseSource = makeNoise(seed);

  // A little extra runtime past the message so the filter and the last elements
  // flush out of the chain.
  const totalBlocks = Math.ceil((sent.length * (sampleRate / 245)) / BLOCK) + 40;

  for (let b = 0; b < totalBlocks; b++) {
    generator.fill(block);
    if (noise > 0) {
      for (let i = 0; i < block.length; i++) block[i] += noiseSource() * noise;
    }
    const count = demodulator.process(block, scratch);
    for (let i = 0; i < count; i++) received.push(scratch[i]);
  }

  return { sent, received: Uint8Array.from(received) };
}

/**
 * Agreement between sent and received elements, after thresholding, maximised
 * over a small alignment offset. The offset accounts for group delay through
 * the receive filter — a real receiver has this too, and it is why the display
 * is a scrolling strip rather than aligned cells.
 */
function bestAgreement(
  sent: Uint8Array,
  received: Uint8Array,
  maxOffset = 8,
): { score: number; offset: number } {
  let best = { score: 0, offset: 0 };

  for (let offset = 0; offset <= maxOffset; offset++) {
    const length = Math.min(sent.length, received.length - offset);
    if (length <= 0) continue;

    let matches = 0;
    for (let i = 0; i < length; i++) {
      const a = sent[i] >= 128;
      const b = received[i + offset] >= 128;
      if (a === b) matches++;
    }

    const score = matches / length;
    if (score > best.score) best = { score, offset };
  }

  return best;
}

describe('loopback', () => {
  it('recovers the transmitted raster in clean conditions', () => {
    const { sent, received } = runLoopback('CQ CQ DE N0CALL');
    expect(received.length).toBeGreaterThan(sent.length * 0.9);

    const { score } = bestAgreement(sent, received);
    expect(score).toBeGreaterThan(0.95);
  });

  it('survives noise', () => {
    const { sent, received } = runLoopback('HELL', { noise: 0.25 });
    const { score } = bestAgreement(sent, received);
    expect(score).toBeGreaterThan(0.85);
  });

  // Sound cards report 44.1, 48 and sometimes 96 kHz. Hardcoding a rate is a
  // recurring bug class in this codebase, so every rate is exercised.
  it.each([44100, 48000, 96000])('is sample-rate agnostic at %i Hz', (sampleRate) => {
    const { sent, received } = runLoopback('TEST', { sampleRate });
    const { score } = bestAgreement(sent, received);
    expect(score).toBeGreaterThan(0.95);
  });

  it('decodes away from the default centre frequency', () => {
    const { sent, received } = runLoopback('TEST', { freqHz: 800 });
    const { score } = bestAgreement(sent, received);
    expect(score).toBeGreaterThan(0.95);
  });

  it('produces roughly the expected number of elements', () => {
    const { sent, received } = runLoopback('AB');
    // 245 elements/second; allow for the flush blocks at the end.
    expect(received.length).toBeGreaterThanOrEqual(sent.length);
    expect(received.length).toBeLessThan(sent.length + 60);
  });

  it('reports a healthy signal-to-noise estimate on a clean signal', () => {
    const sampleRate = 48000;
    const raster = encodeText('CQ TEST', mode);
    const generator = new HellToneGenerator(sampleRate, mode, { freqHz: 1500, amplitude: 0.5 });
    generator.send(raster);

    const demodulator = new HellDemodulator(sampleRate, mode, { centerFreqHz: 1500 });
    const block = new Float32Array(BLOCK);
    const scratch = new Uint8Array(64);

    for (let b = 0; b < 600; b++) {
      generator.fill(block);
      demodulator.process(block, scratch);
    }

    expect(demodulator.snrEstimateDb).toBeGreaterThan(6);
  });
});

describe('transmit signal quality', () => {
  it('keeps the envelope continuous, with no hard edges', () => {
    const sampleRate = 48000;
    const generator = new HellToneGenerator(sampleRate, mode, {
      freqHz: 1500,
      amplitude: 1,
      rampSec: 0.002,
    });
    generator.send(encodeText('W', mode));

    const block = new Float32Array(BLOCK);
    let previous = 0;
    let maxJump = 0;

    for (let b = 0; b < 400; b++) {
      generator.fill(block);
      for (let i = 0; i < block.length; i++) {
        maxJump = Math.max(maxJump, Math.abs(block[i] - previous));
        previous = block[i];
      }
    }

    // Sample-to-sample change is dominated by the 1500 Hz carrier itself
    // (2*pi*1500/48000 ~= 0.196 rad/sample, so ~0.2 peak). Anything much above
    // that means the envelope is switching abruptly and the signal is clicking.
    expect(maxJump).toBeLessThan(0.25);
  });

  it('goes silent after the message completes', () => {
    const sampleRate = 48000;
    const generator = new HellToneGenerator(sampleRate, mode, { freqHz: 1500 });
    generator.send(encodeText('A', mode));

    const block = new Float32Array(BLOCK);
    while (generator.isTransmitting) generator.fill(block);

    generator.fill(block);
    for (let i = 0; i < block.length; i++) {
      expect(Math.abs(block[i])).toBeLessThan(1e-3);
    }
  });
});
