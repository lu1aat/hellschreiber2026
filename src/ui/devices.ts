/**
 * Audio device enumeration.
 *
 * The one non-obvious rule: before permission is granted, enumerateDevices()
 * returns entries with empty `label` strings. Populating a picker at page load
 * therefore yields a list of blank options. Always re-enumerate after
 * getUserMedia resolves.
 */

export interface DeviceOption {
  deviceId: string;
  label: string;
}

async function listDevices(kind: MediaDeviceKind): Promise<DeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `${kind === 'audioinput' ? 'Input' : 'Output'} ${index + 1}`,
    }));
}

export const listInputs = (): Promise<DeviceOption[]> => listDevices('audioinput');
export const listOutputs = (): Promise<DeviceOption[]> => listDevices('audiooutput');

/** Repopulate a <select>, preserving the current choice where still present. */
export function populateSelect(select: HTMLSelectElement, devices: DeviceOption[]): void {
  const previous = select.value;
  select.replaceChildren();

  if (devices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No devices — grant microphone access';
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    select.append(option);
  }

  if (devices.some((device) => device.deviceId === previous)) {
    select.value = previous;
  }
}

/** Fires when a rig interface is plugged in or removed mid-session. */
export function onDeviceChange(handler: () => void): void {
  navigator.mediaDevices?.addEventListener('devicechange', handler);
}

/** True where the browser can pick an output device (Chromium today). */
export function supportsOutputSelection(): boolean {
  return typeof (AudioContext.prototype as unknown as Record<string, unknown>).setSinkId === 'function';
}
