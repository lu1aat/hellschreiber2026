import { defineConfig, type Plugin } from 'vite';

// The same policy router.php sends as a header, minus `frame-ancestors`, which
// browsers ignore in a meta tag.
//
// Why it is injected here at all: on GitHub Pages -- or any plain static host --
// nothing can set response headers, so router.php's CSP simply does not exist
// there. Hard constraint 2 (no runtime network requests) then goes back to being
// a promise in the README rather than something the browser enforces. Shipping
// the policy inside index.html keeps it enforced wherever the bundle is served
// from, including off a USB stick.
//
// Build only: the dev server needs its own origin for the HMR websocket and
// serves modules Vite rewrites on the fly, so a build-time policy would only
// get in the way there.
const CSP = [
  "default-src 'self'",
  // AudioWorklet code is compiled per context; some browsers require
  // wasm-unsafe-eval for it.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'hell-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [cspMeta()],
  // Relative base so the built bundle runs from any path: GitHub Pages
  // subdirectory, a file server, or a USB stick opened locally.
  base: './',
  build: {
    target: 'es2022',
    // Worklets are pulled in via `?worker&url`; Vite emits them as separate
    // self-contained chunks that AudioWorklet.addModule() can load.
    assetsInlineLimit: 0,
    // Drop Vite's module-preload polyfill. The entry is one self-contained
    // chunk, so no `<link rel=modulepreload>` is ever emitted and the polyfill
    // is unreachable -- but it ships a `fetch` call, and hard constraint 2 is
    // worth being able to verify by grepping the bundle for one and finding
    // nothing. Re-enable if a code-split or dynamic import is ever added.
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
    // getUserMedia needs a secure context. localhost qualifies; if you open the
    // dev server from another machine on the LAN you must use https or the
    // microphone will silently never start. See CLAUDE.md > Gotchas.
    host: true,
  },
});
