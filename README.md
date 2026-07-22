# sure-2026

Companion website for the SURE 2026 poster **Safe Drone Racing With an Unknown
Payload**.

**Live URL:** https://brandmcd.github.io/sure-2026/

## What is here

- `index.html` is the main site: a clean canvas simulator that renders **real
  recorded runs** in a plain-language style. Two courses (Circle, Chicane), two
  scenes each (empty drone stays in the safe zone; an unknown swinging load,
  blind to the check, leaves it). The safe zone is drawn as the real box swept
  along the course, so a run can leave it sideways (Circle) or through the floor
  (Chicane), and the chart plots that offset with the dashed line at the edge.
  Positions and heights are the recorded run; only the drone's facing is rate
  limited, since the recorded ground track can swap direction instantly where a
  run slows to a crawl. A run that ends where it started loops; a partial run
  fades and replays rather than teleporting back to the start.
- `data/scenes.json` is the trajectory data (~40 KB), extracted by
  `build_real_scenes.py` from the research repo's run `.npz` files. Rebuild it
  from `~/DASC/neural-dual-gtk` with that repo's venv.
- The panel lower on the page plays the gatekeeper's decision as a series of
  rehearsals: the drone flies each one, races a little longer than the last, then
  bails out onto the middle of the course. It is a separate, self-contained
  module reading `data/gatekeeper.json`, built by `build_gatekeeper.py` from the
  same chicane run. Each planning tick logs every switch time the gatekeeper
  tried, whether it passed, and its rollout, so what plays is the real search.
  The trail is coloured as it flies, turning red exactly where the rollout
  crosses the corridor edge, measured the way the safety check measures it.
  Rollouts are trimmed where they stop saying anything new: a rejected one
  shortly past its breach, an accepted one once it has settled onto the
  centerline. Only ticks whose every verdict is visible top-down are used: on
  some ticks a rehearsal is rejected because a perturbed member of its ensemble
  leaves the corridor while the drawn rollout does not, and playing that would
  show a red verdict with nothing on screen to justify it. The panel hides itself
  if the data file is missing, so it cannot affect the rest of the page.
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
