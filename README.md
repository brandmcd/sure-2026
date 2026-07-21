# sure-2026

Companion website for the SURE 2026 poster **Safe Drone Racing With an Unknown
Payload** (Brandon McDonald, Kaleb Ben Naveed, Dimitra Panagou). Attendees scan
the QR on the poster and get a live, hand-in-your-phone version of the drone: a
real-time 3D simulator plus the poster's four-part story.

**Live URL:** https://brandmcd.github.io/sure-2026/

## What is here

- `index.html` is the whole site. It is self-contained: inline CSS and JS, a
  hand-written canvas simulator, no build step, no external requests, no
  dependencies. It loads instantly and works offline once cached, which matters
  on conference wifi.
- `assets/qr.png` and `assets/qr.svg` are the QR that points at the live URL.
  Use the SVG on the printed poster; it is vector and stays crisp at any size.
- `make_qr.py` regenerates both from a single URL constant.

The simulator has three scenes: the bare drone (safety check airtight), an
unknown swinging payload (the check still says safe while the drone leaves the
corridor), and the same load with a learned residual (back inside the corridor).
Drag to orbit, press play, scrub, change speed.

## Deploy to GitHub Pages

```bash
cd ~/DASC/sure-2026
git init && git add -A && git commit -m "Companion site for the SURE 2026 poster"
gh repo create sure-2026 --public --source=. --remote=origin --push
```

Then in the repository settings, under Pages, set the source to the `main`
branch at the root. The site goes live at the URL above within a minute or two.

## Change the scan URL

If the repository name or account changes, edit `URL` at the top of
`make_qr.py`, then regenerate the QR and drop the new SVG onto the poster:

```bash
uv run --with segno python make_qr.py
```

## Numbers

The story cards track the printed poster: 44/44 gates threaded, a bare-drone
gatekeeper with zero corridor violations, an unmodeled load that leaves the
corridor on 4 of 6 tracks bolted on and 4 of 6 on a cable while every plan still
certifies safe, and 9 to 0 false-safe approvals once the check learns the load.
All results are in simulation on the full nonlinear drone; the guarantee is
conditional on the sets checked.
