#!/usr/bin/env python3
"""
Tiny static server for the Token Lab app.

    ./venv/bin/python serve.py            # http://localhost:8000
    ./venv/bin/python serve.py 8080

Opening index.html with file:// also works — the app deliberately avoids ES
modules, fetch() and workers so that every script and the vocabulary data load
straight off disk. This server is here for convenience (and correct MIME types).

It also exposes the verification report so you can confirm the data on disk is
byte-identical to what OpenAI ships.
"""

from __future__ import annotations

import functools
import hashlib
import http.server
import json
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

EXPECTED_SHA256 = {
    "data_src/cl100k_base.tiktoken": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
    "data_src/o200k_base.tiktoken": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
    "data_src/r50k_base.tiktoken": "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930",
    "data_src/p50k_base.tiktoken": "94b5ca7dff4d00767bc256fdd1b27e5b17361d7b8a5f968547f9f23eb70d2069",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("/verify", "/verify.json"):
            return self.serve_verify()
        return super().do_GET()

    def serve_verify(self):
        report = {}
        for rel, expected in EXPECTED_SHA256.items():
            path = os.path.join(ROOT, rel)
            if not os.path.exists(path):
                report[rel] = {"status": "missing"}
                continue
            h = hashlib.sha256()
            with open(path, "rb") as f:
                for block in iter(lambda: f.read(1 << 20), b""):
                    h.update(block)
            got = h.hexdigest()
            report[rel] = {
                "status": "ok" if got == expected else "MISMATCH",
                "expected": expected,
                "actual": got,
            }
        body = json.dumps(report, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "GET /assets" in (args[0] if args else "") or "GET / " in (args[0] if args else ""):
            return
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with Server(("0.0.0.0", port), Handler) as httpd:
        print(f"\n  Token Lab  →  http://localhost:{port}")
        print("  data check  →  http://localhost:%d/verify\n" % port)
        print("  Ctrl-C to stop\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  bye\n")


if __name__ == "__main__":
    main()