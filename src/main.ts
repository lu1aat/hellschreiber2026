/**
 * Application wiring. Everything interesting lives in src/hell, src/dsp and
 * src/render — this file only connects DOM elements to those modules.
 */

import { HellAudioEngine } from './audio/engine';
import { encodeText, estimateDurationSec } from './hell/encoder';
import {
  DEFAULT_MODE,
  charsPerMinute,
  charsPerSecond,
  wordsPerMinute,
} from './hell/modes';
import { HellStrip } from './render/hell-strip';
import { TuningDisplay } from './render/tuning-display';
import {
  listInputs,
  listOutputs,
  onDeviceChange,
  populateSelect,
  supportsOutputSelection,
} from './ui/devices';

const mode = DEFAULT_MODE;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const el = {
  startButton: $<HTMLButtonElement>('start-button'),
  audioState: $<HTMLSpanElement>('audio-state'),
  rateLabel: $<HTMLSpanElement>('rate-label'),
  snrLabel: $<HTMLSpanElement>('snr-label'),

  strip: $<HTMLCanvasElement>('rx-strip'),
  zoom: $<HTMLInputElement>('rx-zoom'),
  dual: $<HTMLInputElement>('rx-dual'),
  invert: $<HTMLButtonElement>('rx-invert'),
  slant: $<HTMLInputElement>('rx-slant'),
  slantValue: $<HTMLOutputElement>('rx-slant-value'),
  clear: $<HTMLButtonElement>('rx-clear'),

  tuning: $<HTMLCanvasElement>('tuning'),
  freqInput: $<HTMLInputElement>('freq-input'),
  widthInput: $<HTMLInputElement>('width-input'),

  txForm: $<HTMLFormElement>('tx-form'),
  txInput: $<HTMLInputElement>('tx-input'),
  txSend: $<HTMLButtonElement>('tx-send'),
  txAbort: $<HTMLButtonElement>('tx-abort'),
  txProgress: $<HTMLDivElement>('tx-progress-bar'),
  txEstimate: $<HTMLSpanElement>('tx-estimate'),

  inputDevice: $<HTMLSelectElement>('input-device'),
  outputDevice: $<HTMLSelectElement>('output-device'),
  txLevel: $<HTMLInputElement>('tx-level'),
  monitor: $<HTMLInputElement>('monitor'),
};

// --- Persistence ----------------------------------------------------------
// Settings only; nothing about this app ever leaves the machine.

const STORAGE_KEY = 'hellschreiber2026:settings';

interface Settings {
  centerFreqHz: number;
  bandwidthHz: number;
  clockPpm: number;
  txAmplitude: number;
  zoom: number;
  dualPrint: boolean;
  inverse: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
}

const defaults: Settings = {
  centerFreqHz: 1500,
  bandwidthHz: mode.bandwidthHz,
  clockPpm: 0,
  txAmplitude: 0.5,
  zoom: 3,
  dualPrint: true,
  inverse: false,
  inputDeviceId: '',
  outputDeviceId: '',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota. Not worth interrupting the operator.
  }
}

const settings = loadSettings();

// --- Displays -------------------------------------------------------------

const strip = new HellStrip(el.strip, mode, {
  scale: settings.zoom,
  dualPrint: settings.dualPrint,
  inverse: settings.inverse,
});

const tuning = new TuningDisplay(
  el.tuning,
  {
    onCenterChange: (hz) => {
      settings.centerFreqHz = hz;
      el.freqInput.value = String(Math.round(hz));
      engine.setCenterFrequency(hz);
      saveSettings();
    },
    onWidthChange: (hz) => {
      settings.bandwidthHz = hz;
      el.widthInput.value = String(Math.round(hz));
      engine.setBandwidth(hz);
      saveSettings();
    },
  },
  { minWidthHz: 50, maxWidthHz: 1000 },
);

tuning.setCenter(settings.centerFreqHz);
tuning.setWidth(settings.bandwidthHz);

// --- Audio ----------------------------------------------------------------

const engine = new HellAudioEngine(
  mode,
  {
    centerFreqHz: settings.centerFreqHz,
    bandwidthHz: settings.bandwidthHz,
    clockPpm: settings.clockPpm,
    txAmplitude: settings.txAmplitude,
  },
  {
    onElements: (elements) => strip.pushElements(elements),
    onSnr: (db) => {
      el.snrLabel.textContent = `SNR ${db.toFixed(0)} dB`;
      el.snrLabel.classList.toggle('chip-ok', db > 6);
    },
    onTxProgress: (value) => {
      el.txProgress.style.width = `${Math.round(value * 100)}%`;
    },
    onTxDone: () => setTransmitting(false),
  },
);

function setTransmitting(active: boolean): void {
  el.txSend.disabled = active;
  el.txAbort.disabled = !active;
  el.txInput.disabled = active;
  if (!active) {
    el.txProgress.style.width = '0%';
    el.txInput.focus();
  }
}

async function startAudio(): Promise<void> {
  try {
    el.startButton.disabled = true;
    await engine.start(settings.inputDeviceId || undefined);

    // Device labels are blank until permission is granted, so the pickers are
    // populated here rather than at load.
    await refreshDevices();

    engine.setMonitoring(el.monitor.checked);
    el.audioState.textContent = `running @ ${(engine.sampleRate / 1000).toFixed(1)} kHz`;
    el.audioState.classList.replace('chip-warn', 'chip-ok');
    el.startButton.textContent = 'Audio running';
    el.txInput.focus();
  } catch (error) {
    el.startButton.disabled = false;
    el.audioState.textContent = describeAudioError(error);
    console.error(error);
  }
}

