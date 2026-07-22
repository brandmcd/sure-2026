#!/usr/bin/env python
"""Pull the real switch-time search out of a gatekeeper run.

The run is the same too-fast chicane lap the on/off comparison replays, and the
JSON also carries where its unchecked twin left the corridor, so the decision
panel can show the search happening at exactly those bends.

Every planning tick the gatekeeper asks the same question several times: if I
keep flying the plan for this long and only then peel off onto the escape route,
does that escape route stay inside the corridor? It asks about the longest run of
the plan first and commits the last one that still passes. The run logs every one
of those tries with its rollout, so the panel on the site is the real search, not
a sketch.

Each rollout is trimmed where it stops saying anything new: once the escape route
has settled onto the centerline it just crawls along it, and a rejected rollout
past its breach is a maneuver the drone never flies. Run from the research repo with its venv:

  cd ~/DASC/neural-dual-gtk
  .venv/bin/python ~/DASC/sure-2026/build_gatekeeper.py
"""
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path("/home/brandmcd/DASC/neural-dual-gtk")
OUT = Path("/home/brandmcd/DASC/sure-2026")
sys.path.insert(0, str(REPO))

from viz.geometry import gate_axis          # noqa: E402

RUN = REPO / "results/exp005/track_chicane_6_vth8_rt_gk.npz"
OFF_RUN = REPO / "results/exp005/track_chicane_6_vth8_rt_raw.npz"
TICKS = [14, 16]              # one search that shortens twice, one that shortens once;
                              # every rejected rehearsal visibly crosses the wall top-down
NP_CAND = 64                  # samples kept per candidate rollout
NP_NOM = 24                   # samples kept for the plan it wants to fly
TAIL = 0.5                    # seconds of a rejected rollout drawn past the breach


def thin(a, n):
    a = np.asarray(a, float)
    if len(a) <= n:
        return a, np.arange(len(a))
    idx = np.unique(np.linspace(0, len(a) - 1, n).round().astype(int))
    return a[idx], idx


def settle_index(xyz, path, sw, dt, near=0.15, hold=10, extra=0.6):
    """Where the escape route has settled onto the middle of the course.

    The escape route eases onto the centerline and then crawls along it, which
    it could keep doing forever, so the rest of the rollout says nothing new.
    """
    d = np.linalg.norm(xyz[:, None, :2] - path[None, :, :2], axis=2).min(1)
    for j in range(int(sw), len(d) - hold):
        if (d[j:j + hold] < near).all():
            return min(len(xyz), j + int(extra / dt))
    return len(xyz)


def lateral(xyz, path):
    """Sideways offset from the course, measured the way the safety check measures it:
    project onto the ground track, then take the distance to that foot."""
    a, b = path[:-1, :2], path[1:, :2]
    d = b - a
    l2 = np.maximum((d ** 2).sum(1), 1e-12)
    out = np.empty(len(xyz))
    for i, r in enumerate(xyz[:, :2]):
        s = np.clip(((r - a) * d).sum(1) / l2, 0.0, 1.0)
        foot = a + s[:, None] * d
        out[i] = np.sqrt(((r - foot) ** 2).sum(1).min())
    return out


def first_breach(xyz, path, hw):
    out = np.flatnonzero(lateral(xyz, path) > hw)
    return int(out[0]) if len(out) else None


