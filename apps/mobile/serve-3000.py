#!/usr/bin/env python3
"""
Nut AI web static server.

Serves apps/mobile/dist (the exported Expo web SPA) on port 3000 with the
headers the app needs:

  - Cross-Origin-Opener-Policy: same-origin
  - Cross-Origin-Embedder-Policy: require-corp

These two unlock SharedArrayBuffer, which the SQLite-WASM build the app boots
on requires. Without them the bundle loads but the database layer never opens.

Also handles SPA routing: any path without a file extension falls back to
index.html, so deep links like /result or /settings render the app and let
expo-router resolve the route client-side.
"""

import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get('PORT', '3000'))
DIST = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'dist'))

MIME_OVERRIDES = {
    '.wasm': 'application/wasm',
    '.db': 'application/octet-stream',
    '.mjs': 'text/javascript',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in MIME_OVERRIDES:
            return MIME_OVERRIDES[ext]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        # dist assets are content-hashed; let the browser cache them hard.
        if self.path.startswith('/_expo/static/'):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

    def send_head(self):
        # SPA fallback: extension-less routes get index.html.
        if not os.path.splitext(self.path)[1]:
            self.path = '/index.html'
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write('[nut-web] %s - %s\n' % (self.address_string(), fmt % args))


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print(f'[nut-web] serving {DIST} on 0.0.0.0:{PORT} (COOP/COEP on)', flush=True)
    with ThreadingServer(('0.0.0.0', PORT), Handler) as httpd:
        httpd.serve_forever()
