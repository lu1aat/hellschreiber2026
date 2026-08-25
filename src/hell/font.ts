/**
 * Feld Hell font: 5x7 glyphs placed in a 7x7 cell (one blank column each side
 * for inter-character spacing).
 *
 * Glyphs are written as ASCII art — seven rows of five, '/'-separated, top row
 * first — because this is the part of the codebase most likely to need eyeball
 * corrections against a real machine's output, and a hex table cannot be
 * proofread. The cost is paid once at module load, in `buildGlyphTable`.
 *
 * Feld Hell is traditionally uppercase-only; lowercase input is folded up.
 */

import type { HellMode } from './modes';

const GLYPHS: Record<string, string> = {
  ' ': '...../...../...../...../...../...../.....',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '#####/...#./..#../...#./....#/#...#/.###.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  '.': '...../...../...../...../...../.##../.##..',
  ',': '...../...../...../...../.##../.##../.#...',
  ':': '...../.##../.##../...../.##../.##../.....',
  ';': '...../.##../.##../...../.##../.##../.#...',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '!': '..#../..#../..#../..#../..#../...../..#..',
  '/': '....#/....#/...#./..#../.#.../#..../#....',
  '-': '...../...../...../#####/...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  '=': '...../...../#####/...../#####/...../.....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  "'": '..#../..#../...../...../...../...../.....',
  '"': '.#.#./.#.#./...../...../...../...../.....',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
  '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  $: '..#../.####/#.#../.###./..#.#/####./..#..',
  '%': '##..#/##..#/...#./..#../.#.../#..##/#..##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  '*': '...../#.#.#/.###./#####/.###./#.#.#/.....',
  '<': '...#./..#../.#.../#..../.#.../..#../...#.',
  '>': '.#.../..#../...#./....#/...#./..#../.#...',
  '_': '...../...../...../...../...../...../#####',
};

/** Glyph width in the ASCII-art table above. The cell is wider (see PAD). */
const ART_COLS = 5;
const ART_ROWS = 7;
/** Blank columns inserted left of the glyph inside the 7-wide cell. */
const PAD_LEFT = 1;

/** Character substituted for anything not in the table. */
const FALLBACK = '?';

/**
 * A glyph as column bitmasks: one entry per cell column, bit N set = pixel lit
 * in row N, counting from the top. Column-major because that is the order Hell
 * transmits in, so the encoder never has to transpose.
 */
export type Glyph = Uint8Array;

function buildGlyphTable(mode: HellMode): Map<string, Glyph> {
  const table = new Map<string, Glyph>();

  for (const [char, art] of Object.entries(GLYPHS)) {
    const rows = art.split('/');
    if (rows.length !== ART_ROWS) {
      throw new Error(`Glyph "${char}": expected ${ART_ROWS} rows, got ${rows.length}`);
    }

    const glyph = new Uint8Array(mode.cols);
    for (let row = 0; row < ART_ROWS; row++) {
      const line = rows[row];
      if (line.length !== ART_COLS) {
        throw new Error(`Glyph "${char}" row ${row}: expected ${ART_COLS} cols, got ${line.length}`);
      }
      for (let col = 0; col < ART_COLS; col++) {
        if (line[col] !== '.') {
          glyph[col + PAD_LEFT] |= 1 << row;
        }
      }
    }
    table.set(char, glyph);
  }

  return table;
}

let cachedMode: HellMode | null = null;
let cachedTable: Map<string, Glyph> | null = null;

function glyphTable(mode: HellMode): Map<string, Glyph> {
  if (cachedMode !== mode || cachedTable === null) {
    cachedTable = buildGlyphTable(mode);
    cachedMode = mode;
  }
  return cachedTable;
}

/** Column bitmasks for one character. Unknown characters render as '?'. */
export function glyphFor(char: string, mode: HellMode): Glyph {
  const table = glyphTable(mode);
  const upper = char.toUpperCase();
  return table.get(upper) ?? table.get(FALLBACK)!;
}

/** True if the font has a glyph for this character (after case folding). */
export function hasGlyph(char: string): boolean {
  return Object.prototype.hasOwnProperty.call(GLYPHS, char.toUpperCase());
}

/** Every character the font can send, for the UI's help panel. */
export function supportedCharacters(): string {
  return Object.keys(GLYPHS).join('');
}