def build():
    d = np.load(RUN, allow_pickle=True)
    dt = float(d["dt"])
    hw = float(d["corridor_half_width"])
    path = np.asarray(d["path_xyz"], float)
    fan, ca_t, ca_quad, ca_nom = d["ca_fan"], d["ca_t"], d["ca_quad"], d["ca_nom_ref"]

    gates = []
    for g, r in zip(np.asarray(d["gates"], float), np.asarray(d["gate_radii"], float)):
        ax = gate_axis(g, path)
        gates.append([round(float(g[0]), 3), round(float(g[1]), 3),
                      round(float(np.arctan2(ax[1], ax[0])), 3), round(float(r), 3)])

    ticks = []
    for i in TICKS:
        cands = []
        for sw, ok, xyz in fan[i]:
            xyz = np.asarray(xyz, float)
            cut = settle_index(xyz, path, sw, dt)
            breach = first_breach(xyz, path, hw)
            if not ok and breach is None:
                raise SystemExit(f"tick {i}: the rejected {int(sw) * dt:.1f}s rehearsal "
                                 "never visibly crosses the wall; pick another tick")
            if breach is not None:
                cut = min(cut, breach + int(TAIL / dt))
            n_kept = min(cut, len(xyz))
            pts, idx = thin(xyz[:cut, :2], NP_CAND)
            cands.append(dict(
                wait=round(int(sw) * dt, 2), ok=bool(ok),
                sw=int(np.searchsorted(idx, int(sw))),
                breach=None if breach is None else int(np.searchsorted(idx, breach)),
                sec=round(n_kept * dt, 2),
                path=[[round(float(x), 3), round(float(y), 3)] for x, y in pts]))
        nom, _ = thin(np.asarray(ca_nom[i], float)[:, :2], NP_NOM)
        q = np.asarray(ca_quad[i], float)
        ticks.append(dict(
            t=round(float(ca_t[i]), 2),
            quad=[round(float(q[0]), 3), round(float(q[1]), 3)],
            nom=[[round(float(x), 3), round(float(y), 3)] for x, y in nom],
            cands=cands))
        waits = ", ".join(f"{c['wait']}s {'ok' if c['ok'] else 'no'}" for c in cands)
        print(f"  t={ca_t[i]:.2f}s  {waits}")

    # the flown path between decisions, so the drone visibly races from one
    # bend to the next instead of sitting frozen; the last segment runs until
    # the lap comes back around to the first bend
    t_sim = np.asarray(d["t"], float)
    r_sim = np.asarray(d["r_sim"], float)[:, :2]
    times = [float(ca_t[i]) for i in TICKS]
    for j in range(len(TICKS)):
        t0f = times[j]
        if j + 1 < len(times):
            t1f = times[j + 1]
        else:
            q0 = np.array(ticks[0]["quad"])
            later = t_sim > t0f + 1.0
            if later.any():
                t1f = float(t_sim[later][np.linalg.norm(r_sim[later] - q0, axis=1).argmin()])
            else:
                t1f = float(t_sim[-1])
        seg = r_sim[(t_sim >= t0f) & (t_sim <= t1f)]
        pts, _ = thin(seg, max(16, int(24 * (t1f - t0f))))
        ticks[j]["fly"] = [[round(float(x), 3), round(float(y), 3)] for x, y in pts]
        ticks[j]["fs"] = round(t1f - t0f, 2)
        gap = float(np.linalg.norm(np.array(pts[-1]) -
                                   np.array(ticks[(j + 1) % len(ticks)]["quad"])))
        print(f"  fly from t={t0f:.2f} to {t1f:.2f}s ({t1f - t0f:.2f}s), "
              f"lands {gap:.2f} m from the next decision")

    off = np.load(OFF_RUN, allow_pickle=True)
    off_out = (np.abs(off["lat_err_qr"]) > float(off["corridor_half_width"])) | \
              (np.abs(off["vert_err_qr"]) > float(off["corridor_half_height"]))
    onsets = np.flatnonzero(np.diff(np.r_[0, off_out.astype(int)]) == 1)
    offx = [[round(float(x), 2), round(float(y), 2)]
            for x, y in np.asarray(off["r_sim"], float)[onsets, :2]]

    cl, _ = thin(path[:, :2], 240)
    out = dict(hw=hw, dt=dt,
               center=[[round(float(x), 3), round(float(y), 3)] for x, y in cl],
               gates=gates, ticks=ticks, offx=offx)
    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data/gatekeeper.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote data/gatekeeper.json ({(OUT / 'data/gatekeeper.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
