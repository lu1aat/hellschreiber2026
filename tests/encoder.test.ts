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
  dotsPerColumn,
  pixelsPerChar,
  wordsPerMinute,
} from '../src/hell/modes';
import {
  elementsToRaster,
  getPixel,
  rasterToElements,
  rasterToText,
  rowForElement,
} from '../src/hell/raster';

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
    // 'L' sits on the baseline, row 5, where its full-width foot is.
    const raster = encodeText('L', mode, { leadingBlankCols: 0, trailingBlankCols: 0 });
    const foot = Array.from({ length: mode.cols }, (_, col) => getPixel(raster, col, 5));
    expect(foot).toEqual([0, 255, 255, 255, 255, 255, 0]);
  });

  it('leaves a blank row above and below every letter and digit', () => {
    // The receiver has no vertical sync, so a cell inked to its top and bottom
    // edges butts into the copies above and below with no line to read along.
    // Every on-air font leaves this gap; fldigi's feld7x7_14 blanks the first
    // and last two of its fourteen half-rows, and off-air recordings of other
    // stations measure the same. Descenders (',' ';' '$' '_') are the exception.
    const body = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (const char of body) {
      const glyph = glyphFor(char, mode);
      for (let col = 0; col < mode.cols; col++) {
        expect(glyph[col] & (1 << 0), `${char} col ${col} top row`).toBe(0);
        expect(glyph[col] & (1 << (mode.rows - 1)), `${char} col ${col} bottom row`).toBe(0);
      }
    }
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

  it('emits columns left to right and rows bottom to top', () => {
    const raster = encodeText('T', mode, { leadingBlankCols: 0, trailingBlankCols: 0 });
    const elements = rasterToElements(raster, 2);
    const perColumn = mode.rows * 2;

    // Element e of a column paints at half-row perColumn - 1 - e, so pixel row
    // r is the pair of elements starting at perColumn - 1 - 2r.
    const pixel = (col: number, row: number): number =>
      elements[col * perColumn + perColumn - 1 - 2 * row];

    // Row 0 is the font's top padding and is blank right across the cell.
    for (let col = 0; col < mode.cols; col++) expect(pixel(col, 0)).toBe(0);

    // 'T' has a full bar on row 1 and a centred stem down to the baseline on
    // row 5, which pins the left-to-right and bottom-to-top order together.
    expect(pixel(0, 1)).toBe(0);
    expect(pixel(1, 1)).toBe(255);
    expect(pixel(5, 1)).toBe(255);
    expect(pixel(6, 1)).toBe(0);

    expect(pixel(1, 5)).toBe(0);
    expect(pixel(3, 5)).toBe(255);
    expect(pixel(5, 5)).toBe(0);
  });

  it('paints received elements bottom dot first', () => {
    // HellStrip needs a canvas and cannot run here, so pin the mapping it uses.
    // This is the receive half of the on-air convention above: reverse it and
    // every character prints upside down with the loopback still passing.
    const perColumn = dotsPerColumn(mode);
    expect(rowForElement(0, perColumn)).toBe(perColumn - 1);
    expect(rowForElement(perColumn - 1, perColumn)).toBe(0);
  });
});
