/**
 * The tuning instrument: spectrum on top, waterfall below, on ONE canvas.
 *
 * They are deliberately a single component rather than two stacked widgets.
 * Both share a frequency axis, the passband overlay and cursor are drawn
 * across the full height, and a click anywhere — spectrum or waterfall — tunes.
 * An operator sees one instrument, so it is built as one.
 *
 * Feld Hell looks like a narrow ragged column flickering at the dot rate; the
 * spectrum shows the instantaneous shape and the waterfall shows it persisting
 * over time, which is what makes a weak signal findable.
 *
 * Interaction:
 *   click / drag  -> set centre frequency
 *   wheel         -> adjust receive width
 *   drag an edge  -> adjust receive width
 */

export interface TuningDisplayOptions {
  /** Lowest frequency shown, Hz. */
  minHz?: number;
  /** Highest frequency shown, Hz. An SSB rig passes roughly 300-2700 Hz. */
  maxHz?: number;
  /** dB range of the spectrum's vertical axis and the waterfall's colour ramp. */
  minDb?: number;
  maxDb?: number;
  /** Width limits enforced on the user's width control. */
  minWidthHz?: number;
  maxWidthHz?: number;
  /** Height of the spectrum region in CSS pixels; the waterfall takes the rest. */
  spectrumHeightCss?: number;
  /** Minimum gap between waterfall rows, ms. Caps history consumption. */
  rowIntervalMs?: number;
}

const DEFAULTS: Required<TuningDisplayOptions> = {
  minHz: 200,
  maxHz: 3000,
  minDb: -100,
  maxDb: -20,
  minWidthHz: 50,
  maxWidthHz: 1000,
  spectrumHeightCss: 58,
  rowIntervalMs: 40,
};

/** Pixels either side of a passband edge that count as grabbing the edge. */
const EDGE_GRAB_PX = 6;

/**
 * Waterfall history buffer, in frequency columns x time rows. Fixed size and
 * scaled on blit, so resizing the window never throws history away.
 */
const WATERFALL_BINS = 512;
const HISTORY_ROWS = 256;

/**
 * Waterfall colour ramp.
 *
 * A sequential magnitude encoding, so lightness increases monotonically from
 * one end to the other — that is what stops the ramp inventing visual
 * boundaries where the data has none. It is multi-hue rather than single-hue
 * because weak-signal detection genuinely benefits from the extra
 * discriminable steps at the bottom of the range, but the ordering is
 * viridis-like, not a rainbow: no hue doubles back in lightness.
 *
 * The upper stops sit close to the app's own accent green and amber, so a
 * strong trace on the waterfall matches the tuning cursor it sits under.
 *
 * INVARIANT: no channel ever decreases from one stop to the next. That makes
 * the monotonic lightness structural rather than a happy accident — a segment
 * where green falls while red climbs dips in luminance even though both
 * endpoints are brighter, because green carries ~0.72 of the luminance weight.
 * Keep this property when retuning the colours.
 */
export const RAMP_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0x04, 0x07, 0x0c], // near-black, the panel background
  [0.22, 0x10, 0x30, 0x6b], // deep blue
  [0.45, 0x14, 0x6b, 0x74], // teal
  [0.68, 0x5f, 0xe0, 0x8a], // accent green
  [0.86, 0xff, 0xe0, 0x8a], // warm amber
  [1.0, 0xff, 0xf6, 0xe8], // near-white
];

function buildRamp(): Uint8ClampedArray {
  const ramp = new Uint8ClampedArray(256 * 3);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;

    let upper = 1;
    while (upper < RAMP_STOPS.length - 1 && RAMP_STOPS[upper][0] < t) upper++;

    const [t0, r0, g0, b0] = RAMP_STOPS[upper - 1];
    const [t1, r1, g1, b1] = RAMP_STOPS[upper];
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);

    ramp[i * 3] = r0 + (r1 - r0) * f;
    ramp[i * 3 + 1] = g0 + (g1 - g0) * f;
    ramp[i * 3 + 2] = b0 + (b1 - b0) * f;
  }

  return ramp;
}

export const RAMP = buildRamp();

export interface TuningCallbacks {
  onCenterChange?: (freqHz: number) => void;
  onWidthChange?: (widthHz: number) => void;
}

