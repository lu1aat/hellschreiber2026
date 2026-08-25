/**
 * Web Audio plumbing: microphone in, worklets, speaker out.
 *
 * Graph:
 *
 *   mic/line-in ──> [source] ──┬──> AnalyserNode ──> (spectrum display)
 *                              └──> hell-rx worklet ──> (elements to UI)
 *                                        ▲
 *   hell-tx worklet ──> txGain ──┬───────┘  (loopback, when monitoring)
 *                                └──> destination (speaker / rig input)
 *
 * The loopback path is what lets the app be exercised with no radio at all:
 * transmit and watch your own text appear on the strip.
 */

import rxWorkletUrl from '../dsp/worklets/hell-rx.worklet.ts?worker&url';
import txWorkletUrl from '../dsp/worklets/hell-tx.worklet.ts?worker&url';
import type { HellMode } from '../hell/modes';
import type { Raster } from '../hell/raster';

export interface EngineCallbacks {
  onElements?: (elements: Uint8Array) => void;
  onSnr?: (db: number) => void;
  onTxProgress?: (value: number) => void;
  onTxDone?: () => void;
}

export interface EngineConfig {
  centerFreqHz: number;
  bandwidthHz: number;
  clockPpm: number;
  txAmplitude: number;
}

/** AudioContext.setSinkId is Chromium-only at time of writing. */
type AudioContextWithSink = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export class HellAudioEngine {
  private context: AudioContextWithSink | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rxNode: AudioWorkletNode | null = null;
  private txNode: AudioWorkletNode | null = null;
  private txGain: GainNode | null = null;
  // Type deliberately inferred: getFloatFrequencyData requires a Float32Array
  // backed by a plain ArrayBuffer, which an explicit `: Float32Array`
  // annotation widens to ArrayBufferLike (and therefore rejects).
  private spectrumData = new Float32Array(0);
  private monitoring = false;

  constructor(
    private readonly mode: HellMode,
    private config: EngineConfig,
    private readonly callbacks: EngineCallbacks = {},
  ) {}

  get isRunning(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48000;
  }

  /**
   * Create the context and load the worklets. Must be called from a user
   * gesture — browsers start every AudioContext suspended.
   */
  async start(inputDeviceId?: string): Promise<void> {
    if (this.context === null) {
      this.context = new AudioContext({ latencyHint: 'interactive' }) as AudioContextWithSink;
      await this.context.audioWorklet.addModule(rxWorkletUrl);
      await this.context.audioWorklet.addModule(txWorkletUrl);
      this.buildGraph();
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    await this.setInputDevice(inputDeviceId);
  }

  private buildGraph(): void {
    const ctx = this.context!;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.5;
    this.spectrumData = new Float32Array(this.analyser.frequencyBinCount);

    this.rxNode = new AudioWorkletNode(ctx, 'hell-rx', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: {
        mode: this.mode,
        rx: {
          centerFreqHz: this.config.centerFreqHz,
          bandwidthHz: this.config.bandwidthHz,
          clockPpm: this.config.clockPpm,
        },
      },
    });
    this.rxNode.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'elements') this.callbacks.onElements?.(msg.elements as Uint8Array);
      else if (msg.type === 'snr') this.callbacks.onSnr?.(msg.db as number);
    };

    this.txNode = new AudioWorkletNode(ctx, 'hell-tx', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        mode: this.mode,
        tone: { freqHz: this.config.centerFreqHz, amplitude: this.config.txAmplitude },
      },
    });
    this.txNode.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'progress') this.callbacks.onTxProgress?.(msg.value as number);
      else if (msg.type === 'done') this.callbacks.onTxDone?.();
    };

    this.txGain = ctx.createGain();
    this.txNode.connect(this.txGain);
    this.txGain.connect(ctx.destination);
  }

  /** Open (or reopen) the capture device and rewire the receive chain. */
  async setInputDevice(deviceId?: string): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // All three of these mangle Hell audio: echo cancellation notches the
        // tone, noise suppression treats a steady carrier as noise to remove,
        // and browser AGC fights our own. The classic symptom of leaving them
        // on is a decode that fades out during long tones.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser!);
    this.source.connect(this.rxNode!);
  }

  /** Chromium only; resolves false where the browser has no sink selection. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const ctx = this.context;
    if (!ctx || typeof ctx.setSinkId !== 'function') return false;
    await ctx.setSinkId(deviceId);
    return true;
  }

  /**
   * Route transmitted audio back into the decoder. Useful with no radio
   * attached, and the fastest way to confirm the whole chain works.
   */
  setMonitoring(enabled: boolean): void {
    if (!this.txGain || !this.rxNode || !this.analyser) return;
    if (enabled === this.monitoring) return;

    if (enabled) {
      this.txGain.connect(this.rxNode);
      this.txGain.connect(this.analyser);
    } else {
      this.txGain.disconnect(this.rxNode);
      this.txGain.disconnect(this.analyser);
    }
    this.monitoring = enabled;
  }

  transmit(raster: Raster): void {
    this.txNode?.port.postMessage({
      type: 'send',
      raster: { data: raster.data, cols: raster.cols, rows: raster.rows },
    });
  }

  abortTransmit(): void {
    this.txNode?.port.postMessage({ type: 'stop' });
  }

  setCenterFrequency(freqHz: number): void {
    this.config.centerFreqHz = freqHz;
    this.rxNode?.port.postMessage({ type: 'config', centerFreqHz: freqHz });
    // TX follows RX: on a Hell QSO both stations sit on the same audio tone, so
    // splitting them into separate controls only invites mistakes.
    this.txNode?.port.postMessage({ type: 'config', freqHz });
  }

  setBandwidth(bandwidthHz: number): void {
    this.config.bandwidthHz = bandwidthHz;
    this.rxNode?.port.postMessage({ type: 'config', bandwidthHz });
  }

  setClockPpm(ppm: number): void {
    this.config.clockPpm = ppm;
    this.rxNode?.port.postMessage({ type: 'config', clockPpm: ppm });
  }

  setTxAmplitude(amplitude: number): void {
    this.config.txAmplitude = amplitude;
    this.txNode?.port.postMessage({ type: 'config', amplitude });
  }

  resetReceiver(): void {
    this.rxNode?.port.postMessage({ type: 'reset' });
  }

  /** Latest spectrum frame in dB, or null before the graph exists. */
  getSpectrum(): Float32Array | null {
    if (!this.analyser) return null;
    this.analyser.getFloatFrequencyData(this.spectrumData);
    return this.spectrumData;
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.context?.close();
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.rxNode = null;
    this.txNode = null;
    this.txGain = null;
  }
}
