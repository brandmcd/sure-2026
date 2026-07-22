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
- The gatekeeper-on / gatekeeper-off panel replays a matched pair of real
  chicane runs on a shared clock, side by side: the same empty drone told to lap
  faster than the bends allow (the chicane speed cap raised from 5 to 8, past
  the pace the check was tuned for), once with the gatekeeper and once without
  it. The first second is clipped from both replays: before its first certified
  commit the gatekeeper drone just sits at the start line, which read as a
  stumble. The drone's drawn heading holds steady below walking pace so a
  near-stationary drone cannot spin in place. Without the
  check it swings wide at the bends and misses gates; with the check it trims the
  plan four times a second and stays inside while still racing. It reads
  `data/compare.json`, built by `build_compare.py` from
  `results/exp005/track_chicane_6_vth8_rt_{gk,raw}.npz` in the research repo
  (recorded with `examples/run_gatekeeper_racing.py --track track_chicane_6
  --duration 8`, with and without `--no-gatekeeper`, on a copy of the exp005
  config with the chicane `v_theta_max` set to 8 and the gatekeeper on the
  real-time operating point: `T_B` 2 s, `ts_grid` 0.4 to 1.0 s, replanning at
  4.17 Hz, one backup iteration). Like the other panels it hides itself if its
  data file is missing.
- The panel lower on the page plays the gatekeeper's decision as a series of
  rehearsals, with a four-step strip above it (plan, rehearse, check, commit or
  shorten) that lights up as the search runs, so the shorten-and-recheck loop is
  visible: the drone flies each one, races a little longer than the last, then
  bails out onto the middle of the course. It is a separate, self-contained
  module reading `data/gatekeeper.json`, built by `build_gatekeeper.py` from the
  same too-fast run the on/off panel replays, framed over the whole course so
  the two panels visually match; faint red crosses mark where the unchecked twin
  run left the corridor, and the two chosen ticks are full
  shorten-until-it-fits searches at exactly those bends. Each planning tick logs
  every switch time the gatekeeper
  tried, whether it passed, and its rollout, so what plays is the real search.
  The trail is coloured as it flies, turning red exactly where the rollout
  crosses the corridor edge, measured the way the safety check measures it.
  Rollouts are trimmed where they stop saying anything new: a rejected one
  shortly past its breach, an accepted one once it has settled onto the
  centerline. The panel hides itself
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
