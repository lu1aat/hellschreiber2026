/**
 * Hellschreiber mode definitions.
 *
 * Single source of truth for every rate and dimension in the app. Nothing else
 * may hardcode 122.5, 7, or 2.5 — adding the slow and FSK variants later depends
 * on this staying honest.
 *
 * Reference: https://en.wikipedia.org/wiki/Hellschreiber
 *            https://www.qsl.net/zl1bpu/HELL/Feld.htm  (ZL1BPU, definitive)
 */

export interface HellMode {
  readonly id: string;
  readonly name: string;
  /** Pixel rate in baud. Feld Hell is 122.5 for a 7x7 matrix. */
  readonly baud: number;
  /** Glyph matrix width in pixels. */
  readonly cols: number;
  /** Glyph matrix height in pixels. */
  readonly rows: number;
  /**
   * Transmit each pixel as two vertically stacked half-height dots. This is
   * what the original Feldfernschreiber did to smooth diagonals on paper tape,
   * and it doubles the element rate without changing the pixel rate.
   */
  readonly halfPixel: boolean;
  /** Nominal occupied bandwidth, Hz. Informational (drives the default RX width). */
  readonly bandwidthHz: number;
}

export const FELD_HELL: HellMode = {
  id: 'feld-hell',
  name: 'Feld Hell',
  baud: 122.5,
  cols: 7,
  rows: 7,
  halfPixel: true,
  bandwidthHz: 350,
};

/**
 * The original press-service variant: identical geometry, twice the speed
 * (245 baud => 5 characters/second). Rare on the air today.
 */
export const F_HELL: HellMode = {
  ...FELD_HELL,
  id: 'f-hell',
  name: 'F-Hell (press)',
  baud: 245,
  bandwidthHz: 700,
};

export const MODES: readonly HellMode[] = [FELD_HELL, F_HELL];

export const DEFAULT_MODE = FELD_HELL;

// --- Derived timing -------------------------------------------------------
// All of these are functions of the mode, never constants. Deriving them in one
// place is what keeps TX and RX agreeing about how wide a character is.

/** Pixels in one character cell (49 for Feld Hell). */
export const pixelsPerChar = (m: HellMode): number => m.cols * m.rows;

/** Characters per second. 122.5 / 49 = 2.5 exactly. */
export const charsPerSecond = (m: HellMode): number => m.baud / pixelsPerChar(m);

/** Characters per minute (150) and words per minute (25, at 5 chars + space). */
export const charsPerMinute = (m: HellMode): number => charsPerSecond(m) * 60;
export const wordsPerMinute = (m: HellMode): number => charsPerMinute(m) / 6;

/** Duration of one full pixel, seconds. 1/122.5 = 8.163 ms. */
export const pixelDurationSec = (m: HellMode): number => 1 / m.baud;

/** Transmitted elements per pixel: 2 when half-height dots are used. */
export const dotsPerPixel = (m: HellMode): number => (m.halfPixel ? 2 : 1);

/** Element (dot) rate in Hz. 245 for Feld Hell's half-height dots. */
export const dotRate = (m: HellMode): number => m.baud * dotsPerPixel(m);

/** Duration of one transmitted element, seconds. 4.08 ms for Feld Hell. */
export const dotDurationSec = (m: HellMode): number => 1 / dotRate(m);

/** Elements in one column: rows * dotsPerPixel = 14 for Feld Hell. */
export const dotsPerColumn = (m: HellMode): number => m.rows * dotsPerPixel(m);

/** Elements in one character cell: 98 for Feld Hell. */
export const dotsPerChar = (m: HellMode): number => m.cols * dotsPerColumn(m);

/** Duration of one character, seconds (0.4 s for Feld Hell). */
export const charDurationSec = (m: HellMode): number => 1 / charsPerSecond(m);
