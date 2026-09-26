import http.server
import socketserver
import os
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()
        
    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path):
            self.path = '/index.html'
        super().do_GET()

if __name__ == '__main__':
    port = 8081
    os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"Serving at port {port}")
        httpd.serve_forever()
