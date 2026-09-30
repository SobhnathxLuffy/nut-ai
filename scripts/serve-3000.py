"""Serve the exported web app on :3000.

COOP/COEP headers are required by sqlite-wasm (SharedArrayBuffer), the SPA
fallback keeps expo-router deep links working, and explicit MIME types cover
.wasm / .db assets that SimpleHTTPRequestHandler would otherwise mislabel.

Usage: python3 scripts/serve-3000.py [dist-dir]   (defaults to apps/mobile/dist)
"""
import http.server
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'mobile', 'dist')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.wasm': 'application/wasm',
        '.db': 'application/octet-stream',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        base = os.path.basename(self.path.split('?')[0].split('#')[0])
        if not os.path.exists(super().translate_path(self.path)) and '.' not in base:
            # SPA fallback: route-like paths without a file extension get index.html
            self.path = '/index.html'
        return super().send_head()


if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(('', 3000), Handler) as httpd:
        print('Serving Nut AI web at http://localhost:3000')
        httpd.serve_forever()
