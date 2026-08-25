/**
 * The raster is the common currency between TX and RX.
 *
 * A raster is a sequence of columns; each column is `rows` pixels tall, stored
 * as intensity bytes (0..255) rather than bits. TX only ever produces 0 or 255,
 * but RX produces the full range and *must* keep it — Hell is a fuzzy mode and
 * the greyscale is the information the operator reads. See CLAUDE.md.
 */

import type { HellMode } from './modes';

export interface Raster {
  /** Column-major intensities, length = cols * rows. */
  readonly data: Uint8Array;
  /** Number of columns. */
  readonly cols: number;
  /** Pixels per column. */
  readonly rows: number;
}

export function createRaster(cols: number, rows: number): Raster {
  return { data: new Uint8Array(cols * rows), cols, rows };
}

export function getPixel(r: Raster, col: number, row: number): number {
  return r.data[col * r.rows + row];
}

export function setPixel(r: Raster, col: number, row: number, value: number): void {
  r.data[col * r.rows + row] = value;
}

/** Expand a column bitmask (bit N = row N) into full-intensity pixels. */
export function columnFromBits(bits: number, rows: number, out: Uint8Array, offset = 0): void {
  for (let row = 0; row < rows; row++) {
    out[offset + row] = bits & (1 << row) ? 255 : 0;
  }
}

/**
 * Where an element lands within its column, as a half-dot row counted from the
 * top (0 = topmost dot, `dotsPerColumn - 1` = bottom).
 *
 * Feld Hell scans each column from the *bottom up*: the first element of a
 * column is the bottom dot, not the top one. This is the one place that knows
 * it — `rasterToElements` transmits in this order and `HellStrip` paints
 * arriving elements with it, without building a `Raster` first. Get it backwards
 * and every character prints upside down, which a loopback test cannot see
 * (both ends agree with each other) and which is obvious the moment you decode
 * anybody else.
 *
 * Verified against off-air recordings of other stations: with element 0 painted
 * at the top, 'T' and 'F' come out with their bars at the bottom.
 */
export function rowForElement(elementInColumn: number, dotsPerColumn: number): number {
  return dotsPerColumn - 1 - elementInColumn;
}

/**
 * Flatten a raster into the transmit element sequence: columns left to right,
 * and within each column bottom to top, with every pixel repeated
 * `dotsPerPixel` times for half-height dot modes.
 *
 * This function defines the on-air element order for the whole project. If the
 * text ever comes out mirrored or upside down, this is the place to look.
 */
export function rasterToElements(r: Raster, dotsPerPixel: number): Uint8Array {
  const out = new Uint8Array(r.cols * r.rows * dotsPerPixel);
  let i = 0;
  for (let col = 0; col < r.cols; col++) {
    for (let row = r.rows - 1; row >= 0; row--) {
      const value = getPixel(r, col, row);
      for (let d = 0; d < dotsPerPixel; d++) {
        out[i++] = value;
      }
    }
  }
  return out;
}

/**
 * Inverse of `rasterToElements`, averaging the half-height dots back into
 * pixels. Used by the loopback test; the live display renders half-dot rows
 * directly so it never needs this.
 */
export function elementsToRaster(
  elements: Uint8Array,
  rows: number,
  dotsPerPixel: number,
): Raster {
  const perColumn = rows * dotsPerPixel;
  const cols = Math.floor(elements.length / perColumn);
  const r = createRaster(cols, rows);
  for (let col = 0; col < cols; col++) {
    for (let e = 0; e < perColumn; e += dotsPerPixel) {
      let sum = 0;
      for (let d = 0; d < dotsPerPixel; d++) {
        sum += elements[col * perColumn + e + d];
      }
      // The group's dots are adjacent half-rows; the last of them is the top one.
      const topHalfRow = rowForElement(e + dotsPerPixel - 1, perColumn);
      setPixel(r, col, Math.floor(topHalfRow / dotsPerPixel), Math.round(sum / dotsPerPixel));
    }
  }
  return r;
}

/** Render a raster as ASCII art. Debugging and test failure messages only. */
export function rasterToText(r: Raster, threshold = 128): string {
  const lines: string[] = [];
  for (let row = 0; row < r.rows; row++) {
    let line = '';
    for (let col = 0; col < r.cols; col++) {
      line += getPixel(r, col, row) >= threshold ? '#' : '.';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Total on-air duration of a raster, seconds. */
export function rasterDurationSec(r: Raster, mode: HellMode): number {
  return (r.cols * r.rows) / mode.baud;
}
