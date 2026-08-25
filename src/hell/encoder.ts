/**
 * Text -> raster. Pure, synchronous, no audio. This is the cheap-to-test half
 * of the transmit path; everything with a sample rate lives in src/dsp.
 */

import { glyphFor } from './font';
import type { HellMode } from './modes';
import { columnFromBits, createRaster, type Raster } from './raster';

export interface EncodeOptions {
  /** Blank columns appended after the message, so the receiver's strip clears. */
  trailingBlankCols?: number;
  /** Blank columns prepended, giving the far end's clock a moment to settle. */
  leadingBlankCols?: number;
}

const DEFAULT_OPTIONS: Required<EncodeOptions> = {
  leadingBlankCols: 4,
  trailingBlankCols: 8,
};

/**
 * Encode a line of text into a raster.
 *
 * Characters outside the font are sent as '?' rather than dropped: silently
 * losing a character on a mode with no error detection is worse than sending a
 * visible placeholder the operator can see and correct.
 */
export function encodeText(text: string, mode: HellMode, options: EncodeOptions = {}): Raster {
  const { leadingBlankCols, trailingBlankCols } = { ...DEFAULT_OPTIONS, ...options };

  const chars = [...text];
  const cols = leadingBlankCols + chars.length * mode.cols + trailingBlankCols;
  const raster = createRaster(cols, mode.rows);

  let col = leadingBlankCols;
  for (const char of chars) {
    const glyph = glyphFor(char, mode);
    for (let g = 0; g < mode.cols; g++) {
      columnFromBits(glyph[g], mode.rows, raster.data, (col + g) * mode.rows);
    }
    col += mode.cols;
  }

  return raster;
}

/** Seconds a string will take to send, for the UI's TX time estimate. */
export function estimateDurationSec(text: string, mode: HellMode, options: EncodeOptions = {}): number {
  const { leadingBlankCols, trailingBlankCols } = { ...DEFAULT_OPTIONS, ...options };
  const cols = leadingBlankCols + [...text].length * mode.cols + trailingBlankCols;
  return (cols * mode.rows) / mode.baud;
}