function describeAudioError(error: unknown): string {
  if (!window.isSecureContext) return 'needs https or localhost';
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'microphone denied';
    if (error.name === 'NotFoundError') return 'no input device';
  }
  return 'audio failed';
}

async function refreshDevices(): Promise<void> {
  populateSelect(el.inputDevice, await listInputs());
  if (settings.inputDeviceId) el.inputDevice.value = settings.inputDeviceId;

  if (supportsOutputSelection()) {
    populateSelect(el.outputDevice, await listOutputs());
    if (settings.outputDeviceId) el.outputDevice.value = settings.outputDeviceId;
  } else {
    el.outputDevice.replaceChildren(new Option('Browser default (no selection support)', ''));
    el.outputDevice.disabled = true;
  }
}

// --- Events ---------------------------------------------------------------

el.startButton.addEventListener('click', () => void startAudio());

el.txForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.txInput.value.trim();
  if (!text) return;

  if (!engine.isRunning) {
    el.audioState.textContent = 'press Start audio first';
    return;
  }

  engine.transmit(encodeText(text, mode));
  setTransmitting(true);
  el.txInput.value = '';
  updateEstimate();
});

el.txAbort.addEventListener('click', () => {
  engine.abortTransmit();
  setTransmitting(false);
});

el.txInput.addEventListener('input', updateEstimate);

function updateEstimate(): void {
  const text = el.txInput.value;
  if (!text) {
    el.txEstimate.textContent = `${charsPerSecond(mode)} char/s · ${wordsPerMinute(mode)} WPM`;
    return;
  }
  el.txEstimate.textContent = `${text.length} chars · ${estimateDurationSec(text, mode).toFixed(1)} s`;
}

el.freqInput.addEventListener('change', () => {
  const hz = Number(el.freqInput.value);
  if (!Number.isFinite(hz)) return;
  tuning.setCenter(hz);
  settings.centerFreqHz = tuning.center;
  engine.setCenterFrequency(tuning.center);
  saveSettings();
});

el.widthInput.addEventListener('change', () => {
  const hz = Number(el.widthInput.value);
  if (!Number.isFinite(hz)) return;
  tuning.setWidth(hz);
  settings.bandwidthHz = tuning.width;
  engine.setBandwidth(tuning.width);
  saveSettings();
});

el.zoom.addEventListener('input', () => {
  settings.zoom = Number(el.zoom.value);
  strip.setScale(settings.zoom);
  saveSettings();
});

el.dual.addEventListener('change', () => {
  settings.dualPrint = el.dual.checked;
  strip.setDualPrint(settings.dualPrint);
  saveSettings();
});

function setInverse(enabled: boolean): void {
  settings.inverse = enabled;
  strip.setInverse(enabled);
  el.invert.setAttribute('aria-pressed', String(enabled));
  saveSettings();
}

el.invert.addEventListener('click', () => setInverse(!settings.inverse));

el.slant.addEventListener('input', () => {
  settings.clockPpm = Number(el.slant.value);
  el.slantValue.textContent = `${settings.clockPpm} ppm`;
  engine.setClockPpm(settings.clockPpm);
  saveSettings();
});

el.clear.addEventListener('click', () => {
  strip.clear();
  engine.resetReceiver();
});

el.inputDevice.addEventListener('change', () => {
  settings.inputDeviceId = el.inputDevice.value;
  saveSettings();
  if (engine.isRunning) void engine.setInputDevice(settings.inputDeviceId || undefined);
});

el.outputDevice.addEventListener('change', () => {
  settings.outputDeviceId = el.outputDevice.value;
  saveSettings();
  if (engine.isRunning) void engine.setOutputDevice(settings.outputDeviceId);
});

el.txLevel.addEventListener('input', () => {
  settings.txAmplitude = Number(el.txLevel.value) / 100;
  engine.setTxAmplitude(settings.txAmplitude);
  saveSettings();
});

el.monitor.addEventListener('change', () => engine.setMonitoring(el.monitor.checked));

onDeviceChange(() => void refreshDevices());

// --- Render loop ----------------------------------------------------------

function frame(): void {
  strip.render();

  const magnitudes = engine.getSpectrum();
  if (magnitudes) tuning.render(magnitudes, engine.sampleRate);

  requestAnimationFrame(frame);
}

// --- Init -----------------------------------------------------------------

el.zoom.value = String(settings.zoom);
el.dual.checked = settings.dualPrint;
// The strip was constructed with settings.inverse already applied, so only the
// button's state needs syncing here.
el.invert.setAttribute('aria-pressed', String(settings.inverse));
el.slant.value = String(settings.clockPpm);
el.slantValue.textContent = `${settings.clockPpm} ppm`;
el.freqInput.value = String(Math.round(settings.centerFreqHz));
el.widthInput.value = String(Math.round(settings.bandwidthHz));
el.txLevel.value = String(Math.round(settings.txAmplitude * 100));
el.rateLabel.textContent = `${charsPerMinute(mode)} CPM · ${mode.baud} baud`;

updateEstimate();
void refreshDevices();
requestAnimationFrame(frame);
