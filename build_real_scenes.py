#!/usr/bin/env python
"""Pull real gatekeeper runs into a compact JSON the simple simulator renders.

Two real tracks (circle_4, chicane_6), two real runs each:
  empty = bare quad, safety check on            (stays in the corridor)
  load  = slung payload, check blind to the load (leaves the corridor)

Positions are the real 3D track, normalized so each course fills the view. The
safe zone is the real upright rectangle swept along the centerline, so a run is
outside it when it is too far sideways or too far up or down; the stored series
is that offset with 1.0 meaning the edge. Banking is computed from the real path
so the drone leans the way it actually did. Run from the research repo with its
venv:

  cd ~/DASC/neural-dual-gtk
  .venv/bin/python ~/DASC/sure-2026/build_real_scenes.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

REPO = Path("/home/brandmcd/DASC/neural-dual-gtk")
OUT = Path("/home/brandmcd/DASC/sure-2026")
sys.path.insert(0, str(REPO))

from viz.geometry import gate_axis          # noqa: E402
from viz.scene_data import load_scene        # noqa: E402

TARGET_R = 5.0        # normalized track radius in scene units
N = 360               # samples per animated path
NC = 200              # samples for the static centerline
MAX_BANK = 35.0       # cap the lean, degrees
CLOSE_TOL = 0.30      # end-to-start gap, in scene units, that still counts as a lap
G = 9.81

TRACKS = [
    dict(key="circle", label="Circle", empty="exp006_gk/track_circle_4_bare_gk",
         load="exp006_gk/track_circle_4_slung_gk"),
    dict(key="chicane", label="Chicane", empty="exp006_gk/track_chicane_6_bare_gk",
         load="exp006_gk/track_chicane_6_slung_gk"),
]
KINDS = ("empty", "load")

CAP = {
    ("*", "empty"): ("Empty drone", "flying the course, no load",
                     "No load. The drone knows its own weight, so it holds the line and stays inside the safe zone."),
    ("circle", "load"): ("Unknown load", "the check is blind to the load",
                         "An unknown load on a cable. The safety check is on, but it is still checking the empty drone, so the swinging load drags the drone wide, out through the side of the safe zone."),
    ("chicane", "load"): ("Unknown load", "the check is blind to the load",
                          "An unknown load on a cable. The safety check is on, but it is still checking the empty drone, so the swinging load drags the drone down, out through the floor of the safe zone."),
}


def caption(track, kind):
    return CAP.get((track, kind)) or CAP[("*", kind)]


def smooth(a, w=9):
    """Moving average with reflected ends, so a partial run is not blended end to start."""
    a = np.asarray(a, float)
    k = w // 2
    pad = np.concatenate([a[k:0:-1], a, a[-2:-2 - k:-1]])
    ker = np.ones(w) / w
    if a.ndim == 1:
        return np.convolve(pad, ker, mode="valid")
    return np.column_stack([np.convolve(pad[:, c], ker, mode="valid") for c in range(a.shape[1])])


def resample(a, n):
    a = np.asarray(a, float)
    idx = np.linspace(0, len(a) - 1, n)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(a) - 1)
    f = (idx - lo)[:, None] if a.ndim == 2 else (idx - lo)
    return a[lo] * (1 - f) + a[hi] * f


def follow(dirv, dt, tau=0.14, max_rate=np.radians(170.0)):
    """Point the drone where it is going, at a rate a real quadrotor could turn.

    The recorded ground track can swap direction almost instantly where the run
    slows to a crawl; chasing it exactly makes the model snap around.
    """
    h = math.atan2(dirv[0, 1], dirv[0, 0])
    out = np.empty(len(dirv))
    lim = max_rate * dt
    for i, (dx, dy) in enumerate(dirv):
        d = (math.atan2(dy, dx) - h + np.pi) % (2 * np.pi) - np.pi
        h += float(np.clip(d * dt / tau, -lim, lim))
        out[i] = h
    return np.column_stack([np.cos(out), np.sin(out)])


def heading_bank(xy, dt):
    """Yaw as a unit direction vector, roll from lateral acceleration, both smoothed.

    The direction is kept as cos/sin so the player can interpolate it without ever
    winding the wrong way around.
    """
    p = smooth(xy, 11)
    v = np.gradient(p, dt, axis=0)
    a = np.gradient(smooth(v, 11), dt, axis=0)
    spd = np.hypot(v[:, 0], v[:, 1]) + 1e-6
    dirv = smooth(v, 15)          # smooth the velocity, not the angle, so a near-stop cannot flip it
    dirv /= np.maximum(np.hypot(dirv[:, 0], dirv[:, 1]), 1e-6)[:, None]
    dirv = follow(dirv, dt)
    a_lat = (v[:, 0] * a[:, 1] - v[:, 1] * a[:, 0]) / spd        # signed, + = left turn
    cap = np.radians(MAX_BANK)
    bank = smooth(np.clip(np.arctan2(a_lat, G), -cap, cap), 25)
    return dirv, bank


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
        path3 = np.asarray(empty.path, float)
        c0 = np.array([path3[:, 0].mean(), path3[:, 1].mean(), path3[:, 2].mean()])
        sc = TARGET_R / max(np.hypot(*(path3[:, :2] - c0[:2]).T).max(), 1e-6)
        hw_m, hh_m = float(empty.corridor_hw), float(empty.corridor_hh)
        dt = float(empty.dt)
        center = (path3[:, :3] - c0) * sc

        gates = []
        for g, r in zip(empty.gates, empty.gate_radii):
            ax = gate_axis(np.asarray(g, float), path3)
            face = float(np.arctan2(ax[1], ax[0]))
            gc = (np.asarray(g, float)[:3] - c0) * sc
            gates.append([round(float(gc[0]), 3), round(float(gc[1]), 3), round(float(gc[2]), 3),
                          round(face, 3), round(float(r) * sc, 3)])

        scenes = {}
        for kind in KINDS:
            s = load_scene(REPO / f"results/{T[kind]}.npz")
            npz = np.load(REPO / f"results/{T[kind]}.npz", allow_pickle=True)
            n = len(s.t)
            lo, hi = lap_window(np.asarray(s.flown, float)[:n, :2], c0[:2])
            xyz = (np.asarray(s.flown, float)[lo:hi, :3] - c0) * sc
            xy = xyz[:, :2]
            off = np.maximum(np.abs(npz["lat_err_qr"][lo:hi]) / hw_m,
                             np.abs(npz["vert_err_qr"][lo:hi]) / hh_m)
            dirv, bank = heading_bank(xy, dt)
            gap = float(np.hypot(*(xy[-1] - xy[0])))
            loop = gap < CLOSE_TOL
            path = np.column_stack([resample(xyz, N), resample(dirv, N), resample(bank, N)])
            errN = resample(off, N)
            tag, sub, cap = caption(T["key"], kind)
            sc_dict = dict(tag=tag, sub=sub, cap=cap,
                           load=bool(s.has_load and s.load_xyz is not None), loop=loop,
                           path=[[round(float(x), 3) for x in row] for row in path],
                           err=[round(float(e), 3) for e in errN])
            if sc_dict["load"]:
                dronexyz = np.asarray(s.flown, float)[lo:hi]
                loadxyz = np.asarray(s.load_xyz, float)[lo:hi]
                rel = (loadxyz - dronexyz) * sc
                relN = resample(rel, N)
                sc_dict["loadrel"] = [[round(float(v), 3) for v in row] for row in smooth(relN, 9)]
            scenes[kind] = sc_dict
            print(f"  {T['label']}/{kind}: {hi - lo} samples, end-to-start gap {gap:.2f}, "
                  f"{'loops' if loop else 'replays'}")

        cl = resample(np.vstack([center, center[:1]]), NC)
        tracks.append(dict(key=T["key"], label=T["label"],
                           hw=round(hw_m * sc, 3), hh=round(hh_m * sc, 3),
                           center=[[round(float(v), 3) for v in row] for row in cl],
                           gates=gates, scenes=scenes))
        print(f"  {T['label']}: gates={len(gates)} "
              f"outside(load)={sum(e > 1 for e in scenes['load']['err'])}/{N}")

    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data/scenes.json").write_text(json.dumps(dict(tracks=tracks), separators=(",", ":")))
    print(f"wrote data/scenes.json ({(OUT / 'data/scenes.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
