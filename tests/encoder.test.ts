import { describe, expect, it } from 'vitest';

import { encodeText, estimateDurationSec } from '../src/hell/encoder';
import { glyphFor, hasGlyph } from '../src/hell/font';
import {
  FELD_HELL,
  charDurationSec,
  charsPerMinute,
  charsPerSecond,
  dotRate,
  dotsPerChar,
  pixelsPerChar,
  wordsPerMinute,
} from '../src/hell/modes';
import { elementsToRaster, getPixel, rasterToElements, rasterToText } from '../src/hell/raster';

const mode = FELD_HELL;

describe('Feld Hell timing', () => {
  // These are the published on-air numbers. If a refactor changes any of them,
  // the app is no longer interoperable and the test should fail loudly.
  it('matches the published specification', () => {
    expect(mode.baud).toBe(122.5);
    expect(pixelsPerChar(mode)).toBe(49);
    expect(charsPerSecond(mode)).toBe(2.5);
    expect(charsPerMinute(mode)).toBe(150);
    expect(wordsPerMinute(mode)).toBe(25);
    expect(charDurationSec(mode)).toBeCloseTo(0.4, 6);
  });

  it('derives half-height dot rates', () => {
    expect(dotRate(mode)).toBe(245);
    expect(dotsPerChar(mode)).toBe(98);
    // Wikipedia notes a minimum on-signal of ~8 ms; that is one full pixel.
    expect(1000 / mode.baud).toBeCloseTo(8.163, 3);
  });
});

describe('font', () => {
  it('places glyphs in a padded cell', () => {
    const glyph = glyphFor('A', mode);
    expect(glyph.length).toBe(mode.cols);
    // Column 0 and the last column are spacing, so adjacent characters never touch.
    expect(glyph[0]).toBe(0);
    expect(glyph[mode.cols - 1]).toBe(0);
    expect(glyph.some((column) => column !== 0)).toBe(true);
  });

  it('folds case', () => {
    expect(Array.from(glyphFor('a', mode))).toEqual(Array.from(glyphFor('A', mode)));
  });

  it('substitutes a visible placeholder for unknown characters', () => {
    expect(hasGlyph('€')).toBe(false);
    expect(Array.from(glyphFor('€', mode))).toEqual(Array.from(glyphFor('?', mode)));
  });

  it('renders a recognisable letter', () => {
    // Bottom row of 'L' is its full-width foot; the top row is a single stem.
    const raster = encodeText('L', mode, { leadingBlankCols: 0, trailingBlankCols: 0 });
    const bottomRow = Array.from({ length: mode.cols }, (_, col) => getPixel(raster, col, 6));
    expect(bottomRow).toEqual([0, 255, 255, 255, 255, 255, 0]);
  });
});

describe('encoder', () => {
  it('produces one cell per character plus padding', () => {
    const raster = encodeText('CQ', mode, { leadingBlankCols: 2, trailingBlankCols: 3 });
    expect(raster.cols).toBe(2 + 2 * mode.cols + 3);
    expect(raster.rows).toBe(mode.rows);
  });

  it('leaves blank padding blank', () => {
    const raster = encodeText('X', mode, { leadingBlankCols: 2, trailingBlankCols: 2 });
    for (const col of [0, 1, raster.cols - 2, raster.cols - 1]) {
      for (let row = 0; row < raster.rows; row++) {
        expect(getPixel(raster, col, row)).toBe(0);
      }
    }
  });

  it('estimates duration consistently with the raster', () => {
    const text = 'CQ CQ DE N0CALL';
    const raster = encodeText(text, mode);
    const expected = (raster.cols * raster.rows) / mode.baud;
    expect(estimateDurationSec(text, mode)).toBeCloseTo(expected, 9);
  });

  it('sends a bare character in 0.4 seconds', () => {
    expect(estimateDurationSec('A', mode, { leadingBlankCols: 0, trailingBlankCols: 0 })).toBeCloseTo(
      0.4,
      9,
    );
  });
});

describe('raster element ordering', () => {
  it('round-trips through the element sequence', () => {
    const raster = encodeText('HELL', mode);
    const elements = rasterToElements(raster, 2);
    expect(elements.length).toBe(raster.cols * raster.rows * 2);

    const restored = elementsToRaster(elements, mode.rows, 2);
    expect(rasterToText(restored)).toBe(rasterToText(raster));
  });

  it('emits columns left to right and rows top to bottom', () => {
    const raster = encodeText('T', mode, { leadingBlankCols: 0, trailingBlankCols: 0 });
    const elements = rasterToElements(raster, 2);

    // 'T' has a full top bar, so the first element of every glyph column
    // (its top row) is lit except in the two spacing columns.
    const perColumn = mode.rows * 2;
    const topOfColumn = (col: number): number => elements[col * perColumn];
    expect(topOfColumn(0)).toBe(0);
    expect(topOfColumn(1)).toBe(255);
    expect(topOfColumn(5)).toBe(255);
    expect(topOfColumn(6)).toBe(0);
  });
});
