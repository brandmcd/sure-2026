#!/usr/bin/env python
"""Pull real gatekeeper runs into a compact JSON the simple simulator renders.

Two real tracks (circle_4, chicane_6), two real runs each:
  empty = bare quad, safety check on            (stays in the corridor)
  load  = slung payload, check blind to the load (leaves the corridor)

Ground track only (the corridor test is on x-y), normalized so each track fills
the view. Banking is computed from the real path so the drone leans the way it
actually did. Run from the research repo with its venv:

  cd ~/DASC/neural-dual-gtk
  .venv/bin/python ~/DASC/sure-2026/build_real_scenes.py
"""
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path("/home/brandmcd/DASC/neural-dual-gtk")
OUT = Path("/home/brandmcd/DASC/sure-2026")
sys.path.insert(0, str(REPO))

from viz.geometry import gate_axis          # noqa: E402
from viz.scene_data import load_scene        # noqa: E402

TARGET_R = 5.0        # normalized track radius in scene units
N = 200               # samples per animated path
NC = 140              # samples for the static centerline
MAX_BANK = 35.0       # cap the lean, degrees
G = 9.81

TRACKS = [
    dict(key="circle", label="Circle", empty="exp006_gk/track_circle_4_bare_gk",
         load="exp006_gk/track_circle_4_slung_gk"),
    dict(key="chicane", label="Chicane", empty="exp006_gk/track_chicane_6_bare_gk",
         load="exp006_gk/track_chicane_6_slung_gk"),
]
KINDS = ("empty", "load")

CAP = {
    "empty": ("Empty drone", "flying laps, no load",
              "No load. The drone knows its own weight, so it holds the line and stays inside the safe zone."),
    "load": ("Unknown load", "the check is blind to the load",
             "An unknown load on a cable. The safety check is on, but it is still checking the empty drone, so the swinging load drags the real drone out of the safe zone."),
}


def smooth(a, w=9):
    n = len(a)
    k = w // 2
    out = np.empty_like(a, dtype=float)
    for i in range(n):
        idx = [(i + j) % n for j in range(-k, k + 1)]
        out[i] = np.asarray(a)[idx].mean(0)
    return out


def resample(a, n):
    a = np.asarray(a, float)
    idx = np.linspace(0, len(a) - 1, n)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(a) - 1)
    f = (idx - lo)[:, None] if a.ndim == 2 else (idx - lo)
    return a[lo] * (1 - f) + a[hi] * f


def heading_bank(xy, dt):
    """Yaw from the path direction, roll from lateral acceleration, both smoothed."""
    p = smooth(xy, 9)
    v = np.gradient(p, dt, axis=0)
    a = np.gradient(v, dt, axis=0)
    spd = np.hypot(v[:, 0], v[:, 1]) + 1e-6
    heading = np.unwrap(np.arctan2(v[:, 1], v[:, 0]))
    a_lat = (v[:, 0] * a[:, 1] - v[:, 1] * a[:, 0]) / spd        # signed, + = left turn
    bank = np.arctan2(a_lat, G)
    cap = np.radians(MAX_BANK)
    bank = np.clip(bank, -cap, cap)
    bank = smooth(bank[:, None], 9)[:, 0]
    return heading, bank


def lap_window(xy, c0):
    """Index window for exactly the last full loop, so playback loops seamlessly."""
    ang = np.unwrap(np.arctan2(xy[:, 1] - c0[1], xy[:, 0] - c0[0]))
    if ang[-1] < ang[0]:
        ang = -ang
    if ang[-1] - ang[0] < 1.9 * np.pi:
        return 0, len(xy)
    start = int(np.searchsorted(ang, ang[-1] - 2 * np.pi))
    return start, len(xy)


def build():
    tracks = []
    for T in TRACKS:
        empty = load_scene(REPO / f"results/{T['empty']}.npz")
        center = np.asarray(empty.path, float)[:, :2]
        c0 = center.mean(0)
        sc = TARGET_R / max(np.hypot(*(center - c0).T).max(), 1e-6)
        hw = float(empty.corridor_hw) * sc
        dt = float(empty.dt)

        gates = []
        for g, r in zip(empty.gates, empty.gate_radii):
            ax = gate_axis(np.asarray(g, float), np.asarray(empty.path, float))
            face = float(np.arctan2(ax[1], ax[0]))
            gc = (np.asarray(g, float)[:2] - c0) * sc
            gates.append([round(float(gc[0]), 3), round(float(gc[1]), 3),
                          round(face, 3), round(float(r) * sc, 3)])

        scenes = {}
        for kind in KINDS:
            s = load_scene(REPO / f"results/{T[kind]}.npz")
            n = len(s.t)
            lo, hi = lap_window(np.asarray(s.flown, float)[:n, :2], c0)
            xy = (np.asarray(s.flown, float)[lo:hi, :2] - c0) * sc
            err = np.asarray(s.path_err, float)[lo:hi] * sc
            heading, bank = heading_bank(xy, dt)
            path = np.column_stack([resample(xy, N),
                                    np.interp(np.linspace(0, len(xy) - 1, N),
                                              np.arange(len(xy)), heading),
                                    np.interp(np.linspace(0, len(xy) - 1, N),
                                              np.arange(len(xy)), bank)])
            errN = resample(err, N)
            sc_dict = dict(tag=CAP[kind][0], sub=CAP[kind][1], cap=CAP[kind][2],
                           load=bool(s.has_load and s.load_xyz is not None),
                           path=[[round(float(x), 3) for x in row] for row in path],
                           err=[round(float(e), 3) for e in errN])
            if sc_dict["load"]:
                dronexyz = np.asarray(s.flown, float)[lo:hi]
                loadxyz = np.asarray(s.load_xyz, float)[lo:hi]
                rel = (loadxyz - dronexyz) * sc
                relN = resample(rel, N)
                sc_dict["loadrel"] = [[round(float(v), 3) for v in row] for row in relN]
            scenes[kind] = sc_dict

        cl = resample(np.column_stack([np.append(center[:, 0], center[0, 0]),
                                       np.append(center[:, 1], center[0, 1])]) - c0, NC) * sc
        tracks.append(dict(key=T["key"], label=T["label"], hw=round(hw, 3),
                           center=[[round(float(x), 3), round(float(y), 3)] for x, y in cl],
                           gates=gates, scenes=scenes))
        print(f"  {T['label']}: hw={hw:.2f} gates={len(gates)} "
              f"breach(load)={sum(e > hw for e in scenes['load']['err'])}/{N}")

    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data/scenes.json").write_text(json.dumps(dict(tracks=tracks), separators=(",", ":")))
    print(f"wrote data/scenes.json ({(OUT / 'data/scenes.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
