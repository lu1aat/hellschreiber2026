<?php
/**
 * Router for PHP's built-in web server (see web.sh).
 *
 * This is not application code. The project has no backend — this file exists
 * only because PHP's dev server needs a nudge to send the right Content-Type
 * for a few extensions, and because AudioWorklet is strict about MIME types:
 * a worklet chunk served as text/plain fails to load with a message that does
 * not obviously point at the server.
 *
 * Everything is served straight off disk from dist/. Nothing is generated,
 * nothing is stored, no request touches the network beyond this host.
 */

declare(strict_types=1);

const MIME_TYPES = [
    'html'  => 'text/html; charset=utf-8',
    'js'    => 'text/javascript; charset=utf-8',
    'mjs'   => 'text/javascript; charset=utf-8',
    'css'   => 'text/css; charset=utf-8',
    'json'  => 'application/json; charset=utf-8',
    'svg'   => 'image/svg+xml',
    'png'   => 'image/png',
    'jpg'   => 'image/jpeg',
    'jpeg'  => 'image/jpeg',
    'gif'   => 'image/gif',
    'webp'  => 'image/webp',
    'ico'   => 'image/x-icon',
    'wasm'  => 'application/wasm',
    'woff'  => 'font/woff',
    'woff2' => 'font/woff2',
    'txt'   => 'text/plain; charset=utf-8',
    'map'   => 'application/json; charset=utf-8',
    'webmanifest' => 'application/manifest+json',
];

$docRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/dist');
if ($docRoot === false) {
    http_response_code(500);
    echo 'Document root not found. Build the project first.';
    return true;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$path = rawurldecode($path);

// Single-page app with no client-side routing: bare '/' is index.html.
if ($path === '/' || $path === '') {
    $path = '/index.html';
}

$requested = realpath($docRoot . $path);

// Reject anything that escapes the document root. The built-in server is only
// ever bound locally, but a path-traversal hole is not worth leaving open.
if ($requested === false || !str_starts_with($requested, $docRoot) || !is_file($requested)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "404 Not Found: {$path}\n";
    return true;
}

$extension = strtolower(pathinfo($requested, PATHINFO_EXTENSION));
$mime = MIME_TYPES[$extension] ?? 'application/octet-stream';

header('Content-Type: ' . $mime);
header('Content-Length: ' . (string) filesize($requested));

// The bundle is content-hashed by Vite, but index.html is not — so never let a
// stale index.html pin the browser to assets that no longer exist.
if ($extension === 'html') {
    header('Cache-Control: no-cache, must-revalidate');
} else {
    header('Cache-Control: public, max-age=31536000, immutable');
}

// Keep the page's own guarantees honest: it makes no outbound requests, so
// forbid them at the browser level too. 'wasm-unsafe-eval' is here because
// AudioWorklet code is compiled per context and some browsers require it.
if ($extension === 'html') {
    header(
        "Content-Security-Policy: default-src 'self'; " .
        "script-src 'self' 'wasm-unsafe-eval'; " .
        "style-src 'self' 'unsafe-inline'; " .
        "img-src 'self' data: blob:; " .
        "media-src 'self' blob:; " .
        "worker-src 'self' blob:; " .
        "connect-src 'self'; " .
        "form-action 'none'; " .
        "base-uri 'self'; " .
        "frame-ancestors 'none'"
    );
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
}

readfile($requested);
return true;
