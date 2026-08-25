/// <reference types="vite/client" />

/**
 * AudioWorklet globals.
 *
 * TypeScript's DOM lib describes the main-thread side of Web Audio but not the
 * AudioWorkletGlobalScope, so the processor base class, `registerProcessor` and
 * the ambient `sampleRate` have to be declared here. Only files under
 * src/dsp/worklets/ may use them.
 */

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
