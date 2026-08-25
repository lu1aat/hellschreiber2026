# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-only Hellschreiber (Feld Hell) transmit/receive terminal for amateur
radio. Read `README.md` first — it has the mode specs, the architecture diagram,
and the file layout, and this file does not repeat them.

## Commands

```bash
npm run dev                                   # vite dev server on :5173
npm run build                                 # tsc --noEmit && vite build -> dist/
npm run preview                               # serve the built bundle
npm run typecheck
npm run test                                  # vitest run (33: 14 encoder, 10 loopback, 5 ramp, 4 align)
npm run test:watch
npx vitest run tests/loopback.test.ts         # one file
npx vitest run tests/loopback.test.ts -t "survives noise"   # one test
./web.sh                                      # build if needed + serve dist/ via PHP on :8080
```

There is **no linter or formatter** — `tsc` is the style gate. `strict`,
`noUnusedLocals` and `noUnusedParameters` are on, so a leftover import or an
unused parameter fails `npm run build`. Match the surrounding style by hand.

Vitest runs in the default **node** environment; there is no vitest config and
no jsdom. Anything under `src/render/`, `src/ui/` or `src/audio/` is therefore
untestable as written, which is exactly why the DSP cores are DOM-free classes.

## Hard constraints

These are the project's reason for existing. Do not violate them, and do not
propose changes that require violating them.

1. **No backend, ever.** No API routes, no server-side rendering, no serverless
   functions, no database. `npm run build` must produce a `dist/` that works from
   a file server, a USB stick, or GitHub Pages with nothing behind it.
   - `web.sh` and `router.php` are *not* an exception. PHP there is a static
     file server for local hosting, chosen because it is already installed on
     most shack machines. `router.php` sets MIME types and serves bytes off
     disk; it must never grow application logic, state, or an endpoint.
2. **No runtime network requests.** No CDN scripts, no fonts, no analytics, no
   telemetry, no error reporting. Everything ships in the bundle. Operators use
   this at field days and in shacks with no internet; a fetch on the critical
   path is a bug, not a feature. The CSP in `router.php` enforces this — if a
   change trips the CSP, the change is wrong, not the CSP.
3. **No audio leaves the machine.** Microphone input is processed locally and
   discarded. There is no upload path, and there must never be one. `localStorage`
   holds UI settings only.
4. **The decoder does not decode characters.** Hell is a fuzzy mode: the RX chain
   recovers dot intensity and paints it. No thresholding to pure black/white, no
   OCR, no template matching, no "cleanup" filters, no ML. The operator's eye is
   the decoder. If a change makes the display prettier by discarding intensity
   information, it is wrong. This surprises people — flag it explicitly if a
   request implies character-level decode.

## Stack

- TypeScript, strict mode
- Vite (build + dev server)
- Web Audio API, `AudioWorklet` for all DSP
- Canvas 2D for the RX strip and the tuning display
- Vitest for tests
- **No UI framework.** The app is a handful of controls plus two canvases;
  React/Vue would be more machinery than the whole app. Don't add one.
- No DSP dependencies — the filters here are ~50 lines each and vendoring them
  keeps the bundle small and the math inspectable.

## Architecture notes that span files

The README diagram covers the audio graph. These are the couplings you only see
by reading several files at once:

- **`main.ts` is wiring only.** DOM lookups, the `Settings` object persisted to
  `localStorage` under `hellschreiber2026:settings`, and one
  `requestAnimationFrame` loop that calls `strip.render()` and
  `tuning.render(engine.getSpectrum(), engine.sampleRate)`. Logic belongs in
  `hell/`, `dsp/` or `render/`; if `main.ts` grows a computation, it is in the
  wrong file.

- **The `HellMode` object crosses a `postMessage` boundary.** `engine.ts` passes
  it through `processorOptions`, so it is structured-cloned into the worklet.
  That is why every derived value in `hell/modes.ts` is a free function
  (`dotRate(mode)`) and never a method — methods would not survive the clone.
  Keep `HellMode` a plain readonly data object.

- **Worklet message protocol** (the only channel between UI and audio threads):

  | Direction | Node | Messages |
  |---|---|---|
  | UI → worklet | `hell-rx` | `{type:'config', centerFreqHz?, bandwidthHz?, clockPpm?}`, `{type:'reset'}` |
  | worklet → UI | `hell-rx` | `{type:'elements', elements}` (batches of 12), `{type:'snr', db}` (~every 100 blocks) |
  | UI → worklet | `hell-tx` | `{type:'send', raster}`, `{type:'stop'}`, `{type:'config', freqHz?, amplitude?}` |
  | worklet → UI | `hell-tx` | `{type:'progress', value}` (~10/s), `{type:'done'}` |

  Adding a control means touching `engine.ts`, the worklet's message union, and
  the core class — in that order.

- **TX follows RX.** `engine.setCenterFrequency` retunes both nodes from one
  call; both stations in a Hell QSO sit on the same audio tone, and separate
  controls only invite mistakes. Don't split them.

