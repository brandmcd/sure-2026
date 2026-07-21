# sure-2026

Companion website for the SURE 2026 poster **Safe Drone Racing With an Unknown
Payload** (Brandon McDonald, Kaleb Ben Naveed, Dimitra Panagou). Attendees scan
the QR on the poster and open real, interactive runs from the gatekeeper
simulator: the quad's true attitude, the per-tick commit/reject timeline, and
charts of how far off the line an unknown payload pushes it.

**Live URL:** https://brandmcd.github.io/sure-2026/

## What is here

- `index.html` is the landing page: a live embedded run plus a gallery of eight
  scenes grouped as a story (clean flight, hang a load, learn the residual, the
  frontier). Styled to match the research viewer.
- `sim/*.html` are the interactive scenes. Each is a real run rendered by the
  three.js viewer. They share one copy of the viewer under `viewer/` instead of
  embedding it, so the payload per scene is just the trajectory.
- `viewer/` holds the shared viewer: `three.module.min.js`, `viewer.js`,
  `viewer.css` (a copy of the research repo's `viz/web`, with the charts kept
  visible on phones).
- `assets/qr.png` and `assets/qr.svg` are the QR to the live URL. Use the SVG on
  the printed poster.
- `make_qr.py` regenerates the QR. `build_scenes.py` regenerates the scenes.

Each scene: drag to orbit, right-drag to pan, scroll to zoom, press play. The
bottom strip is the safety check over time (green commit, red backup). The
charts show the disturbance the model must learn and the off-path distance
against the corridor wall.

## Regenerate the scenes

The scenes are built from run `.npz` files in the research repo, so run this
from there with its virtual environment:

```bash
cd ~/DASC/neural-dual-gtk
.venv/bin/python ~/DASC/sure-2026/build_scenes.py
```

Edit `SCENES` in `build_scenes.py` to change which runs ship, or `MAX_SECONDS`
to trim the tail. The viewer code lives in `~/DASC/neural-dual-gtk/viz/web`; if
it changes, recopy `viewer.js` / `viewer.css` / `vendor/three.module.min.js`
into `viewer/`.

## Deploy

Already live on GitHub Pages from `main` at the root. To update:

```bash
cd ~/DASC/sure-2026
git add -A && git commit -m "..." && git push
```

Pages rebuilds in a minute or so. If the scan URL ever changes, edit `URL` in
`make_qr.py`, rerun `uv run --with segno python make_qr.py`, and drop the new
SVG onto the poster.

## Notes

All results are in simulation on the full nonlinear drone; the guarantee is
conditional on the sets checked. The learned residual clearly helps where the
load is well excited (Grand Prix: swinging 0 to 77 percent commit, bolted-on 37
to 85), and the swinging load on the tightest tracks stays the open frontier.
