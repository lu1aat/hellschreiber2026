/// <reference lib="webworker" />
/**
 * Receive worklet. A thin shell around HellDemodulator.
 *
 * Elements are accumulated into a preallocated buffer and shipped to the UI
 * thread in batches — one message per render frame's worth of data, not one per
 * element (which would be 245 messages/second of pure overhead).
 */

import { HellDemodulator } from '../demodulator';
import type { HellMode } from '../../hell/modes';

interface ConfigMessage {
  type: 'config';
  centerFreqHz?: number;
  bandwidthHz?: number;
  clockPpm?: number;
}
interface ResetMessage {
  type: 'reset';
}
type RxMessage = ConfigMessage | ResetMessage;

/** Elements buffered before a batch is posted. ~50 ms at 245 elements/sec. */
const BATCH_SIZE = 12;

class HellRxProcessor extends AudioWorkletProcessor {
  private readonly demodulator: HellDemodulator;
  private readonly scratch: Uint8Array;
  private readonly batch: Uint8Array;
  private batchCount = 0;
  private snrCounter = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const mode = options.processorOptions.mode as HellMode;
    this.demodulator = new HellDemodulator(sampleRate, mode, options.processorOptions.rx);

    // Generous: a render quantum is 128 samples, far less than one element, but
    // some browsers use larger quanta and we must never overflow.
    this.scratch = new Uint8Array(256);
    this.batch = new Uint8Array(BATCH_SIZE * 4);

    this.port.onmessage = (event: MessageEvent<RxMessage>) => {
      const msg = event.data;
      if (msg.type === 'reset') {
        this.demodulator.reset();
        return;
      }
      if (msg.centerFreqHz !== undefined) this.demodulator.setCenterFrequency(msg.centerFreqHz);
      if (msg.bandwidthHz !== undefined) this.demodulator.setBandwidth(msg.bandwidthHz);
      if (msg.clockPpm !== undefined) this.demodulator.setClockPpm(msg.clockPpm);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    if (!channel) return true;

    const count = this.demodulator.process(channel, this.scratch);

    for (let i = 0; i < count; i++) {
      if (this.batchCount < this.batch.length) {
        this.batch[this.batchCount++] = this.scratch[i];
      }
    }

    if (this.batchCount >= BATCH_SIZE) {
      // slice() allocates, but only once per batch (~20/sec), not per sample.
      this.port.postMessage({ type: 'elements', elements: this.batch.slice(0, this.batchCount) });
      this.batchCount = 0;
    }

    if (++this.snrCounter >= 100) {
      this.snrCounter = 0;
      this.port.postMessage({ type: 'snr', db: this.demodulator.snrEstimateDb });
    }

    return true;
  }
}

registerProcessor('hell-rx', HellRxProcessor);
