#!/usr/bin/env python
"""Regenerate the QR code that sends attendees to the companion site.

Run:  uv run --with segno python make_qr.py
If the GitHub Pages address ever changes, edit URL below and rerun.
Writes a vector SVG (for the printed poster) and a PNG (for previews).
"""
import segno

URL = "https://brandmcd.github.io/sure-2026/"

# Michigan navy on white: high contrast, scans cleanly under poster lighting.
DARK = "#002647"
LIGHT = "#ffffff"


def main():
    qr = segno.make(URL, error="h")
    qr.save("assets/qr.svg", scale=16, border=4, dark=DARK, light=LIGHT)
    qr.save("assets/qr.png", scale=16, border=4, dark=DARK, light=LIGHT)
    print(f"wrote assets/qr.svg and assets/qr.png -> {URL}")


if __name__ == "__main__":
    main()