- **The raster is the common currency.** `Raster` (`hell/raster.ts`) is
  column-major intensity bytes, 0..255 — not bits, because RX needs the full
  greyscale. `rasterToElements` defines the on-air element order for the whole
  project; mirrored or upside-down text is a bug in that one function.
  - Columns go left to right, but **each column is scanned bottom dot first** —
    `rowForElement` in the same file is the single definition of that, used by
    `rasterToElements` on TX and by `HellStrip.writeColumn` on RX. Reversing it
    prints every character upside down while the loopback test stays green,
    because both ends flip together. The only check that catches it is decoding
    a signal we did not generate — an off-air recording of another station.

- **`render/tuning-display.ts` is spectrum *and* waterfall on one canvas**, by
  design: shared frequency axis, one passband overlay, click anywhere to tune.
  It is the largest file in the repo and owns all of its own hit-testing. Don't
  split it into two components — the shared overlay and single hit-test region
  are the point.
  - The waterfall ring buffer writes rows *backwards* (`writeRow` decrements) so
    the newest row can be blitted at the top in one pass. Its history canvas is
    a fixed 512×256 that gets scaled on blit, so resizing never discards history.
  - Its colour ramp is a **sequential** encoding and must keep rising in
    lightness; `tests/waterfall-ramp.test.ts` enforces this via the stronger
    invariant that no channel ever decreases between stops. A ramp that dips
    mid-range draws an edge the signal does not have.

- **`HellStrip` bakes intensity into a ring buffer at write time.** Hence
  `setInverse` repaints the history — a change that only flips new columns
  leaves the strip in two polarities at once. `setPhase` has the same duty and
  rolls the buffer for the same reason.

- **Print sync is split across `hell/align.ts` and `HellStrip`.** The estimator
  is pure and testable; the strip owns an instance because both have to count
  the same elements from the same origin for a lane position to mean the same
  thing to each. That is why `clear()` resets the partial column but leaves
  `streamPos` and the tracker alone, and why the strip assigns elements by
  `(streamPos - phase) % lanes` rather than filling a column and resetting a
  counter — the latter cannot express a phase change without dropping elements.
  - It is not a decoder and does not breach constraint 4. It measures average
    energy per lane position to find the blank rows every Hell font leaves, and
    decides *where on the canvas* to draw. No intensity is altered.
  - It depends on the sender padding the cell. A font that inks all seven rows
    scores near zero confidence and the tracker holds still, which is the right
    answer — there is no gap to find. Hence the font test in
    `tests/encoder.test.ts` that keeps *our* transmissions padded.

## The numbers

Get these wrong and the app is not interoperable. They are asserted in
`tests/encoder.test.ts` so a refactor cannot quietly change them.

- Feld Hell is **122.5 baud**, a 7×7 pixel matrix, 2.5 char/s (150 CPM, 25 WPM).
- **245 baud is not Feld Hell's baud rate.** It is F-Hell, the press variant at
  5 char/s. 245 *also* appears legitimately as Feld Hell's *element* rate,
  because each pixel is sent as two half-height dots — but the mode's baud
  figure is 122.5. Sources online conflate these constantly; `src/hell/modes.ts`
  derives everything from `baud` so the distinction stays straight.
- One pixel is 8.163 ms, which is where the "~8 ms minimum on-signal" in the
  literature comes from.

## DSP conventions

**Worklet code runs on the audio thread.** In `process()`:

- No allocation. Preallocate buffers in the constructor and reuse them. A GC
  pause in the audio thread is an audible dropout and, on TX, a corrupted
  character on someone else's screen.
- No `console.log` in the hot path (it allocates and can block).
- Talk to the UI thread via `postMessage` in batches — one message per render
  frame's worth of elements, not one per element (which is 245/second of pure
  overhead).
- `process()` must return `true` permanently. Returning `false` kills the
  processor for the session; both nodes here idle waiting for messages.

**Keep the worklets thin.** All real DSP lives in plain classes
(`src/dsp/tone-generator.ts`, `src/dsp/demodulator.ts`) so the loopback test can
run it in Node. The worklet files are message plumbing and nothing else. Do not
move logic into them, and do not let a core class import anything from the DOM
or `AudioWorkletGlobalScope` — that is what makes them testable.

**Output buffers are caller-owned.** `HellDemodulator.process(input, out)` writes
into a buffer the caller preallocated and returns a count; `HellToneGenerator.fill(out)`
always fills completely, with silence when idle. Keep that shape for new cores.

**Never assume 48 kHz.** Derive every rate from the live `sampleRate`. Sound
cards report 44100, 48000, and occasionally 96000; hardcoding a rate produces
text that decodes at the wrong width. The loopback test runs all three.

**Timing lives in the worklet, by sample counting.** Elements are ~4.08 ms.
`setTimeout` and `requestAnimationFrame` cannot hold that under load. Anything
that schedules audio events from the UI thread is wrong.

