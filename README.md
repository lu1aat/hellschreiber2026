# hellschreiber2026

A browser-based Hellschreiber transmit/receive terminal for amateur radio. Runs
**100% in the browser** — no backend, no server, no account, no build step at
runtime. Open the page, point your rig's audio at it, and you're on the air.

Sound card in → decoded Hell text on screen. Type → shaped audio out → rig.

**[Live demo →](https://lu1aat.github.io/hellschreiber2026/)** (once Pages is
enabled — see [Hosting on GitHub Pages](#hosting-on-github-pages)). No install, no account;
load it once and it keeps working with the network off.

---

## What is Hellschreiber?

Hellschreiber ("Hell", after inventor Rudolf Hell, who developed it in the late
1920s) is a **facsimile** mode, not a character mode. The transmitter paints each
letter as a column-by-column raster of on/off dots; the receiver paints those
dots straight back onto a scrolling strip. There is no symbol alphabet, no error
correction, and **no character decoding on the receive side** — your eye does the
demodulation.

That is the whole trick, and it's why Hell survives conditions that break RTTY
and PSK31: noise and QSB corrupt individual dots, but a human reads a smeared,
speckled letter just fine. Modes like this are called *fuzzy modes*.

Practical consequence for this project: **the decoder must never try to guess
characters.** Its job is to recover dot intensity honestly and put it on the
canvas, including the ugly parts. Cleaning up the picture with thresholding or
pattern-matching destroys exactly the information the operator uses.

Background: [Hellschreiber on Wikipedia](https://en.wikipedia.org/wiki/Hellschreiber).

---

## Features

- **Feld Hell TX/RX** — the standard on-air mode (see [Mode specs](#mode-specs)).
- **Horizontally scrolling RX strip** — newest text at the right edge, printed
  twice one above the other, exactly as the original machines did. The double
  print is what keeps text readable when the two ends' clocks disagree slightly.
- **Spectrum + waterfall as one instrument** — a short spectrum band above a
  scrolling waterfall on a single canvas, sharing one frequency axis and one
  passband overlay. Click *either* to tune. Feld Hell shows up as a narrow
  ragged column flickering at the dot rate; the spectrum shows its instantaneous
  shape, the waterfall shows it persisting over ~10 seconds, which is what makes
  a weak signal findable in the first place.
- **Invert** — flip the RX strip between paper-tape black-on-white (the
  default, as on the original machine and in fldigi) and white-on-black,
  history included.
- **Adjustable receive width** — the width control is the real receive
  bandwidth, not a cosmetic overlay. Narrow rejects noise but smears dots; wide
  is crisper but noisier.
- **Print sync** — the receiver starts counting elements whenever you press
  Start, so the text lands at an arbitrary height in the lane and can straddle
  the join between the two print copies. **Auto sync** finds the sender's cell
  boundary from the blank rows every Hell font leaves, and **Align** is the
  manual phasing control for when you would rather place it yourself. Moving
  Align takes over from the automatic one.
- **Slant correction** — manual clock trim in ppm, for when the far end's sound
  card runs at a slightly different rate and the text drifts up or down.
- **Shaped keying** — raised-cosine dot envelopes keep the transmitted signal
  inside a courteous bandwidth instead of splattering across the band.
- **Loopback monitor** — route your own TX audio into the decoder and watch your
  text come back. Lets you exercise the whole chain with no radio attached.
- **Device selection** — pick any input and output device, so the app works with
  a bare laptop sound card or with a rig interface (truSDX, a simple 7 MHz CW
  transceiver, or a full-size radio with a sound card interface).
- **Zero install** — static files. No telemetry, no network requests at runtime,
  nothing leaves the machine.

### Planned

- Slowfeld (~3, 1.5, 0.75 char/s) for weak-signal work
- FSK-Hell / FM-Hell, most commonly FSK Hell-105
- PSK Hell (brightness encoded in carrier phase, 105 or 245 baud)
- Duplo Hell and C/MT-Hell (multi-tone variants)
- Automatic clock recovery, replacing the manual slant control
- Macros (CQ / exchange / 73) and image TX

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Build a static bundle:

```bash
npm run build    # -> dist/  (~28 kB; drop on any static host)
npm run preview
```

There is no server component to deploy. `dist/` is the entire application, and
`base` is relative so it runs from a subdirectory, a plain file server, or a USB
stick.

### Hosting locally with PHP

If you'd rather not keep Node running in the shack, `web.sh` serves the built
bundle with PHP's built-in web server — PHP is already on most machines:

```bash
./web.sh              # builds if needed, serves http://localhost:8080
./web.sh -p 9000      # different port
./web.sh -b           # force a rebuild first
./web.sh -n           # skip the build, serve dist/ as it stands
./web.sh -h           # usage
```

If 8080 is busy the script walks forward to the next free port and says so.

PHP here is **only a static file server** — there is no PHP application code and
still no backend. `router.php` exists for one reason: `AudioWorklet.addModule()`
rejects scripts served with the wrong MIME type, and the built-in server needs a
nudge to label the worklet chunks `text/javascript`. It also sets a strict CSP
that blocks outbound requests, which is the app's no-network promise enforced by
the browser rather than merely asserted here.

**Serving to other machines:** `./web.sh -H 0.0.0.0` exposes the page on your
LAN, but browsers block microphone access outside a secure context, so **receive
will not work over a plain-http LAN address** — transmit still will, since
playback needs no permission. To decode on another machine, put it behind https
(a reverse proxy with a certificate, or a tunnel). The script warns about this
when you bind to a non-localhost address.

### Hosting on GitHub Pages

Pushing to `main` builds the bundle and publishes it — see
`.github/workflows/pages.yml`. Enable it once per fork:

1. **Settings → Pages → Source: GitHub Actions.**
2. Push to `main`. The workflow runs the test suite, builds, and deploys.

The site lands at `https://<user>.github.io/<repo>/`. `base` is relative in
`vite.config.ts`, so the subdirectory needs no configuration, and `dist/` stays
gitignored — nothing built is ever committed.

Pages serves over https, which is a secure context, so the microphone works
there. It cannot send response headers, so the CSP that `router.php` sets
locally is injected into the built `index.html` instead (build only, so the dev
server's HMR is unaffected). The no-network promise is therefore enforced by the
browser on Pages too, not just asserted.

### Browser requirements

- Web Audio API with `AudioWorklet` (Chrome/Edge 66+, Firefox 76+, Safari 14.1+)
- Microphone/line-in permission for receive
- **A secure context** (`https://` or `localhost`) — `getUserMedia` is blocked on
  plain `http://`, which is the single most common "it doesn't hear anything"
  cause when self-hosting on a LAN.
- Output device selection needs `AudioContext.setSinkId` (Chromium today); other
  browsers fall back to the system default output.

---

## Using it on the air

1. **Start audio.** Browsers won't open an AudioContext or a microphone without
   a click, so press **Start audio** first. Device labels stay blank until
   permission is granted — the pickers fill in afterwards.
2. **Audio in.** Connect rig audio out → sound card in (interface, CAT cable, or
   acoustic coupling in a pinch), then choose the input device.
3. **Tune.** Set the rig to USB on a Hell calling frequency (14.063, 7.063,
   10.137 MHz are customary). Find the signal on the spectrum or its trail on
   the waterfall and click it; the cursor snaps to that audio frequency and TX
   follows RX automatically.
4. **Set width.** Start at 350 Hz. Narrow it when the band is crowded, widen it
   if the dots look mushy.
5. **Transmit.** Type, press Enter. Audio goes to the selected output device;
   key the rig via VOX or your interface's PTT. The app does not drive PTT — it
   produces audio only.
6. **If the text slants,** adjust the slant slider until it sits level. A steady
   upward or downward drift is a clock difference, not a tuning error.
7. **If the text sits half in one print copy and half in the other,** that is the
   print phase, not a fault — leave **Auto sync** ticked and it settles within a
   few characters, or untick it and place the text yourself with **Align**.

**No radio?** Tick **Loopback monitor**, type something, and press Enter — your
own transmission is decoded and drawn on the strip.

**Licensing:** generating the tones is just making sound and needs no license.
Feeding them to a transmitter on the amateur bands does. Operate within your
license class, your national regulations, and your band plan.

---

## Mode specs

Standard **Feld Hell**, as implemented:

| Parameter | Value |
|---|---|
| Pixel rate | **122.5 baud** |
| Character rate | 2.5 characters/second (150 CPM, 25 WPM) |
| Character matrix | 7 × 7 pixels = 49 pixels |
| Glyph area | 5 × 5 pixels, centred in the cell: a blank column each side and a blank row above and below |
| Pixel duration | 8.163 ms (hence the ~8 ms minimum on-signal) |
| Element rate | 245 elements/second (half-height dots) |
| Element duration | 4.08 ms |
| Modulation | On/off keying of a single audio tone |
| Occupied bandwidth | ~350 Hz |
| Duty cycle | ~22% |
| Transmit order | Column-major, left to right; within a column, bottom to top |
| Default audio center | 1500 Hz (user-tunable) |

Two numbers get confused constantly, so to be explicit:

- **122.5 baud** is Feld Hell's pixel rate. 122.5 ÷ 49 pixels = exactly 2.5
  characters/second. This is the mode you will meet on the air.
- **245 baud** belongs to **F-Hell**, the original press-service variant, which
  used identical geometry at twice the speed (5 char/s). It is rare today.

245 *also* appears as Feld Hell's element rate, and that is a separate fact: each
pixel is transmitted as **two vertically stacked half-height dots**, so 122.5
pixels/s × 2 = 245 elements/s and the 7×7 character becomes a 7×14 element cell.
Half-height dots let the original machines print visibly smoother diagonals.

Dots are keyed with a raised-cosine rise/fall rather than hard edges. Hard
switching of a 1500 Hz tone at 245 Hz produces sidebands hundreds of hertz wide —
inconsiderate on a crowded band and a real reason ops will ask you to fix your
signal.

---

## Architecture

```
                       ┌─────────────── UI thread (TypeScript) ───────────────┐
  mic / line-in  ───►  │  MediaStream ──┬─► AnalyserNode ──► TuningDisplay     │
                       │                └─► AudioWorkletNode(hell-rx)          │
                       │                          │ postMessage: element batch │
                       │                          ▼                            │
                       │                     HellStrip canvas                  │
                       │                                                       │
  speaker / rig  ◄───  │  AudioWorkletNode(hell-tx) ◄── raster from encoder    │
                       │            └──► (loopback into hell-rx, optional)     │
                       └───────────────────────────────────────────────────────┘
```

Two audio worklets, both on the audio thread; everything else is plain DOM. No
UI framework — the app is a handful of controls and two canvases.

```
index.html                 layout: header / RX strip / tuning / TX line / devices
web.sh                     local hosting via PHP's built-in server (static only)
router.php                 MIME types + CSP for web.sh; no application logic
src/
  main.ts                  wiring, settings persistence, render loop
  styles.css
  hell/                    pure logic, no audio, no DOM — the cheap-to-test half
    modes.ts               mode table and derived timing; single source of truth
    font.ts                5x5 glyphs in a 7x7 cell, written as ASCII art
    encoder.ts             text -> raster
    raster.ts              raster type, element ordering, debug rendering
    align.ts               print sync: finds the cell boundary in the stream
  dsp/
    tone-generator.ts      raster -> shaped OOK samples (TX core)
    demodulator.ts         samples -> element intensities (RX core)
    agc.ts                 slow peak/floor tracking and SNR estimate
    worklets/
      hell-tx.worklet.ts   thin AudioWorklet shell around tone-generator
      hell-rx.worklet.ts   thin AudioWorklet shell around demodulator
  audio/engine.ts          Web Audio graph, device switching, loopback
  render/
    hell-strip.ts          scrolling dual-print raster display (invert, align)
    tuning-display.ts      spectrum + waterfall + passband, one canvas
  ui/devices.ts            device enumeration and pickers
tests/
  encoder.test.ts          font, encoder, timing, element ordering
  align.test.ts            print sync recovery, hysteresis, noise rejection
  loopback.test.ts         end-to-end TX -> RX over synthetic audio
```

The DSP cores are plain classes rather than worklet code, so the tests can run
them directly in Node. The worklets are deliberately thin shells.

### Receive chain

Sample-rate agnostic; everything is derived from the live `sampleRate`.

1. **Quadrature mixer** at the tuned frequency, down to baseband. Both arms are
   needed — with only one, the envelope beats in and out depending on the phase
   relationship to the transmitter.
2. **Two-pole lowpass** on each arm. Its cutoff *is* the user's width control,
   which is why width has an honest meaning in the UI.
3. **Magnitude**, integrated over each element period.
4. **AGC** — slow peak and noise-floor trackers, so it follows QSB over seconds
   rather than chasing individual dots. A fast AGC flattens the very contrast
   the operator reads.
5. **Render** — intensity maps to greyscale, straight to canvas. No thresholding.

The element clock free-runs and is trimmed manually via the slant control.
Automatic clock recovery is a TODO; the interface for it is already in place
(`HellDemodulator.setClockPpm`).

### Transmit chain

Text → glyph lookup → column raster → element sequence → the TX worklet gates a
continuous-phase oscillator with a raised-cosine envelope. The worklet owns the
timing by counting samples; nothing is scheduled from `setTimeout`, which cannot
hold 4 ms slots accurately under GC or a busy main thread.

---

## Development

```bash
npm run dev          # dev server
npm run test         # vitest (33 tests)
npm run test:watch
npm run typecheck
npm run build        # typecheck + vite build
```

The most valuable test is the **loopback**: render text to a raster, run it
through the TX sample generator, add noise at a chosen SNR, feed it to the RX
chain, and compare the recovered elements to what was sent. It runs at 44.1, 48
and 96 kHz, and it catches timing, scaling, and column-alignment regressions that
unit tests on the pure functions happily miss.

---

## Contributing

Issues and PRs welcome, especially:

- Additional Hell variants (Slowfeld, FSK-Hell, PSK-Hell, C/MT-Hell)
- Automatic clock recovery
- Font accuracy against original Feld Hell machines
- Weak-signal decode improvements that do **not** try to recognize characters
- Real on-air reports — screenshots of decoded strips are extremely useful

## License

MIT. See `LICENSE`.

## References

- [Hellschreiber — Wikipedia](https://en.wikipedia.org/wiki/Hellschreiber)
- [ZL1BPU, *Feld-Hell*](https://www.qsl.net/zl1bpu/HELL/Feld.htm) and
  [*Hellschreiber Modes — Technical Specifications*](https://www.qsl.net/zl1bpu/DOCS/Hellspec.pdf)
- [Fldigi users manual: Hellschreiber](https://www.w1hkj.org/FldigiHelp/feld_hell_page.html)
- Feld Hell Club (`feldhellclub.org`) — operating practice and activity

---

*73 de hellschreiber2026*
