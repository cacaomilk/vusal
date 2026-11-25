#!/usr/bin/env python3
"""Build a phone-friendly, four-file cloud deployment of VUSAL.

The generated cloud/server.js embeds the rules engine, card data, the complete
single-file game, an offline ZIP, PWA assets and the hosting guide. It has no
npm dependencies. Run from this directory:

    python3 build_cloud.py
"""
import base64
import gzip
import io
import json
import os
import re
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLOUD = HERE / "cloud"
OUT_ZIP = HERE.parent / "VUSAL-cloud.zip"
CLOUD.mkdir(exist_ok=True)


def read(path):
    return (HERE / path).read_bytes()


def text(path):
    return (HERE / path).read_text(encoding="utf-8")


def b64gz(data):
    return base64.b64encode(gzip.compress(data, compresslevel=9, mtime=0)).decode("ascii")


def js_string(s):
    return json.dumps(s)


# --- Self-contained game HTML, with cloud-specific wording -------------------
html = text("VUSAL-standalone.html")
html = html.replace("FULL GAME (.ZIP)", "OFFLINE COPY (.ZIP)")
html = html.replace(
    'see <b>DEPLOY.md</b> in the full-game ZIP.',
    'see <b>DEPLOY.md</b> on this server.'
)
html = html.replace(
    '<b>DEPLOY.md</b> in the full-game ZIP has the steps.',
    '<b>DEPLOY.md</b> on this server has the steps.'
)
html = html.replace(
    'see DEPLOY.md in the full-game ZIP.',
    'see DEPLOY.md on this server.'
)
assert "OFFLINE COPY (.ZIP)" in html
assert "in the full-game ZIP" not in html
assert '<script src=' not in html
assert 'href="style.css"' not in html

# A small ZIP served by the cloud app's OFFLINE COPY link.
docs = (CLOUD / "DEPLOY-PHONE.md").read_bytes()
offline_buf = io.BytesIO()
with zipfile.ZipFile(offline_buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in (
        ("VUSAL-standalone.html", html.encode("utf-8")),
        ("DEPLOY.md", docs),
        ("DEPLOY-PHONE.md", docs),
        ("README.txt", b"VUSAL offline copy. Open VUSAL-standalone.html in a browser.\n"),
    ):
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 25, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, data)
offline_zip = offline_buf.getvalue()

# --- Small static files exposed by the cloud server --------------------------
static_files = {
    "/DEPLOY.md": ("text/markdown; charset=utf-8", docs),
    "/DEPLOY-PHONE.md": ("text/markdown; charset=utf-8", docs),
    "/package.json": ("application/json; charset=utf-8", (CLOUD / "package.json").read_bytes()),
    "/render.yaml": ("text/yaml; charset=utf-8", (CLOUD / "render.yaml").read_bytes()),
    "/manifest.webmanifest": ("application/manifest+json; charset=utf-8", read("manifest.webmanifest")),
    "/assets/icon-192.png": ("image/png", read("assets/icon-192.png")),
    "/assets/icon-512.png": ("image/png", read("assets/icon-512.png")),
    "/assets/favicon.png": ("image/png", read("assets/favicon.png")),
    "/assets/logo.png": ("image/png", read("assets/logo.png")),
    "/health": ("text/plain; charset=utf-8", b"OK\n"),
}
static_js = ",\n".join(
    "  %s: { type: %s, body: blob(%s) }" % (
        json.dumps(k), js_string(v[0]), js_string(b64gz(v[1]))
    )
    for k, v in static_files.items()
)

