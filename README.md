# sure-2026

Companion website for the SURE 2026 poster **Safe Drone Racing With an Unknown
Payload**.

**Live URL:** https://brandmcd.github.io/sure-2026/

## What is here

- `index.html` is the main site: a clean canvas simulator that renders **real
  recorded runs** in a plain-language style. Two courses (Circle, Chicane), two
  scenes each (empty drone stays in the safe zone; an unknown swinging load,
  blind to the check, leaves it). The drone banks the way it really did; the
  "how far off the path" chart and the safe-zone edge are the real signals.
- `data/scenes.json` is the trajectory data (~40 KB), extracted by
  `build_real_scenes.py` from the research repo's run `.npz` files. Rebuild it
  from `~/DASC/neural-dual-gtk` with that repo's venv.
- `sim/grandprix-slung-learned.html` is one full run from the research three.js
  viewer, linked from the footer; it shares `viewer/`.
- `assets/qr.*` is the QR to the live URL (SVG for print); `make_qr.py`
  regenerates it.

Because the sim fetches `data/scenes.json`, view it over http, not `file://`:
`python3 -m http.server` in this folder, then open the printed URL.

## Deploy

Live on GitHub Pages from `main`. If the scan URL changes, edit `URL` in
`make_qr.py`, rerun `uv run --with segno python make_qr.py`, and drop the new
SVG on the poster.

## Notes

Everything is in simulation. The safe zone is the region the safety check keeps
the drone inside; the guarantee holds for the checks it runs, and the loads
shown are deliberately heavy. Teaching the check to feel the load, so it stays
both safe and fast, is the research next step.
