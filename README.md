# sure-2026

Companion website for the SURE 2026 poster **Safe Drone Racing With an Unknown
Payload**

**Live URL:** https://brandmcd.github.io/sure-2026/

## What is here

- `index.html` is the whole main site: a self-contained, hand-drawn canvas
  simulator with three plain-language scenes (empty drone, mystery load, after
  it learns), a "how far off the path" chart, and a short explanation. No build
  step, no dependencies, no jargon. The drone shows its real banking attitude.
- `sim/grandprix-slung-learned.html` is one full run from the research viewer,
  linked discreetly from the footer for anyone who wants the technical version.
  It shares the viewer under `viewer/`.
- `viewer/` is that research viewer (three.js) vendored once.
- `assets/qr.*` is the QR to the live URL (SVG for print). `make_qr.py`
  regenerates it. `build_scenes.py` regenerates viewer runs from the research
  repo's `.npz` files.
fers by line weight, an icon-and-label status
pill, and the chart threshold.

## Deploy

If the scan URL ever changes, edit `URL` in `make_qr.py`, rerun
`uv run --with segno python make_qr.py`, and drop the new SVG onto the poster.

## Notes

Everything is in simulation. The safe zone is the region the drone's safety
check keeps it inside; the guarantee holds for the checks it runs, and the loads
shown are deliberately heavy.