type DragMode = 'none' | 'center' | 'edge-low' | 'edge-high';

export class TuningDisplay {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: Required<TuningDisplayOptions>;

  private centerHz = 1500;
  private widthHz = 350;
  private dragMode: DragMode = 'none';

  private peaks: Float32Array | null = null;

  private readonly waterfall: HTMLCanvasElement;
  private readonly waterfallCtx: CanvasRenderingContext2D;
  private readonly rowImage: ImageData;
  private writeRow = 0;
  private newestRow = 0;
  private lastRowTime = 0;
  private rowsWritten = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: TuningCallbacks = {},
    options: TuningDisplayOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('TuningDisplay: 2D context unavailable');
    this.ctx = ctx;

    this.waterfall = document.createElement('canvas');
    this.waterfall.width = WATERFALL_BINS;
    this.waterfall.height = HISTORY_ROWS;
    const waterfallCtx = this.waterfall.getContext('2d');
    if (!waterfallCtx) throw new Error('TuningDisplay: waterfall context unavailable');
    this.waterfallCtx = waterfallCtx;
    this.waterfallCtx.fillStyle = '#04070c';
    this.waterfallCtx.fillRect(0, 0, WATERFALL_BINS, HISTORY_ROWS);

    this.rowImage = this.waterfallCtx.createImageData(WATERFALL_BINS, 1);
    // Rows are opaque; alpha is written once here rather than every frame.
    for (let i = 0; i < WATERFALL_BINS; i++) this.rowImage.data[i * 4 + 3] = 255;