# --- Inline the shared UMD modules with a tiny local require ----------------
cards_js = text("cards_data.js")
engine_js = text("engine.js")
bootstrap = (
    "/* Inlined card data and rules engine — no local require needed. */\n"
    "var CARDS_BOOTSTRAP = (function () {\n"
    "  var module = { exports: {} };\n"
    "  var exports = module.exports;\n"
    + cards_js +
    "\n  return module.exports;\n"
    "})();\n"
    "var engine = (function () {\n"
    "  var module = { exports: {} };\n"
    "  var exports = module.exports;\n"
    "  function require(name) {\n"
    "    if (name === './cards_data.js' || name === 'cards_data.js') return CARDS_BOOTSTRAP;\n"
    "    throw new Error('Unknown inlined module: ' + name);\n"
    "  }\n"
    + engine_js +
    "\n  return module.exports;\n"
    "})();\n"
)

# --- Transform the ordinary server into a one-file cloud server -------------
server = text("server.js")
server = server.replace(
    "/* VUSAL — standalone server.\n * Serves the game files and hosts online rooms over plain HTTP long-polling\n * (no dependencies, works behind the preview proxy without WebSocket upgrades).\n */",
    "/* VUSAL — phone-friendly single-file cloud server.\n * Everything is embedded; only rooms.json is written at runtime, if writable.\n */"
)
server = server.replace("var crypto = require('crypto');", "var crypto = require('crypto');\nvar zlib = require('zlib');")
server = server.replace("var engine = require('./engine.js');", bootstrap)
assert "require('./engine.js')" not in server

blob_js = (
    "function blob(s) { return zlib.gunzipSync(Buffer.from(s, 'base64')); }\n"
    "var HTML = blob(" + js_string(b64gz(html.encode('utf-8'))) + ").toString('utf8');\n"
    "var OFFLINE_ZIP = blob(" + js_string(b64gz(offline_zip)) + ");\n"
    "var STATIC = {\n" + static_js + "\n};\n"
)
server = server.replace("var waiters = [];", "var waiters = [];\n\n" + blob_js)

new_static = '''function serveStatic(req, res, pathname) {
  var rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { rel = pathname; }
  if (rel === '' ) rel = '/';
  var headers = {
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  };
  function sendBuf(status, type, body, extra) {
    var h = Object.assign({}, headers, { 'Content-Type': type, 'Content-Length': body.length }, extra || {});
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (rel === '/' || rel === '/index.html' || rel === '/VUSAL-standalone.html') {
    var body = Buffer.from(HTML, 'utf8');
    var extra = rel === '/VUSAL-standalone.html'
      ? { 'Content-Disposition': 'attachment; filename="VUSAL-standalone.html"' }
      : {};
    return sendBuf(200, 'text/html; charset=utf-8', body, extra);
  }
  if (rel === '/VUSAL.zip') {
    return sendBuf(200, 'application/zip', OFFLINE_ZIP,
      { 'Content-Disposition': 'attachment; filename="VUSAL.zip"' });
  }
  if (STATIC[rel]) {
    return sendBuf(200, STATIC[rel].type, STATIC[rel].body);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  return res.end('404');
}
'''
server, n = re.subn(
    r"function serveStatic\(req, res, pathname\) \{.*?\n\}\n\n(?=async function handleApi)",
    new_static + "\n",
    server,
    flags=re.S,
)
assert n == 1, "could not replace serveStatic"
server = server.replace(
    "console.log('VUSAL running on http://0.0.0.0:' + PORT);",
    "console.log('VUSAL cloud running on http://0.0.0.0:' + PORT);"
)
assert "var HTML = blob(" in server and "var engine = (function" in server

(CLOUD / "server.js").write_text(server, encoding="utf-8")

# --- The downloadable phone deployment pack --------------------------------
pack_files = [
    ("server.js", (CLOUD / "server.js").read_bytes()),
    ("package.json", (CLOUD / "package.json").read_bytes()),
    ("render.yaml", (CLOUD / "render.yaml").read_bytes()),
    ("DEPLOY-PHONE.md", docs),
]
with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in pack_files:
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 25, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, data)

print("wrote", CLOUD / "server.js", (CLOUD / "server.js").stat().st_size, "bytes")
print("wrote", OUT_ZIP, OUT_ZIP.stat().st_size, "bytes", len(pack_files), "files")