**Mode parameters come from `src/hell/modes.ts`.** Do not inline 122.5, 245, 7,
or 2.5 anywhere else — the planned Slowfeld and FSK-Hell variants depend on this
staying honest.

**Continuous phase on TX.** The oscillator's phase must run continuously across
element boundaries; resetting it per dot generates broadband clicks. Gate
amplitude with the raised-cosine envelope, never a hard switch. A test asserts
the maximum sample-to-sample step stays near the carrier's own slew rate.

## Code conventions

- Pure functions in `src/hell/` (modes, font, encoder, raster). No Web Audio, no
  DOM — this is the part that is cheap to test, so keep it that way.
- Worklets in `src/dsp/worklets/` are the only files that may reference
  `AudioWorkletProcessor`, `registerProcessor`, or the ambient `sampleRate`
  (declared in `src/vite-env.d.ts`).
- Rendering in `src/render/` owns canvas state; nothing else touches a 2D context.
- Explicit units in names: `dotDurationSec`, `centerFreqHz`, `bandwidthHz`. Bare
  numbers with ambiguous units cause real bugs in this codebase.
- Comment the *why* for DSP choices (filter cutoffs, AGC time constants, envelope
  shape). The *what* is readable from the code; the reasoning is not.

## Testing

Add a **loopback test** for any change to the encoder, the DSP cores, or timing.
Unit tests on pure functions will pass happily while the end-to-end signal is a
slanted, half-width mess. The loopback is what catches:

- sample-rate assumptions
- column alignment / off-by-one in the 7×14 element cell
- clock drift handling (slanted text)
- envelope shaping regressions

Two things the loopback test does deliberately, keep them: it seeds its own PRNG
(a flaky DSP test is worse than no DSP test), and it scores agreement over a
small **alignment offset** search, because the receive filter has real group
delay. Do not "fix" that offset by making the filters zero-delay.

## Verifying UI changes

The strip and tuning display are visual; a passing suite says little about
whether the display is right. The fastest check needs no radio:

1. `npm run dev`, open `localhost:5173`, press **Start audio**
2. tick **Loopback monitor**
3. type something and press Enter

Text should appear on the strip: upright, evenly spaced, readable, printed twice
one above the other, with a clear blank gap between the two copies. The strip is
paper-tape black-on-white by default; press **Invert** to check the other
polarity. In white-on-black the background should be dark grey rather than pure
black — pure black means the intensity mapping has clipped and weak dots are
being thrown away.

## Gotchas

Every one of these has already cost time here.

- **`getUserMedia` requires a secure context.** `localhost` works; a LAN IP over
  plain `http://` silently yields no input. This is the most common "the decoder
  is broken" report and is not a decoder bug. `web.sh` warns when bound to a
  non-localhost address.
- **Browsers suspend `AudioContext` until a user gesture.** Hence the explicit
  Start audio button. Don't try to auto-start on load.
- **Chrome applies echo cancellation, noise suppression and AGC to mic streams by
  default.** All three mangle Hell audio — the symptom of forgetting is a decode
  that fades out on long tones. They are explicitly disabled in
  `engine.ts:setInputDevice`; keep them that way.
- **Device labels are empty before permission is granted.** Populate the pickers
  *after* `getUserMedia` resolves, or the operator gets a list of blanks.
- **Output device selection is Chromium-only** (`AudioContext.setSinkId`).
  `ui/devices.ts:supportsOutputSelection` gates it; elsewhere the picker is
  disabled rather than broken.
- **Worklets are loaded via `?worker&url`** (`import url from './x.worklet.ts?worker&url'`).
  Vite emits each as a self-contained chunk with no imports, which is what
  `addModule()` needs. Plain `?url` would ship untranspiled TypeScript.
- **AudioWorklet is strict about MIME types.** A worklet chunk served as
  `text/plain` fails to load with an error that does not point at the server.
  That is the reason `router.php` exists.
- **`getFloatFrequencyData` needs `Float32Array<ArrayBuffer>`.** Annotating the
  field as plain `: Float32Array` widens it to `ArrayBufferLike` and fails to
  compile on TS 5.7+. Let the initializer infer it.
- **Port 8080 is often already taken.** `web.sh` detects this before printing its
  banner and walks forward to the next free port.

## Amateur radio context

Users are licensed operators. Assume domain knowledge — USB, QSB, RST, calling
frequencies, VOX need no explanation in the UI. What does need care: anything
affecting the transmitted signal (bandwidth, timing, spurious emissions) has
consequences for other operators on a shared band. Treat envelope shaping and
timing accuracy as correctness requirements, not polish.

The app targets everything from a bare laptop sound card to a truSDX or a
single-transistor 7 MHz CW rig, so never assume a particular interface, a
particular sample rate, or that any rig control exists.

The app produces audio only and does not key a transmitter. Don't add direct rig
control (CAT/PTT) without discussing it — it would mean serial/WebUSB access and
a much larger permission and safety surface.
