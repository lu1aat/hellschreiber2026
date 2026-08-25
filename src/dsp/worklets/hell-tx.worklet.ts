/// <reference lib="webworker" />
/**
 * Transmit worklet. A thin shell around HellToneGenerator — keep it that way so
 * the DSP stays testable off the audio thread.
 *
 * Rules for this file (see CLAUDE.md > DSP conventions):
 *   - no allocation in process()
 *   - no console.log in process()
 *   - postMessage is batched, never per-sample
 */

import { HellToneGenerator } from '../tone-generator';
import type { HellMode } from '../../hell/modes';
import type { Raster } from '../../hell/raster';

interface SendMessage {
  type: 'send';
  raster: { data: Uint8Array; cols: number; rows: number };
}
interface StopMessage {
  type: 'stop';
}
interface ConfigMessage {
  type: 'config';
  freqHz?: number;
  amplitude?: number;
}
type TxMessage = SendMessage | StopMessage | ConfigMessage;

class HellTxProcessor extends AudioWorkletProcessor {
  private readonly generator: HellToneGenerator;
  private wasTransmitting = false;
  private progressCounter = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const mode = options.processorOptions.mode as HellMode;
    this.generator = new HellToneGenerator(sampleRate, mode, options.processorOptions.tone);

    this.port.onmessage = (event: MessageEvent<TxMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'send':
          this.generator.send(msg.raster as Raster);
          break;
        case 'stop':
          this.generator.stop();
          break;
        case 'config':
          if (msg.freqHz !== undefined) this.generator.setFrequency(msg.freqHz);
          if (msg.amplitude !== undefined) this.generator.setAmplitude(msg.amplitude);
          break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    const active = this.generator.fill(channel);

    // Mono source, copied to any additional channels.
    for (let c = 1; c < output.length; c++) {
      output[c].set(channel);
    }

    // Report roughly 10x/second rather than every 128-sample block.
    if (++this.progressCounter >= 40) {
      this.progressCounter = 0;
      if (active) this.port.postMessage({ type: 'progress', value: this.generator.progress });
    }

    if (this.wasTransmitting && !active) {
      this.port.postMessage({ type: 'done' });
    }
    this.wasTransmitting = active;

    // Never return false: the node stays alive for the session, waiting for the
    // next message. Returning false would permanently kill the processor.
    return true;
  }
}

registerProcessor('hell-tx', HellTxProcessor);