    this.attachEvents();
  }

  setCenter(freqHz: number): void {
    this.centerHz = this.clampFreq(freqHz);
  }

  setWidth(widthHz: number): void {
    this.widthHz = Math.max(this.options.minWidthHz, Math.min(this.options.maxWidthHz, widthHz));
  }

  get center(): number {
    return this.centerHz;
  }

  get width(): number {
    return this.widthHz;
  }

  /** Seconds of waterfall history currently held. */
  get historySeconds(): number {
    return (Math.min(this.rowsWritten, HISTORY_ROWS) * this.options.rowIntervalMs) / 1000;
  }

  /**
   * Draw one frame. `magnitudes` is dB data straight from an AnalyserNode;
   * `sampleRate` maps bin index to frequency.
   */
  render(magnitudes: Float32Array, sampleRate: number, now = performance.now()): void {
    const { width, height } = this.resize();
    const dpr = window.devicePixelRatio || 1;
    const spectrumHeight = Math.round(this.options.spectrumHeightCss * dpr);
    const waterfallTop = spectrumHeight + 1;

    const binHz = sampleRate / 2 / magnitudes.length;

    // Waterfall rows advance on their own clock, not once per animation frame:
    // at 60fps the history would scroll past in four seconds.
    if (now - this.lastRowTime >= this.options.rowIntervalMs) {
      this.lastRowTime = now;
      this.appendWaterfallRow(magnitudes, binHz);
    }

    this.ctx.fillStyle = '#0a0e12';
    this.ctx.fillRect(0, 0, width, height);

    this.drawWaterfall(width, waterfallTop, height - waterfallTop);
    this.drawSpectrum(magnitudes, binHz, width, spectrumHeight);
    this.drawGrid(width, height, spectrumHeight);

    // Passband and cursor last, spanning both regions — this is what makes the
    // two halves read as a single instrument.
    this.drawPassband(width, height);
    this.drawCursor(width, height, spectrumHeight);
  }

  private appendWaterfallRow(magnitudes: Float32Array, binHz: number): void {
    const { minHz, maxHz, minDb, maxDb } = this.options;
    const data = this.rowImage.data;
    const span = maxDb - minDb;

    for (let x = 0; x < WATERFALL_BINS; x++) {
      // Take the peak across each column's bin range rather than a single
      // sample: a narrow carrier must never fall between two columns.
      const f0 = minHz + (x / WATERFALL_BINS) * (maxHz - minHz);
      const f1 = minHz + ((x + 1) / WATERFALL_BINS) * (maxHz - minHz);
      const binLow = Math.max(0, Math.floor(f0 / binHz));
      const binHigh = Math.min(magnitudes.length - 1, Math.max(binLow, Math.ceil(f1 / binHz) - 1));

      let db = -Infinity;
      for (let bin = binLow; bin <= binHigh; bin++) {
        if (magnitudes[bin] > db) db = magnitudes[bin];
      }

      const normalized = Math.max(0, Math.min(1, (db - minDb) / span));
      const index = Math.round(normalized * 255) * 3;
      const o = x * 4;
      data[o] = RAMP[index];
      data[o + 1] = RAMP[index + 1];
      data[o + 2] = RAMP[index + 2];
    }

    this.waterfallCtx.putImageData(this.rowImage, 0, this.writeRow);
    this.newestRow = this.writeRow;
    // Walk backwards so the newest row can be blitted at the top in one pass.
    this.writeRow = (this.writeRow - 1 + HISTORY_ROWS) % HISTORY_ROWS;
    this.rowsWritten++;
  }

  private drawWaterfall(width: number, top: number, height: number): void {
    if (height <= 0) return;

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    // Two slices of the ring buffer: newest row first, wrapping to the start.
    const firstRun = HISTORY_ROWS - this.newestRow;
    const firstHeight = (firstRun / HISTORY_ROWS) * height;

    ctx.drawImage(
      this.waterfall,
      0, this.newestRow, WATERFALL_BINS, firstRun,
      0, top, width, firstHeight,
    );

    if (this.newestRow > 0) {
      ctx.drawImage(
        this.waterfall,
        0, 0, WATERFALL_BINS, this.newestRow,
        0, top + firstHeight, width, height - firstHeight,
      );
    }

    ctx.imageSmoothingEnabled = true;
  }

  private drawSpectrum(
    magnitudes: Float32Array,
    binHz: number,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx;
    const { minHz, maxHz, minDb, maxDb } = this.options;

    ctx.fillStyle = '#0a0e12';
    ctx.fillRect(0, 0, width, height);

    if (this.peaks === null || this.peaks.length !== magnitudes.length) {
      this.peaks = new Float32Array(magnitudes.length).fill(minDb);
    }

    const startBin = Math.max(0, Math.floor(minHz / binHz));
    const endBin = Math.min(magnitudes.length - 1, Math.ceil(maxHz / binHz));

    const toY = (db: number): number => {
      const clamped = Math.max(minDb, Math.min(maxDb, db));
      return height - ((clamped - minDb) / (maxDb - minDb)) * height;
    };

    // Peak hold, decaying slowly so short signals stay findable.
    for (let bin = startBin; bin <= endBin; bin++) {
      const db = magnitudes[bin];
      this.peaks[bin] = db > this.peaks[bin] ? db : this.peaks[bin] - 0.5;
    }

    ctx.strokeStyle = 'rgba(120, 160, 190, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let bin = startBin; bin <= endBin; bin++) {
      const x = this.freqToX(bin * binHz, width);
      const y = toY(this.peaks[bin]);
      if (bin === startBin) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#5fe08a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let bin = startBin; bin <= endBin; bin++) {
      const x = this.freqToX(bin * binHz, width);
      const y = toY(magnitudes[bin]);
      if (bin === startBin) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawGrid(width: number, height: number, spectrumHeight: number): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    // Grid runs through both regions, reinforcing the shared frequency axis.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let hz = 500; hz <= this.options.maxHz; hz += 500) {
      const x = Math.round(this.freqToX(hz, width)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Divider between the two halves.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, spectrumHeight + 0.5);
    ctx.lineTo(width, spectrumHeight + 0.5);
    ctx.stroke();

    // Labels sit just below the divider, over the waterfall's darkest region.
    ctx.fillStyle = 'rgba(190,205,215,0.6)';
    ctx.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    for (let hz = 500; hz <= this.options.maxHz; hz += 500) {
      const x = Math.round(this.freqToX(hz, width));
      ctx.fillText(`${hz}`, x + 3 * dpr, spectrumHeight + 3 * dpr);
    }
  }

  private drawPassband(width: number, height: number): void {
    const ctx = this.ctx;
    const low = this.freqToX(this.centerHz - this.widthHz / 2, width);
    const high = this.freqToX(this.centerHz + this.widthHz / 2, width);

    ctx.fillStyle = 'rgba(95, 224, 138, 0.10)';
    ctx.fillRect(low, 0, high - low, height);

    ctx.strokeStyle = 'rgba(95, 224, 138, 0.5)';
    ctx.lineWidth = 1;
    for (const x of [low, high]) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
    }
  }

  private drawCursor(width: number, height: number, spectrumHeight: number): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(this.freqToX(this.centerHz, width)) + 0.5;

    ctx.strokeStyle = '#ffcf5f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    const label = `${Math.round(this.centerHz)} Hz / ${Math.round(this.widthHz)} Hz`;
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    const textWidth = ctx.measureText(label).width;
    const boxX = Math.min(Math.max(x + 4 * dpr, 2 * dpr), width - textWidth - 8 * dpr);
    const boxY = Math.max(2 * dpr, spectrumHeight - 16 * dpr);

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(boxX - 2 * dpr, boxY, textWidth + 6 * dpr, 14 * dpr);
    ctx.fillStyle = '#ffcf5f';
    ctx.fillText(label, boxX + dpr, boxY + 2 * dpr);
  }

  private resize(): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth || 600;
    const cssHeight = this.canvas.clientHeight || 200;
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);

    // The waterfall's own buffer is a fixed size, so a resize rescales the
    // history rather than discarding it.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  private freqToX(hz: number, width: number): number {
    const { minHz, maxHz } = this.options;
    return ((hz - minHz) / (maxHz - minHz)) * width;
  }

  private xToFreq(x: number, width: number): number {
    const { minHz, maxHz } = this.options;
    return minHz + (x / width) * (maxHz - minHz);
  }

  private clampFreq(hz: number): number {
    return Math.max(this.options.minHz, Math.min(this.options.maxHz, hz));
  }

  /** Canvas-relative x in backing-store pixels. */
  private eventX(event: PointerEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * this.canvas.width;
  }

  /**
   * One pointer handler for the whole canvas, so tuning works identically
   * whether the operator clicks the spectrum trace or the waterfall trail.
   */
  private attachEvents(): void {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      const width = canvas.width;
      const x = this.eventX(event);
      const dpr = window.devicePixelRatio || 1;
      const lowX = this.freqToX(this.centerHz - this.widthHz / 2, width);
      const highX = this.freqToX(this.centerHz + this.widthHz / 2, width);

      if (Math.abs(x - lowX) < EDGE_GRAB_PX * dpr) this.dragMode = 'edge-low';
      else if (Math.abs(x - highX) < EDGE_GRAB_PX * dpr) this.dragMode = 'edge-high';
      else this.dragMode = 'center';

      canvas.setPointerCapture(event.pointerId);
      this.handleDrag(x, width);
    });

    canvas.addEventListener('pointermove', (event) => {
      const width = canvas.width;
      const x = this.eventX(event);

      if (this.dragMode === 'none') {
        const dpr = window.devicePixelRatio || 1;
        const lowX = this.freqToX(this.centerHz - this.widthHz / 2, width);
        const highX = this.freqToX(this.centerHz + this.widthHz / 2, width);
        const nearEdge =
          Math.abs(x - lowX) < EDGE_GRAB_PX * dpr || Math.abs(x - highX) < EDGE_GRAB_PX * dpr;
        canvas.style.cursor = nearEdge ? 'ew-resize' : 'crosshair';
        return;
      }
      this.handleDrag(x, width);
    });

    const endDrag = (event: PointerEvent): void => {
      this.dragMode = 'none';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const step = event.deltaY > 0 ? 1.1 : 1 / 1.1;
        this.setWidth(this.widthHz * step);
        this.callbacks.onWidthChange?.(this.widthHz);
      },
      { passive: false },
    );
  }

  private handleDrag(x: number, width: number): void {
    const hz = this.xToFreq(x, width);

    if (this.dragMode === 'center') {
      this.setCenter(hz);
      this.callbacks.onCenterChange?.(this.centerHz);
      return;
    }

    // Edge drags keep the centre fixed and move both edges symmetrically, which
    // is what an operator expects from a passband control.
    const halfWidth = Math.abs(hz - this.centerHz);
    this.setWidth(halfWidth * 2);
    this.callbacks.onWidthChange?.(this.widthHz);
  }
}
