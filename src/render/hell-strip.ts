/**
 * The receive display: a horizontally scrolling raster strip, newest at the
 * right, oldest scrolling off the left.
 *
 * The strip is printed twice, one copy above the other. That is not decoration
 * — it is how the original Feldfernschreiber worked, and it is what makes the
 * mode usable when the receive clock is slightly off: a character that drifts
 * off the top of one copy is still whole in the other, so the operator can read
 * continuously without touching the tuning.
 *
 * Intensity goes to the canvas as greyscale, unmodified. No thresholding, no
 * cleanup, no character recognition. See CLAUDE.md > Hard constraints.
 */

import type { HellMode } from '../hell/modes';
import { dotsPerColumn } from '../hell/modes';

export interface HellStripOptions {
  /** Columns of history kept in the ring buffer. */
  bufferCols?: number;
  /** Device pixels per raster pixel. */
  scale?: number;
  /** Draw the second, offset copy of the strip. */
  dualPrint?: boolean;
  /** Black-on-white, like paper tape, instead of white-on-black. */
  inverse?: boolean;
}

const DEFAULTS: Required<HellStripOptions> = {
  bufferCols: 2048,
  scale: 3,
  dualPrint: true,
  inverse: false,
};

export class HellStrip {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private readonly columnImage: ImageData;
  private readonly rowsPerColumn: number;

  private readonly pending: number[] = [];
  private writeIndex = 0;
  private options: Required<HellStripOptions>;
  private dirty = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mode: HellMode,
    options: HellStripOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.rowsPerColumn = dotsPerColumn(mode);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('HellStrip: 2D context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    this.buffer = document.createElement('canvas');
    this.buffer.width = this.options.bufferCols;
    this.buffer.height = this.rowsPerColumn;
    const bufferCtx = this.buffer.getContext('2d', { willReadFrequently: false });
    if (!bufferCtx) throw new Error('HellStrip: buffer context unavailable');
    this.bufferCtx = bufferCtx;
    this.clear();

    this.columnImage = this.bufferCtx.createImageData(1, this.rowsPerColumn);
  }

  /**
   * Feed received elements. One element is one half-height dot; a full column
   * arrives every `rowsPerColumn` elements.
   */
  pushElements(elements: Uint8Array): void {
    for (let i = 0; i < elements.length; i++) {
      this.pending.push(elements[i]);
      if (this.pending.length >= this.rowsPerColumn) {
        this.writeColumn(this.pending);
        this.pending.length = 0;
      }
    }
  }

  private writeColumn(column: number[]): void {
    const data = this.columnImage.data;
    for (let row = 0; row < this.rowsPerColumn; row++) {
      const value = this.options.inverse ? 255 - column[row] : column[row];
      const o = row * 4;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
    this.bufferCtx.putImageData(this.columnImage, this.writeIndex, 0);
    this.writeIndex = (this.writeIndex + 1) % this.options.bufferCols;
    this.dirty = true;
  }

  /** Redraw. Call from requestAnimationFrame; cheap when nothing has changed. */
  render(force = false): void {
    if (!this.dirty && !force) return;
    this.dirty = false;

    const { scale, dualPrint, inverse } = this.options;
    const cssWidth = this.canvas.clientWidth || this.canvas.width;
    const copies = dualPrint ? 2 : 1;
    const neededHeight = this.rowsPerColumn * scale * copies;

    // Resize lazily; a resize clears the canvas so it must not happen per frame.
    if (this.canvas.width !== cssWidth || this.canvas.height !== neededHeight) {
      this.canvas.width = cssWidth;
      this.canvas.height = neededHeight;
      this.ctx.imageSmoothingEnabled = false;
    }

    this.ctx.fillStyle = inverse ? '#ffffff' : '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Visible columns, ending at the write head so the newest data sits at the
    // right edge and the picture scrolls leftward.
    const visibleCols = Math.min(Math.ceil(this.canvas.width / scale), this.options.bufferCols);
    const start = (this.writeIndex - visibleCols + this.options.bufferCols) % this.options.bufferCols;
    const rowHeight = this.rowsPerColumn * scale;

    for (let copy = 0; copy < copies; copy++) {
      const y = copy * rowHeight;
      const firstRun = Math.min(visibleCols, this.options.bufferCols - start);

      this.ctx.drawImage(
        this.buffer,
        start, 0, firstRun, this.rowsPerColumn,
        0, y, firstRun * scale, rowHeight,
      );

      // The ring buffer wrapped: draw the remainder from the start of the buffer.
      const remaining = visibleCols - firstRun;
      if (remaining > 0) {
        this.ctx.drawImage(
          this.buffer,
          0, 0, remaining, this.rowsPerColumn,
          firstRun * scale, y, remaining * scale, rowHeight,
        );
      }
    }

    if (copies > 1) {
      this.ctx.fillStyle = inverse ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)';
      this.ctx.fillRect(0, rowHeight - 1, this.canvas.width, 1);
    }
  }

  setScale(scale: number): void {
    this.options.scale = Math.max(1, Math.round(scale));
    this.dirty = true;
  }

  setDualPrint(enabled: boolean): void {
    this.options.dualPrint = enabled;
    this.dirty = true;
  }

  /**
   * Flip between white-on-black and paper-tape black-on-white.
   *
   * Intensity is baked into the ring buffer at write time, so the history
   * already on screen has to be inverted too — otherwise toggling flips the
   * background and every newly arriving column while leaving everything
   * received so far in the old polarity.
   */
  setInverse(enabled: boolean): void {
    if (enabled === this.options.inverse) return;
    this.options.inverse = enabled;
    this.invertBuffer();
    this.dirty = true;
  }

  /** One-off pass over the ring buffer (~28k pixels); not a per-frame cost. */
  private invertBuffer(): void {
    const image = this.bufferCtx.getImageData(0, 0, this.buffer.width, this.buffer.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
      // Alpha (i + 3) is left alone.
    }
    this.bufferCtx.putImageData(image, 0, 0);
  }

  get inverse(): boolean {
    return this.options.inverse;
  }

  get scale(): number {
    return this.options.scale;
  }

  clear(): void {
    this.bufferCtx.fillStyle = this.options.inverse ? '#ffffff' : '#000000';
    this.bufferCtx.fillRect(0, 0, this.buffer.width, this.buffer.height);
    this.pending.length = 0;
    this.dirty = true;
  }

  /** Seconds of history currently visible, for the UI. */
  visibleSeconds(): number {
    const cols = Math.ceil((this.canvas.clientWidth || this.canvas.width) / this.options.scale);
    return (cols * this.mode.rows) / this.mode.baud;
  }
}
