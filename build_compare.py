#!/usr/bin/env python
"""Pull a matched pair of real runs: safety check on vs off, same course, same
speed order.

The order is deliberately faster than the bends allow. With the check off the
drone flies the plan as-is and overshoots; with the check on the same plan is
trimmed every tenth of a second to the longest stretch it can prove a way out
of, so it never leaves the safe zone. Both runs are stored at a fixed sample
rate on a shared clock so the site can replay them side by side. Run from the
research repo with its venv:

  cd ~/DASC/neural-dual-gtk
  .venv/bin/python ~/DASC/sure-2026/build_compare.py
"""
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path("/home/brandmcd/DASC/neural-dual-gtk")
OUT = Path("/home/brandmcd/DASC/sure-2026")
sys.path.insert(0, str(REPO))

from viz.geometry import gate_axis          # noqa: E402

RUNS = dict(
    on=REPO / "results/exp005/track_chicane_6_vth8_rt_gk.npz",
    off=REPO / "results/exp005/track_chicane_6_vth8_rt_raw.npz",
)
N = 400               # samples kept per run
NC = 240              # samples for the centerline
T0 = 1.0              # seconds clipped from both replays: before its first certified
                      # commit the checked drone just sits at the start line


def resample(a, n):
    a = np.asarray(a, float)
    idx = np.linspace(0, len(a) - 1, n)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(a) - 1)
    f = (idx - lo)[:, None] if a.ndim == 2 else (idx - lo)
    return a[lo] * (1 - f) + a[hi] * f


def build():
    runs, meta = {}, {}
    for key, path in RUNS.items():
        d = np.load(path, allow_pickle=True)
        hw, hh = float(d["corridor_half_width"]), float(d["corridor_half_height"])
        t = np.asarray(d["t"], float)
        keep = t >= T0
        lat, vert = np.abs(d["lat_err_qr"])[keep], np.abs(d["vert_err_qr"])[keep]
        out = (lat > hw) | (vert > hh)
        xy = np.asarray(d["r_sim"], float)[keep, :2]
        spd = np.linalg.norm(np.asarray(d["v_sim"], float), axis=1)[keep]
        t = t[keep] - T0
        outN = resample(out.astype(float), N) > 0.5
        episodes = int(np.sum(np.diff(np.r_[0, out.astype(int)]) == 1))
        runs[key] = dict(
            xy=[[round(float(x), 3), round(float(y), 3)] for x, y in resample(xy, N)],
            out=[int(o) for o in outN],
            spd=[round(float(s), 2) for s in resample(spd, N)],
            gates=int(np.sum(d["gate_passed"])), episodes=episodes)
        meta[key] = d
        side = np.mean(lat[out] > hw) if out.any() else 0.0
        print(f"  {key}: out {out.mean():.1%} of the run, {episodes} excursions, "
              f"gates {runs[key]['gates']}/{len(d['gate_passed'])}, "
              f"max speed {spd.max():.1f} m/s, sideways share of out {side:.0%}")

    d = meta["on"]
    path = np.asarray(d["path_xyz"], float)
    gates = []
    for g, r in zip(np.asarray(d["gates"], float), np.asarray(d["gate_radii"], float)):
        ax = gate_axis(g, path)
        gates.append([round(float(g[0]), 3), round(float(g[1]), 3),
                      round(float(np.arctan2(ax[1], ax[0])), 3), round(float(r), 3)])

    cl = resample(path[:, :2], NC)
    out = dict(hw=float(d["corridor_half_width"]),
               t_end=round(float(np.asarray(d["t"], float)[-1]) - T0, 2),
               gates_total=int(len(d["gate_passed"])),
               center=[[round(float(x), 3), round(float(y), 3)] for x, y in cl],
               gates=gates, runs=runs)
    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data/compare.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote data/compare.json ({(OUT / 'data/compare.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
