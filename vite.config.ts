import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built bundle runs from any path: GitHub Pages
  // subdirectory, a file server, or a USB stick opened locally.
  base: './',
  build: {
    target: 'es2022',
    // Worklets are pulled in via `?worker&url`; Vite emits them as separate
    // self-contained chunks that AudioWorklet.addModule() can load.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // getUserMedia needs a secure context. localhost qualifies; if you open the
    // dev server from another machine on the LAN you must use https or the
    // microphone will silently never start. See CLAUDE.md > Gotchas.
    host: true,
  },
});
