#!/usr/bin/env python3
"""Build VUSAL-standalone.html: one file, no server, no network.

Run from this directory:  python3 build_standalone.py
"""
import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "VUSAL-standalone.html")


def read(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as f:
        return f.read()


def data_uri(name, mime="image/png"):
    with open(os.path.join(HERE, name), "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())


def data_uri_raw(data, mime):
    return "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())


def main():
    html = read("index.html")
    css = read("style.css")
    js = {n: read(n) for n in ("cards_data.js", "engine.js", "app.js")}

    cards = {}
    folder = os.path.join(HERE, "assets", "cards")
    for filename in sorted(os.listdir(folder)):
        if filename.endswith(".png"):
            cards[filename[:-4]] = data_uri("assets/cards/" + filename)
    assert len(cards) == 108, "expected 108 card images, found %d" % len(cards)

    logo = data_uri("assets/logo.png")
    favicon = data_uri("assets/favicon.png")
    icon192 = data_uri("assets/icon-192.png")
    icon512 = data_uri("assets/icon-512.png")
    with open(os.path.join(HERE, "manifest.webmanifest"), "rb") as f:
        manifest = data_uri_raw(f.read(), "application/manifest+json")

    patch = (
        "<script>\n(function(){\n  var M = "
        + json.dumps(cards, separators=(",", ":"))
        + ";\n  Object.keys(M).forEach(function(k){ if (window.VUSAL_CARDS && window.VUSAL_CARDS[k]) window.VUSAL_CARDS[k].img = M[k]; });\n})();\n</script>\n"
    )

    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
    html = (html.replace("manifest.webmanifest", manifest)
                .replace("assets/icon-192.png", icon192)
                .replace("assets/icon-512.png", icon512)
                .replace("assets/favicon.png", favicon)
                .replace("assets/logo.png", logo))
    html = html.replace('<script src="cards_data.js"></script>', "<script>\n" + js["cards_data.js"] + "\n</script>")
    html = html.replace('<script src="engine.js"></script>', "<script>\n" + js["engine.js"] + "\n</script>\n" + patch)
    html = html.replace('<script src="app.js"></script>', "<script>\n" + js["app.js"] + "\n</script>")

    assert "<script src=" not in html, "external script left in standalone build"
    assert 'href="style.css"' not in html, "external stylesheet left in standalone build"
    assert "assets/" not in html.replace("assets/cards/", ""), "external asset left in standalone build"

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
