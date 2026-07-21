#!/usr/bin/env python
"""Regenerate the interactive scene pages from real gatekeeper runs.

Reuses the research viewer (viz/web) and its payload builder, but points every
scene at ONE shared copy of three.js and the viewer code (viewer/) instead of
embedding a copy in each file. Run from the research repo with its venv:

  cd ~/DASC/neural-dual-gtk
  .venv/bin/python ~/DASC/sure-2026/build_scenes.py

Edit SCENES below to change which runs ship. MAX_SECONDS trims the tail so the
files stay light without touching the run data.
"""
import json
import sys
from pathlib import Path

REPO = Path("/home/brandmcd/DASC/neural-dual-gtk")
OUT = Path("/home/brandmcd/DASC/sure-2026")
sys.path.insert(0, str(REPO))

from viz.scene_data import load_scene          # noqa: E402
from viz.scene_json import scene_payload       # noqa: E402
from viz.build_scene import _rigid_offset      # noqa: E402

MAX_SECONDS = 16.0
PASSIVE = REPO / "results/exp0075/passive"

# (npz stem, output id, card title, one-line what-to-watch)
SCENES = [
    ("passive_wrench_net_ood_track_circle_4_bare",
     "circle-bare", "Circle, no payload",
     "The clean case. The gatekeeper certifies nearly every tick, so the quad races the line."),
    ("passive_wrench_net_ood_track_uzh_split_s_7_bare",
     "splits-bare", "Split-S, no payload",
     "An inverted, aggressive track. Watch the quad bank and roll: the tilt is the real attitude, not a flat icon."),
    ("passive_wrench_net_ood_track_grand_prix_10_bare",
     "grandprix-bare", "Grand Prix, no payload",
     "Ten gates on the bare quad, gatekeeper airtight. This is the track we follow as a load goes on."),
    ("passive_wrench_net_ood_track_grand_prix_10_slung",
     "grandprix-slung-frozen", "Grand Prix, swinging load, model frozen",
     "Same track, now a tethered load the model never saw. The band is too wide to certify, so the gatekeeper refuses to commit and crawls the backup."),
    ("passive_wrench_net_pre_track_grand_prix_10_slung",
     "grandprix-slung-learned", "Grand Prix, swinging load, model learned",
     "Learn the residual on this track and the commit comes back: the quad races the swinging load instead of crawling."),
    ("passive_wrench_net_ood_track_grand_prix_10_rigid",
     "grandprix-rigid-frozen", "Grand Prix, bolted-on load, model frozen",
     "A rigid load bolted under the quad, model frozen. It commits on the straights, falls back through the hard gates."),
    ("passive_wrench_net_pre_track_grand_prix_10_rigid",
     "grandprix-rigid-learned", "Grand Prix, bolted-on load, model learned",
     "The same bolted-on load with the residual learned: it commits through most of the track."),
    ("passive_wrench_net_ood_track_chicane_6_slung",
     "chicane-slung-frozen", "Chicane, swinging load (the frontier)",
     "The hardest reversals plus a swinging load. Even a learned model cannot certify this yet: this is the open problem."),
]

SHELL = (REPO / "viz/web/viewer.html").read_text()


def scene_html(payload: dict, title: str) -> str:
    body = SHELL
    # strip the template's inlined-asset placeholders; wire to shared files
    body = body.replace('<title>__TITLE__</title>', f'<title>{title}</title>')
    body = body.replace('<style>\n__CSS__\n</style>',
                        '<link rel="stylesheet" href="../viewer/viewer.css">')
    body = body.replace('window.SCENE_DATA = __SCENE_JSON__;',
                        'window.SCENE_DATA = ' + json.dumps(payload, separators=(",", ":"), allow_nan=False) + ';')
    body = body.replace('"three": "__THREE_SRC__"', '"three": "../viewer/three.module.min.js"')
    body = body.replace('<script type="module">\n__VIEWER_JS__\n</script>',
                        '<script type="module" src="../viewer/viewer.js"></script>')
    return body


def main():
    sim = OUT / "sim"
    sim.mkdir(parents=True, exist_ok=True)
    manifest = []
    for stem, sid, title, watch in SCENES:
        npz = PASSIVE / f"{stem}.npz"
        if not npz.exists():
            print(f"SKIP (missing): {npz}")
            continue
        s = load_scene(npz)
        payload = scene_payload(
            s, max_seconds=MAX_SECONDS,
            rigid_offset=_rigid_offset() if s.load == "rigid" else None)
        (sim / f"{sid}.html").write_text(scene_html(payload, title))
        kb = (sim / f"{sid}.html").stat().st_size // 1024
        m = payload["meta"]
        manifest.append(dict(id=sid, title=title, watch=watch,
                             track=m["track"], plant=m["plant"], load=m["load"],
                             scope=m["scope"], commit=round(m["commit_rate"], 2),
                             gates=m["n_gates"], kb=kb))
        print(f"  {sid}.html  {kb} KB  commit {m['commit_rate']:.0%}")
    (OUT / "sim/manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote {len(manifest)} scenes + manifest.json")


if __name__ == "__main__":
    main()
