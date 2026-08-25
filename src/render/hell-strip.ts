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

import { PhaseTracker } from '../hell/align';
import type { HellMode } from '../hell/modes';
import { dotsPerColumn } from '../hell/modes';
import { rowForElement } from '../hell/raster';

export interface HellStripOptions {
  /** Columns of history kept in the ring buffer. */
  bufferCols?: number;
  /** Device pixels per raster pixel. */
  scale?: number;
  /** Draw the second, offset copy of the strip. */
  dualPrint?: boolean;
  /** Black-on-white, like paper tape, instead of white-on-black. */
  inverse?: boolean;
  /** Where in the lane the picture sits, 0..dotsPerColumn-1. */
  phase?: number;
  /** Let the incoming signal choose `phase` — see hell/align.ts. */
  autoAlign?: boolean;
}

const DEFAULTS: Required<HellStripOptions> = {
  bufferCols: 2048,
  scale: 3,
  // Paper tape, like the original Feldfernschreiber and like fldigi's Hell
  // window, which builds its buffer white and draws received ink into it.
  dualPrint: true,
  inverse: true,
  phase: 0,
  autoAlign: true,
};

export class HellStrip {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private readonly columnImage: ImageData;
  private readonly rowsPerColumn: number;

  /**
   * The column being filled, indexed by lane slot rather than arrival order, so
   * that changing `phase` mid-column simply redirects the next element.
   */
  private readonly column: Uint8Array;
  /** Elements seen since construction; the origin all lane positions count from. */
  private streamPos = 0;
  private writeIndex = 0;
  private options: Required<HellStripOptions>;
  private dirty = true;

  /**
   * Lives here rather than in main.ts so that it and the display cannot drift
   * apart: both have to count the same elements from the same origin for a lane
   * position to mean the same thing to both.
   */
  private readonly tracker: PhaseTracker;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mode: HellMode,
    options: HellStripOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.rowsPerColumn = dotsPerColumn(mode);
    this.column = new Uint8Array(this.rowsPerColumn);
    this.tracker = new PhaseTracker(mode);
    this.options.phase = this.wrapPhase(this.options.phase);
    this.tracker.phase = this.options.phase;

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
   *
   * Which slot an element lands in is `(streamPos - phase)`, not a running
   * count reset at every column, so moving `phase` moves the whole picture
   * without losing or duplicating an element.
   */
  pushElements(elements: Uint8Array): void {
    this.tracker.push(elements);

    for (let i = 0; i < elements.length; i++) {
      const slot = this.slotFor(this.streamPos);
      this.column[slot] = elements[i];
      this.streamPos++;
      if (slot === this.rowsPerColumn - 1) this.writeColumn();
    }

    if (this.options.autoAlign) this.setPhase(this.tracker.track());
  }

  private slotFor(streamPos: number): number {
    const lanes = this.rowsPerColumn;
    return (((streamPos - this.options.phase) % lanes) + lanes) % lanes;
  }

  private writeColumn(): void {
    const data = this.columnImage.data;
    for (let i = 0; i < this.rowsPerColumn; i++) {
      // Elements arrive bottom dot first — see rowForElement.
      const row = rowForElement(i, this.rowsPerColumn);
      const value = this.options.inverse ? 255 - this.column[i] : this.column[i];
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

    // No divider between the copies, deliberately. The receiver has no vertical
    // sync, so a character lands at whatever row phase the element clock gives
    // us; when that phase is near the middle the *whole* character straddles the
    // join, with its top half in the lower copy and its bottom half in the upper
    // one. That is the join doing its job — but a rule drawn across it lands
    // through the middle of the text and overwrites a row of real intensity.
    // fldigi's Raster widget puts its `space` between page rows, never inside a
    // dual print, for the same reason.
  }

  private wrapPhase(phase: number): number {
    const lanes = this.rowsPerColumn;
    return (((Math.round(phase) % lanes) + lanes) % lanes);
  }

  /**
   * Slide the picture within the print lane. Raising `phase` by one moves
   * everything down one half-dot row; a full lap of `rowsPerColumn` returns the
   * same picture one column to the left, which is a seventh of a character and
   * not worth worrying about.
   *
   * The history already on the canvas moves with it. A control that only
   * affected new columns would leave the strip showing the same text at two
   * different heights, the same trap `setInverse` has with polarity.
   */
  setPhase(phase: number): void {
    const next = this.wrapPhase(phase);
    if (next === this.options.phase) return;

    const delta = (next - this.options.phase + this.rowsPerColumn) % this.rowsPerColumn;
    this.options.phase = next;
    this.tracker.phase = next;
    this.rollBuffer(delta);
    this.dirty = true;
  }

  /**
   * Move everything already drawn down by `delta` rows.
   *
   * The rows pushed off the bottom of a column reappear at the top of the one
   * to its left, because that is where those elements belong once the lane
   * boundary moves: the raster is one continuous stream wrapped every
   * `rowsPerColumn` elements, not a row of independent columns.
   */
  private rollBuffer(delta: number): void {
    const width = this.options.bufferCols;
    const lanes = this.rowsPerColumn;

    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = lanes;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) return;
    scratchCtx.drawImage(this.buffer, 0, 0);

    this.bufferCtx.drawImage(
      scratch,
      0, 0, width, lanes - delta,
      0, delta, width, lanes - delta,
    );
    // The wrapped rows come from the next column along. Ring index 0 follows
    // the last column here, which is right everywhere except at the write head,
    // where one column's top rows are a buffer-length out of date until the
    // strip scrolls past them.
    this.bufferCtx.drawImage(
      scratch,
      1, lanes - delta, width - 1, delta,
      0, 0, width - 1, delta,
    );
    this.bufferCtx.drawImage(
      scratch,
      0, lanes - delta, 1, delta,
      width - 1, 0, 1, delta,
    );
  }

  /** Let the signal choose the phase, or leave it where the operator put it. */
  setAutoAlign(enabled: boolean): void {
    this.options.autoAlign = enabled;
  }

  get phase(): number {
    return this.options.phase;
  }

  get autoAlign(): boolean {
    return this.options.autoAlign;
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
    // Only the partly-filled column goes; streamPos and the tracker carry on,
    // because wiping the screen is not a reason to lose the print sync.
    this.column.fill(0);
    this.dirty = true;
  }

  /** Seconds of history currently visible, for the UI. */
  visibleSeconds(): number {
    const cols = Math.ceil((this.canvas.clientWidth || this.canvas.width) / this.options.scale);
    return (cols * this.mode.rows) / this.mode.baud;
  }
}
