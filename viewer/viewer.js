import * as THREE from 'three';

const DATA = window.SCENE_DATA;
const M = DATA.meta;

/* Palette grouped by role (one color = one meaning): Track (cool neutrals),
   Flight (warm/identity), Certifier (saturated set), Charts (matched to their 3D
   source). Every hue is distinct in both themes; no two roles share a color. */
const THEMES = {
  dark: {
    bg: 0x0e1117, grid: 0x222835, corridor: 0x4f8fef, corridorOpacity: 0.13,
    centerline: 0x7c8698, gate: 0xbcc4d0, nominal: 0xf0b429, flown: 0xf5883c,
    committed: 0xe74ec0, fan: 0xbcc6d4, members: 0xef97d3, load: 0x1fc9b0, tether: 0x9aa4b2,
    quad: 0xededed, commit: 0x2ec95a, reject: 0xff4d4d, marker: 0xededed,
    switch: 0xa274ff,
    cMeas: 0xd7dce4, cFF: 0xe74ec0, cErr: 0xf5883c, cWall: 0xff4d4d,
    cGrid: 0x2a3040, cFill: 0x1a2130,
  },
  light: {
    bg: 0xfcfcfb, grid: 0xe3e2db, corridor: 0x3f7fe0, corridorOpacity: 0.12,
    centerline: 0x707a8a, gate: 0x3f4650, nominal: 0xb87d0a, flown: 0xd9691c,
    committed: 0xc32b96, fan: 0x8b93a1, members: 0xd07ab0, load: 0x0d9e88, tether: 0x5a5a5a,
    quad: 0x1a1a1a, commit: 0x1a9e48, reject: 0xd23434, marker: 0x1a1a1a,
    switch: 0x7b3ff2,
    cMeas: 0x3a3f47, cFF: 0xc32b96, cErr: 0xd9691c, cWall: 0xd23434,
    cGrid: 0xe3e2db, cFill: 0xeef0f2,
  },
};
let themeName = 'dark';
const T = () => THEMES[themeName];
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

/* ---------- data ---------- */

const P = DATA.flight.pos;
const Q = DATA.flight.quat;
const TILT = DATA.flight.tilt;
const INSIDE = DATA.flight.inside;
const LOAD = DATA.flight.load;
const RIGID = DATA.flight.rigid_offset;
const SWITCH = M.switch;   // {t, k, pos, desc} of a mid-flight payload change, or null
const TICKS = DATA.ticks;
const HAS_MEMBERS = Array.isArray(TICKS) && TICKS.some((t) => t.members && t.members.length);
const N = P.length;
const DT = M.dt;
const DURATION = M.duration;

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

/* ---------- geometry helpers (parallel-transport tube) ---------- */

function transportFrames(pts) {
  const n = pts.length;
  const tang = [], normal = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    tang.push(v3(b).sub(v3(a)).normalize());
  }
  let seed = new THREE.Vector3(0, 0, 1);
  if (Math.abs(seed.dot(tang[0])) > 0.95) seed = new THREE.Vector3(0, 1, 0);
  normal.push(seed.clone().addScaledVector(tang[0], -seed.dot(tang[0])).normalize());
  for (let i = 1; i < n; i++) {
    const axis = new THREE.Vector3().crossVectors(tang[i - 1], tang[i]);
    const s = axis.length();
    let v = normal[i - 1].clone();
    if (s > 1e-9) {
      axis.divideScalar(s);
      v.applyAxisAngle(axis, Math.atan2(s, tang[i - 1].dot(tang[i])));
    }
    v.addScaledVector(tang[i], -v.dot(tang[i])).normalize();
    normal.push(v);
  }
  const binormal = tang.map((t, i) => new THREE.Vector3().crossVectors(t, normal[i]));
  return { tang, normal, binormal };
}

function tubeGeometry(pts, radius, nTheta) {
  const n = pts.length;
  const { normal, binormal } = transportFrames(pts);
  const pos = new Float32Array(n * nTheta * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < nTheta; j++) {
      const th = 2 * Math.PI * j / nTheta;
      const o = (i * nTheta + j) * 3;
      pos[o] = pts[i][0] + radius * (normal[i].x * Math.cos(th) + binormal[i].x * Math.sin(th));
      pos[o + 1] = pts[i][1] + radius * (normal[i].y * Math.cos(th) + binormal[i].y * Math.sin(th));
      pos[o + 2] = pts[i][2] + radius * (normal[i].z * Math.cos(th) + binormal[i].z * Math.sin(th));
    }
  }
  const idx = new Uint32Array((n - 1) * nTheta * 6);
  let w = 0;
  for (let a = 0; a < n - 1; a++) {
    for (let b = 0; b < nTheta; b++) {
      const b1 = (b + 1) % nTheta;
      const v00 = a * nTheta + b, v01 = a * nTheta + b1;
      const v10 = v00 + nTheta, v11 = v01 + nTheta;
      idx[w++] = v00; idx[w++] = v10; idx[w++] = v11;
      idx[w++] = v00; idx[w++] = v11; idx[w++] = v01;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* Rectangular corridor: upright box cross-section swept along the path.
   Lateral axis = tangent x world-up (horizontal), vertical axis = world-up
   itself, so the rectangle stays upright even on climbing segments and
   matches the certifier's ground-track (xy) corridor test. */
function rectTubeGeometry(pts, hw, hh) {
  const n = pts.length;
  const zUp = new THREE.Vector3(0, 0, 1);
  const { tang, normal } = transportFrames(pts);
  const side = [], up = [];
  for (let i = 0; i < n; i++) {
    let s = new THREE.Vector3().crossVectors(tang[i], zUp);
    if (s.lengthSq() < 1e-6) s = normal[i].clone(); else s.normalize();
    side.push(s);
    up.push(zUp);
  }
  const corners = [[+1, +1], [-1, +1], [-1, -1], [+1, -1]];
  const pos = new Float32Array(n * 4 * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      const o = (i * 4 + j) * 3;
      const [cs, cu] = corners[j];
      pos[o] = pts[i][0] + hw * cs * side[i].x + hh * cu * up[i].x;
      pos[o + 1] = pts[i][1] + hw * cs * side[i].y + hh * cu * up[i].y;
      pos[o + 2] = pts[i][2] + hw * cs * side[i].z + hh * cu * up[i].z;
    }
  }
  const idx = new Uint32Array((n - 1) * 4 * 6);
  let w = 0;
  for (let a = 0; a < n - 1; a++) {
    for (let b = 0; b < 4; b++) {
      const b1 = (b + 1) % 4;
      const v00 = a * 4 + b, v01 = a * 4 + b1;
      const v10 = v00 + 4, v11 = v01 + 4;
      idx[w++] = v00; idx[w++] = v10; idx[w++] = v11;
      idx[w++] = v00; idx[w++] = v11; idx[w++] = v01;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function lineGeometry(pts) {
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

function clearGroup(group) {
  for (const c of [...group.children]) {
    group.remove(c);
    c.traverse((o) => o.geometry && o.geometry.dispose());
  }
}

/* ---------- renderer / scene / camera ---------- */

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
camera.up.set(0, 0, 1);

scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, -2, 6);
scene.add(sun);

const bbox = new THREE.Box3();
DATA.track.path.forEach((p) => bbox.expandByPoint(v3(p)));
P.forEach((p) => bbox.expandByPoint(v3(p)));
const center = bbox.getCenter(new THREE.Vector3());
const extent = bbox.getSize(new THREE.Vector3()).length();

/* z-up orbit camera, always live (playback never touches it) */
const cam = {
  target: center.clone(), az: -0.9, el: 0.55, dist: extent * 0.95,
  gTarget: center.clone(), gAz: -0.9, gEl: 0.55, gDist: extent * 0.95,
};
const camHome = { az: cam.gAz, el: cam.gEl, dist: cam.gDist, target: cam.gTarget.clone() };

function applyCamera() {
  const k = 0.18;
  cam.az += (cam.gAz - cam.az) * k;
  cam.el += (cam.gEl - cam.el) * k;
  cam.dist += (cam.gDist - cam.dist) * k;
  cam.target.lerp(cam.gTarget, k);
  const ce = Math.cos(cam.el);
  camera.position.set(
    cam.target.x + cam.dist * ce * Math.cos(cam.az),
    cam.target.y + cam.dist * ce * Math.sin(cam.az),
    cam.target.z + cam.dist * Math.sin(cam.el));
  camera.lookAt(cam.target);
}

let follow = false;
const btnFollow = document.getElementById('btn-follow');
function setFollow(on) {
  follow = on;
  btnFollow.classList.toggle('on', on);
}

let dragBtn = -1;
const last = { x: 0, y: 0 };
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  dragBtn = e.shiftKey ? 2 : e.button;
  last.x = e.clientX; last.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragBtn < 0) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  last.x = e.clientX; last.y = e.clientY;
  if (dragBtn === 0) {
    cam.gAz -= dx * 0.0055;
    cam.gEl = Math.min(1.52, Math.max(-1.3, cam.gEl + dy * 0.0045));
  } else {
    const s = cam.gDist * 0.0011;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    cam.gTarget.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    if (follow) setFollow(false);
  }
});
canvas.addEventListener('pointerup', () => { dragBtn = -1; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.gDist = Math.min(extent * 6, Math.max(extent * 0.05, cam.gDist * Math.exp(e.deltaY * 0.0011)));
}, { passive: false });

function resetCamera() {
  setFollow(false);
  cam.gAz = camHome.az; cam.gEl = camHome.el; cam.gDist = camHome.dist;
  cam.gTarget.copy(camHome.target);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  sizeTimeline();
  drawTimeline();
  if (typeof drawCharts === 'function') drawCharts();
}
addEventListener('resize', resize);

/* ---------- materials (retinted on theme switch) ---------- */

const mats = {
  corridor: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide }),
  centerline: new THREE.LineDashedMaterial({ dashSize: M.corridor_radius * 0.45, gapSize: M.corridor_radius * 0.3, transparent: true, opacity: 0.8 }),
  gate: new THREE.MeshLambertMaterial(),
  grid: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }),
  flown: new THREE.MeshBasicMaterial(),
  out: new THREE.PointsMaterial({ size: 6, sizeAttenuation: false }),
  nominal: new THREE.LineDashedMaterial({ dashSize: M.corridor_radius * 0.3, gapSize: M.corridor_radius * 0.2 }),
  canCommit: new THREE.MeshBasicMaterial(),
  canReject: new THREE.MeshBasicMaterial(),
  committed: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 }),
  fan: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }),
  members: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.38 }),
  quad: new THREE.MeshLambertMaterial(),
  disk: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  arrowCommit: new THREE.MeshLambertMaterial(),
  arrowReject: new THREE.MeshLambertMaterial(),
  load: new THREE.MeshLambertMaterial(),
  tether: new THREE.LineBasicMaterial(),
  loadTrail: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }),
  swMarker: new THREE.MeshBasicMaterial(),
  fvMarker: new THREE.MeshBasicMaterial(),
  switch: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }),
  switchRing: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
};

function applyTheme() {
  const t = T();
  document.documentElement.dataset.theme = themeName;
  scene.background = new THREE.Color(t.bg);
  mats.corridor.color.set(t.corridor); mats.corridor.opacity = t.corridorOpacity;
  mats.centerline.color.set(t.centerline);
  mats.gate.color.set(t.gate);
  mats.grid.color.set(t.grid);
  mats.flown.color.set(t.flown);
  mats.out.color.set(t.reject);
  mats.nominal.color.set(t.nominal);
  mats.canCommit.color.set(t.commit);
  mats.canReject.color.set(t.reject);
  mats.committed.color.set(t.committed);
  mats.fan.color.set(t.fan);
  mats.members.color.set(t.members);
  mats.quad.color.set(t.quad);
  mats.disk.color.set(t.quad);
  mats.arrowCommit.color.set(t.commit);
  mats.arrowReject.color.set(t.reject);
  mats.load.color.set(t.load);
  mats.tether.color.set(t.tether);
  mats.loadTrail.color.set(t.load);
  mats.swMarker.color.set(t.marker);
  mats.fvMarker.color.set(t.reject);
  mats.switch.color.set(t.switch);
  mats.switchRing.color.set(t.switch);
  if (switchLabel) {
    switchLabel.material.map = makeLabelTexture(SWITCH.desc, css(t.switch));
    switchLabel.material.needsUpdate = true;
  }
  for (const l of Object.values(layers)) {
    l.rows.forEach((row) => row.style.setProperty('--sw', css(t[l.swatch])));
  }
  const rs = document.documentElement.style;
  rs.setProperty('--c-meas', css(t.cMeas)); rs.setProperty('--c-ff', css(t.cFF));
  rs.setProperty('--c-err', css(t.cErr)); rs.setProperty('--c-wall', css(t.cWall));
  rs.setProperty('--c-band', css(t.members));
  drawTimeline();
  updateVerdictUI(true);
  updateSwitchBadge(true);
  if (typeof drawCharts === 'function') drawCharts();
}

/* ---------- static geometry ---------- */

const layerRoot = {};
const addLayer = (id) => { const g = new THREE.Group(); scene.add(g); layerRoot[id] = g; return g; };

const CHW = M.corridor_hw ?? M.corridor_radius;
const CHH = M.corridor_hh ?? M.corridor_radius;
const gCorridor = addLayer('corridor');
gCorridor.add(new THREE.Mesh(rectTubeGeometry(DATA.track.path, CHW, CHH), mats.corridor));

const gCenterline = addLayer('centerline');
{
  const line = new THREE.Line(lineGeometry(DATA.track.path), mats.centerline);
  line.computeLineDistances();
  gCenterline.add(line);
}

/* Racing gates are upright square frames: aperture half-width g.r (matching
   GateFramePredicate), thin visual bars around the opening. */
const gGates = addLayer('gates');
for (const g of DATA.track.gates) {
  const a = g.r;
  const bar = Math.max(0.04, a * 0.1);
  const depth = bar * 0.6;
  const frame = new THREE.Group();
  const inner = a + bar / 2;
  const outer = 2 * (a + bar);
  const vGeom = new THREE.BoxGeometry(bar, outer, depth);
  const hGeom = new THREE.BoxGeometry(2 * a, bar, depth);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(vGeom, mats.gate);
    post.position.set(s * inner, 0, 0);
    frame.add(post);
    const rail = new THREE.Mesh(hGeom, mats.gate);
    rail.position.set(0, s * inner, 0);
    frame.add(rail);
  }
  const n = v3(g.axis).normalize();
  let side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), n);
  if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(n, side).normalize();
  frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, n));
  frame.position.copy(v3(g.c));
  gGates.add(frame);
}

const gGrid = addLayer('grid');
const gridZ = bbox.min.z - CHH;
const gridSpan = Math.ceil(extent * 0.8);
{
  const step = gridSpan > 20 ? 2 : 1;
  const pts = [];
  for (let x = -gridSpan; x <= gridSpan; x += step) pts.push([center.x + x, center.y - gridSpan, gridZ], [center.x + x, center.y + gridSpan, gridZ]);
  for (let y = -gridSpan; y <= gridSpan; y += step) pts.push([center.x - gridSpan, center.y + y, gridZ], [center.x + gridSpan, center.y + y, gridZ]);
  gGrid.add(new THREE.LineSegments(lineGeometry(pts), mats.grid));
}

/* ---------- axis triad (world frame, z up) ---------- */

function textSprite(text, colorHex, h) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const fs = 44;
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  cv.width = Math.ceil(ctx.measureText(text).width) + 16;
  cv.height = fs + 16;
  const c2 = cv.getContext('2d');
  c2.font = `600 ${fs}px system-ui, sans-serif`;
  c2.textBaseline = 'middle';
  c2.fillStyle = colorHex;
  c2.fillText(text, 8, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(h * cv.width / cv.height, h, 1);
  return sp;
}

/* A pill-shaped label texture (dark scrim + colored text) for the payload-switch
   beacon; rebuilt on theme change so the text tracks the switch color. */
function makeLabelTexture(text, colorHex) {
  const cv = document.createElement('canvas');
  const fs = 40, pad = 18;
  let ctx = cv.getContext('2d');
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width);
  cv.width = w + 2 * pad;
  cv.height = fs + 2 * pad;
  ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(10,12,18,0.82)';
  ctx.roundRect(0, 0, cv.width, cv.height, 14);
  ctx.fill();
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colorHex;
  ctx.fillText(text, pad, cv.height / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.userData = { aspect: cv.width / cv.height };
  return tex;
}

/* small fixed orientation gizmo in the corner (not a big in-scene triad), so the
   world frame reads without cluttering the flight. Rendered in its own viewport. */
const gizmoScene = new THREE.Scene();
const gizmoCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
gizmoCam.up.set(0, 0, 1);
{
  const O = new THREE.Vector3(0, 0, 0);
  const defs = [
    [new THREE.Vector3(1, 0, 0), 0xd64545, 'x'],
    [new THREE.Vector3(0, 1, 0), 0x3fa34d, 'y'],
    [new THREE.Vector3(0, 0, 1), 0x4f8fff, 'z'],
  ];
  for (const [dir, col, name] of defs) {
    gizmoScene.add(new THREE.ArrowHelper(dir, O, 1.0, col, 0.32, 0.2));
    const lab = textSprite(name, css(col), 0.5);
    lab.position.copy(dir).multiplyScalar(1.42);
    gizmoScene.add(lab);
  }
}

function renderGizmo() {
  const s = Math.round(Math.min(88, innerWidth * 0.12));
  const x = 16, y = 84;   // bottom-left, clear of the transport bar (~64px)
  const dir = new THREE.Vector3().subVectors(camera.position, cam.target).normalize();
  gizmoCam.position.copy(dir).multiplyScalar(3.6);
  gizmoCam.lookAt(0, 0, 0);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, s, s);
  renderer.setScissor(x, y, s, s);
  renderer.render(gizmoScene, gizmoCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.autoClear = true;
}

/* ---------- flown trail + off-corridor markers ---------- */

const TRAIL_THETA = 10;
const trailRadius = Math.min(0.05, Math.max(0.012, M.corridor_radius * 0.045));
const gFlown = addLayer('flown');
const trail = new THREE.Mesh(tubeGeometry(P, trailRadius, TRAIL_THETA), mats.flown);
trail.geometry.setDrawRange(0, 0);
gFlown.add(trail);

const gOut = addLayer('out');
const outPts = [], outPrefix = new Int32Array(N);
for (let k = 0, c = 0; k < N; k++) {
  if (!INSIDE[k]) { outPts.push(P[k]); c++; }
  outPrefix[k] = c;
}
const outCloud = new THREE.Points(lineGeometry(outPts.length ? outPts : [[0, 0, -1e6]]), mats.out);
outCloud.geometry.setDrawRange(0, 0);
gOut.add(outCloud);

/* ---------- quadrotor ---------- */

/* True scale: 0.68 kg Hummingbird-class airframe -> 0.15 m center-to-motor arm,
   0.30 m motor-to-motor. Fixed physical size, not inflated with the corridor. */
const arm = 0.15;
const rotorR = 0.34 * arm;
const indicator = Math.max(arm, 0.45 * (M.corridor_hw ?? M.corridor_radius));
const quad = new THREE.Group();
scene.add(quad);
{
  const t = arm * 0.06;
  for (const a of [Math.PI / 4, 3 * Math.PI / 4]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2 * arm, t, t), mats.quad);
    box.rotation.z = a;
    quad.add(box);
  }
  quad.add(new THREE.Mesh(new THREE.CylinderGeometry(arm * 0.16, arm * 0.16, arm * 0.14, 16).rotateX(Math.PI / 2), mats.quad));
  for (const a of [45, 135, 225, 315]) {
    const x = arm * Math.cos(a * Math.PI / 180), y = arm * Math.sin(a * Math.PI / 180);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rotorR, rotorR * 0.1, 8, 28), mats.quad);
    ring.position.set(x, y, arm * 0.08);
    quad.add(ring);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(rotorR * 0.96, 24), mats.disk);
    disk.position.set(x, y, arm * 0.08);
    quad.add(disk);
  }
}
/* verdict arrow is a UI cue, sized for visibility, not part of the vehicle */
const arrow = new THREE.Group();
{
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(indicator * 0.045, indicator * 0.045, indicator * 0.9, 10).rotateX(Math.PI / 2), mats.arrowCommit);
  shaft.position.z = arm * 0.3 + indicator * 0.45;
  const head = new THREE.Mesh(new THREE.ConeGeometry(indicator * 0.12, indicator * 0.3, 14).rotateX(Math.PI / 2), mats.arrowCommit);
  head.position.z = arm * 0.3 + indicator * 1.02;
  arrow.add(shaft, head);
}
quad.add(arrow);

/* ---------- payload ---------- */

const gPayload = addLayer('payload');
let loadMesh = null, tetherLine = null, loadTrail = null, rigidGroup = null;
const LOAD_TRAIL_N = Math.min(60, N);
if (LOAD) {
  loadMesh = new THREE.Mesh(new THREE.SphereGeometry(arm * 0.3, 20, 14), mats.load);
  tetherLine = new THREE.Line(lineGeometry([[0, 0, 0], [0, 0, 0]]), mats.tether);
  tetherLine.frustumCulled = false;
  const buf = new Float32Array(LOAD_TRAIL_N * 3);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(buf, 3));
  tg.setDrawRange(0, 0);
  loadTrail = new THREE.Line(tg, mats.loadTrail);
  loadTrail.frustumCulled = false;
  gPayload.add(loadMesh, tetherLine, loadTrail);
} else if (RIGID) {
  rigidGroup = new THREE.Group();
  const off = v3(RIGID);
  const strut = new THREE.Line(lineGeometry([[0, 0, 0], RIGID]), mats.tether);
  const box = new THREE.Mesh(new THREE.BoxGeometry(arm * 0.32, arm * 0.32, arm * 0.32), mats.load);
  box.position.copy(off);
  rigidGroup.add(strut, box);
  gPayload.add(rigidGroup);
}

/* ---------- payload-switch beacon ---------- */

/* Marks where the payload stepped mid-flight (SWITCH != null): a vertical pillar,
   a ring around the corridor cross-section, and a caption. The timeline divider
   and title-card badge are the other two cues for when the change happened. */
const gSwitch = addLayer('switch');
let switchLabel = null;
if (SWITCH) {
  const sp = v3(SWITCH.pos);
  const top = sp.z + 2.2 * indicator;
  const pillarH = top - gridZ;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(trailRadius * 0.7, trailRadius * 0.7, pillarH, 16).rotateX(Math.PI / 2),
    mats.switch);
  pillar.position.set(sp.x, sp.y, gridZ + pillarH / 2);
  gSwitch.add(pillar);

  const ringR = Math.max(0.5, 1.25 * CHW);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, trailRadius * 0.9, 10, 40), mats.switchRing);
  ring.position.copy(sp);          // torus lies in the xy plane (axis = world up)
  gSwitch.add(ring);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(trailRadius * 2.6, 16, 12), mats.switch);
  dot.position.copy(sp);
  gSwitch.add(dot);

  const tex = makeLabelTexture(SWITCH.desc, css(T().switch));
  switchLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const lh = Math.max(0.5, 0.9 * indicator);
  switchLabel.scale.set(lh * tex.userData.aspect, lh, 1);
  switchLabel.position.set(sp.x, sp.y, top + lh * 0.7);
  gSwitch.add(switchLabel);
}

/* ---------- per-tick certifier layers ---------- */

const gNominal = addLayer('nominal');
const gCandidate = addLayer('candidate');
const gCommitted = addLayer('committed');
const gFan = addLayer('fan');
const gMembers = addLayer('members');
const gMarkers = addLayer('markers');

const PLAN_THETA = 8;   // tube cross-section segments for the plan tubes below
let tickIdx = -1;
/* the plan tubes/lines of the current tick, kept so their already-flown head can
   be trimmed to the live playback time each frame (planning is 0.1 s but the quad
   moves every frame, so a frozen tube head reads as the plan lagging the quad). */
let curPlan = null;
function setTick(i) {
  if (i === tickIdx || i < 0 || i >= TICKS.length) return;
  tickIdx = i;
  const tk = TICKS[i];
  for (const g of [gNominal, gCandidate, gCommitted, gFan, gMembers, gMarkers]) clearGroup(g);

  curPlan = { t0: tk.t, nom: null, can: null, com: null };
  if (tk.nom.length > 1) {
    const line = new THREE.Line(lineGeometry(tk.nom), mats.nominal);
    line.computeLineDistances();
    gNominal.add(line);
    curPlan.nom = { line, n: tk.nom.length };
  }
  if (tk.can.length > 1) {
    const mesh = new THREE.Mesh(
      tubeGeometry(tk.can, trailRadius * 0.8, PLAN_THETA), tk.commit ? mats.canCommit : mats.canReject);
    gCandidate.add(mesh);
    curPlan.can = { mesh, n: tk.can.length };
  }
  if (tk.com.length > 1) {
    const mesh = new THREE.Mesh(tubeGeometry(tk.com, trailRadius * 0.7, PLAN_THETA), mats.committed);
    gCommitted.add(mesh);
    curPlan.com = { mesh, n: tk.com.length };
  }
  if (tk.fan.length) {
    const segs = [];
    for (const poly of tk.fan) {
      for (let j = 0; j + 1 < poly.length; j++) segs.push(poly[j], poly[j + 1]);
    }
    if (segs.length) gFan.add(new THREE.LineSegments(lineGeometry(segs), mats.fan));
  }
  // the sampled-model fan (SampledSet certifier): the mean + N member rollouts this tick.
  if (tk.members && tk.members.length) {
    const segs = [];
    for (const poly of tk.members) {
      for (let j = 0; j + 1 < poly.length; j++) segs.push(poly[j], poly[j + 1]);
    }
    if (segs.length) gMembers.add(new THREE.LineSegments(lineGeometry(segs), mats.members));
  }
  if (tk.sw >= 0 && tk.sw < tk.can.length) {
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(trailRadius * 3.2), mats.swMarker);
    d.position.copy(v3(tk.can[tk.sw]));
    gMarkers.add(d);
  }
  if (tk.fv >= 0 && tk.fv < tk.can.length) {
    const x = new THREE.Mesh(new THREE.OctahedronGeometry(trailRadius * 4.2), mats.fvMarker);
    x.position.copy(v3(tk.can[tk.fv]));
    x.rotation.z = Math.PI / 4;
    gMarkers.add(x);
  }
  const vcol = tk.commit ? mats.arrowCommit : mats.arrowReject;
  arrow.children.forEach((c) => { c.material = vcol; });
  updateVerdictUI(true);
  drawTimeline();
}

/* trim the flown-past head of the current plan tubes so their head tracks the live
   quad between planning ticks (the plan ahead of the quad stays fully drawn). */
function tubeHead(p, drop) {
  const d = Math.min(Math.max(0, drop), p.n - 2);
  p.mesh.geometry.setDrawRange(d * PLAN_THETA * 6, (p.n - 1 - d) * PLAN_THETA * 6);
}
function trimPlanHead() {
  if (!curPlan) return;
  const drop = Math.round((simT - curPlan.t0) / DT);   // tube sample spacing == tracker DT
  if (curPlan.com) tubeHead(curPlan.com, drop);
  if (curPlan.can) tubeHead(curPlan.can, drop);
  if (curPlan.nom) {
    const d = Math.min(Math.max(0, drop), curPlan.nom.n - 2);
    curPlan.nom.line.geometry.setDrawRange(d, curPlan.nom.n - d);
  }
}

/* ---------- layers panel ---------- */

const _fin = (a) => Array.isArray(a) && a.some((v) => v != null);
const _wrenchAvail = _fin(DATA.flight.fmeas) || _fin(DATA.flight.fff);
const _residAvail = _fin(DATA.flight.err);
const _bandAvail = _fin(DATA.flight.band);
const layers = {
  corridor: { name: `Corridor B_k (±${CHW} m square)`, group: 'Track', swatch: 'corridor', on: true },
  centerline: { name: 'Centerline', group: 'Track', swatch: 'centerline', on: true },
  gates: { name: 'Gates', group: 'Track', swatch: 'gate', on: true },
  grid: { name: 'Ground grid', group: 'Track', swatch: 'grid', on: true },
  flown: { name: 'Flown path', group: 'Flight', swatch: 'flown', on: true },
  out: { name: 'Out of corridor', group: 'Flight', swatch: 'reject', on: true },
  ...(LOAD || RIGID ? { payload: { name: LOAD ? 'Slung payload' : `Rigid payload (x${M.rigid_exagg})`, group: 'Flight', swatch: 'load', on: true } } : {}),
  ...(SWITCH ? { switch: { name: `Payload switch @ ${SWITCH.t}s`, group: 'Flight', swatch: 'switch', on: true } } : {}),
  committed: { name: 'Committed p_com', group: 'Certifier', swatch: 'committed', on: true },
  candidate: { name: 'Candidate p_can', group: 'Certifier', swatch: 'commit', on: true },
  nominal: { name: 'Nominal plan p_nom', group: 'Certifier', swatch: 'nominal', on: false },
  fan: { name: 'Switch-time fan', group: 'Certifier', swatch: 'fan', on: false },
  ...(HAS_MEMBERS ? { members: { name: 'Sampled-model fan (N=15)', group: 'Certifier', swatch: 'members', on: false } } : {}),
  markers: { name: 'Switch / violation', group: 'Certifier', swatch: 'marker', on: false },
  ...(_wrenchAvail ? { chWrench: { name: 'Disturbance wrench', group: 'Charts', swatch: 'cFF', on: true, chart: 'wrench' } } : {}),
  ...(_residAvail ? { chResid: { name: 'Path residual', group: 'Charts', swatch: 'cErr', on: true, chart: 'resid' } } : {}),
  ...(_bandAvail ? { chBand: { name: 'Certified band width', group: 'Charts', swatch: 'members', on: true, chart: 'band' } } : {}),
};

{
  const host = document.getElementById('layers');
  let lastGroup = '';
  for (const [id, l] of Object.entries(layers)) {
    if (l.group !== lastGroup) {
      lastGroup = l.group;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = l.group;
      host.appendChild(h);
    }
    const row = document.createElement('label');
    row.innerHTML = `<input type="checkbox" ${l.on ? 'checked' : ''}><span class="sw"></span><span class="name">${l.name}</span>`;
    row.querySelector('input').addEventListener('change', (e) => {
      if (l.chart) setChartVisible(l.chart, e.target.checked);
      else layerRoot[id].visible = e.target.checked;
    });
    host.appendChild(row);
    l.rows = [row];
    if (!l.chart) layerRoot[id].visible = l.on;
  }
}

/* ---------- playback ---------- */

let simT = 0, playing = false, speedIdx = 1;
const SPEEDS = [0.5, 1, 2, 4];
const playBtn = document.getElementById('play');
const playIcon = document.getElementById('play-icon');
const clockEl = document.getElementById('clock');
const speedBtn = document.getElementById('speed');
const verdictEl = document.getElementById('verdict');

function setPlaying(on) {
  playing = on;
  playIcon.innerHTML = on
    ? '<rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/>'
    : '<path d="M7 4.6c0-1 1.1-1.6 2-1.1l12 6.9c.9.5.9 1.8 0 2.3l-12 6.9c-.9.5-2-.1-2-1.1z"/>';
}
playBtn.addEventListener('click', () => setPlaying(!playing));
speedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  speedBtn.innerHTML = `${SPEEDS[speedIdx]}&times;`;
});

function tickAt(t) {
  if (!TICKS.length) return -1;
  let lo = 0, hi = TICKS.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (TICKS[mid].t <= t + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function setTime(t, snapTick = true) {
  simT = Math.min(DURATION, Math.max(0, t));
  if (snapTick) setTick(tickAt(simT));
  if (typeof drawCharts === 'function') drawCharts();
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const pa = new THREE.Vector3(), pb = new THREE.Vector3();

function updateWorld() {
  const kf = Math.max(0, Math.min(simT / DT, N - 1));
  const k = Math.floor(kf), f = kf - k, k1 = Math.min(k + 1, N - 1);
  pa.set(P[k][0], P[k][1], P[k][2]);
  pb.set(P[k1][0], P[k1][1], P[k1][2]);
  pa.lerp(pb, f);
  qa.fromArray(Q[k]);
  qb.fromArray(Q[k1]);
  qa.slerp(qb, f);
  quad.position.copy(pa);
  quad.quaternion.copy(qa);

  trail.geometry.setDrawRange(0, Math.max(0, k) * TRAIL_THETA * 6);
  outCloud.geometry.setDrawRange(0, outPrefix[k]);
  trimPlanHead();

  if (LOAD) {
    const lk = LOAD[k];
    loadMesh.position.set(lk[0], lk[1], lk[2]);
    const tp = tetherLine.geometry.attributes.position;
    tp.setXYZ(0, pa.x, pa.y, pa.z);
    tp.setXYZ(1, lk[0], lk[1], lk[2]);
    tp.needsUpdate = true;
    const k0 = Math.max(0, k - LOAD_TRAIL_N + 1);
    const bp = loadTrail.geometry.attributes.position;
    for (let i = k0; i <= k; i++) bp.setXYZ(i - k0, LOAD[i][0], LOAD[i][1], LOAD[i][2]);
    bp.needsUpdate = true;
    loadTrail.geometry.setDrawRange(0, k - k0 + 1);
  }
  if (rigidGroup) {
    rigidGroup.position.copy(pa);
    rigidGroup.quaternion.copy(qa);
  }
  if (follow) cam.gTarget.lerp(pa, 0.08);
  updateClock(k);
  updateSwitchBadge(false);
}

let lastClock = '';
function updateClock(k) {
  const s = `t <b>${simT.toFixed(1)}</b> / ${DURATION.toFixed(1)} s &nbsp;&middot;&nbsp; ${Math.round(TILT[k])}&deg; tilt`;
  if (s !== lastClock) { clockEl.innerHTML = s; lastClock = s; }
}

function updateVerdictUI() {
  const tk = TICKS[Math.max(0, tickIdx)];
  if (!tk) return;
  const t = T();
  const col = tk.commit ? css(t.commit) : css(t.reject);
  verdictEl.querySelector('.dot').style.background = col;
  const word = verdictEl.querySelector('.word');
  word.textContent = tk.commit ? 'COMMIT' : 'REJECT';
  word.style.color = col;
  verdictEl.querySelector('.why').textContent = tk.commit ? 'nominal certified' : tk.reason;
}

/* ---------- timeline ---------- */

const tl = document.getElementById('timeline');
const tctx = tl.getContext('2d');

function sizeTimeline() {
  const dpr = Math.min(devicePixelRatio, 2);
  tl.width = tl.clientWidth * dpr;
  tl.height = tl.clientHeight * dpr;
}

function drawTimeline() {
  if (!tl.width) return;
  const t = T();
  const W = tl.width, H = tl.height, dpr = Math.min(devicePixelRatio, 2);
  const y = H / 2, bh = 5 * dpr;
  tctx.clearRect(0, 0, W, H);
  const styles = getComputedStyle(document.documentElement);
  tctx.fillStyle = styles.getPropertyValue('--track').trim() || 'rgba(128,128,128,0.3)';
  roundRect(0, y - bh / 2, W, bh, bh / 2);
  for (let i = 0; i < TICKS.length; i++) {
    const x0 = TICKS[i].t / DURATION * W;
    const x1 = (i + 1 < TICKS.length ? TICKS[i + 1].t : DURATION) / DURATION * W;
    tctx.fillStyle = css(TICKS[i].commit ? t.commit : t.reject);
    tctx.globalAlpha = i === tickIdx ? 1 : 0.55;
    roundRect(x0 + 0.5 * dpr, y - bh / 2, Math.max(1, x1 - x0 - dpr), bh, 1.5 * dpr);
  }
  tctx.globalAlpha = 1;
  if (SWITCH) {
    const sx = SWITCH.t / DURATION * W;
    tctx.fillStyle = css(t.switch);
    roundRect(sx - 1 * dpr, y - 11 * dpr, 2 * dpr, 22 * dpr, 1 * dpr);  // full-height divider
    tctx.beginPath();                                                    // downward flag at the top
    tctx.moveTo(sx - 4 * dpr, y - 11 * dpr);
    tctx.lineTo(sx + 4 * dpr, y - 11 * dpr);
    tctx.lineTo(sx, y - 5 * dpr);
    tctx.closePath();
    tctx.fill();
  }
  const px = simT / DURATION * W;
  tctx.fillStyle = styles.getPropertyValue('--ink').trim();
  roundRect(px - 1.5 * dpr, y - 8 * dpr, 3 * dpr, 16 * dpr, 1.5 * dpr);
}

function roundRect(x, y, w, h, r) {
  tctx.beginPath();
  tctx.roundRect(x, y, w, h, r);
  tctx.fill();
}

let scrubbing = false;
function scrub(e) {
  const r = tl.getBoundingClientRect();
  setTime((e.clientX - r.left) / r.width * DURATION);
}
tl.addEventListener('pointerdown', (e) => { scrubbing = true; tl.setPointerCapture(e.pointerId); scrub(e); });
tl.addEventListener('pointermove', (e) => scrubbing && scrub(e));
tl.addEventListener('pointerup', () => { scrubbing = false; });

/* ---------- telemetry charts (disturbance wrench + path residual) ---------- */

/* Two synced mini line-charts: the wrench chart plots the true disturbance vs the
   learned wrench fed forward (so a stale model reads at a glance), the residual
   chart plots off-path distance against the corridor-wall threshold. */

const F = DATA.flight;
const NS = (F.err || F.fmeas || P).length;
const someFinite = (a) => Array.isArray(a) && a.some((v) => v != null);
const wrenchOn = someFinite(F.fmeas) || someFinite(F.fff);
const residOn = someFinite(F.err);
const bandOn = someFinite(F.band);

const chartsPanel = document.getElementById('charts');
const wrenchCard = chartsPanel.querySelector('[data-chart="wrench"]');
const residCard = chartsPanel.querySelector('[data-chart="resid"]');
const bandCard = chartsPanel.querySelector('[data-chart="band"]');
if (!wrenchOn) wrenchCard.remove();
if (!residOn) residCard.remove();
if (!bandOn) bandCard.remove();
const cvWrench = document.getElementById('cv-wrench');
const cvResid = document.getElementById('cv-resid');
const cvBand = document.getElementById('cv-band');
const wrenchUnitBtn = document.getElementById('wrench-unit');
const anyChart = wrenchOn || residOn || bandOn;

// each chart card can be shown/hidden on its own from the Layers panel
const CHART_CARD = { wrench: wrenchCard, resid: residCard, band: bandCard };
function setChartVisible(which, on) {
  const card = CHART_CARD[which];
  if (card) card.style.display = on ? '' : 'none';
  drawCharts();
}

let wrenchUnit = 'f';   // 'f' = force ||f|| (N), 't' = torque ||tau|| (N.m)
if (wrenchUnitBtn) wrenchUnitBtn.addEventListener('click', () => {
  wrenchUnit = wrenchUnit === 'f' ? 't' : 'f';
  wrenchUnitBtn.innerHTML = wrenchUnit === 'f' ? '&#8741;f&#8741; N' : '&#8741;&tau;&#8741; N&middot;m';
  drawCharts();
});

const seriesMax = (...arrs) => {
  let m = 1e-6;
  for (const a of arrs) if (a) for (const v of a) if (v != null && v > m) m = v;
  return m;
};
const curIdx = () => Math.max(0, Math.min(NS - 1, Math.round(simT / DT)));

function paintChart(cv, opts) {
  if (!cv || !cv.clientWidth) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const W = cv.width = Math.round(cv.clientWidth * dpr);
  const H = cv.height = Math.round(cv.clientHeight * dpr);
  const ctx = cv.getContext('2d');
  const t = T();
  const padT = 7 * dpr, padB = 3 * dpr;
  const x = (i) => (NS <= 1 ? 0 : (i / (NS - 1)) * W);
  const y = (v) => H - padB - (Math.min(v, opts.ymax) / opts.ymax) * (H - padT - padB);
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = css(t.cGrid); ctx.lineWidth = dpr; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(0, y(0) - 0.5); ctx.lineTo(W, y(0) - 0.5); ctx.stroke();
  ctx.globalAlpha = 1;

  if (opts.threshold != null && opts.threshold <= opts.ymax) {
    const yt = y(opts.threshold);
    ctx.fillStyle = css(t.cWall); ctx.globalAlpha = 0.09;
    ctx.fillRect(0, padT, W, Math.max(0, yt - padT));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css(t.cWall); ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(0, yt + 0.5); ctx.lineTo(W, yt + 0.5); ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const s of opts.series) {
    if (!s.data) continue;
    ctx.strokeStyle = css(s.color); ctx.lineWidth = s.width * dpr;
    ctx.setLineDash(s.dash ? [3.5 * dpr, 3 * dpr] : []);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < NS; i++) {
      const v = s.data[i];
      if (v == null) { pen = false; continue; }
      const px = x(i), py = y(v);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (SWITCH) {
    const sx = SWITCH.t / DURATION * W;
    ctx.strokeStyle = css(t.switch); ctx.lineWidth = 1.4 * dpr; ctx.globalAlpha = 0.8;
    ctx.setLineDash([2 * dpr, 2 * dpr]);
    ctx.beginPath(); ctx.moveTo(sx, padT - 2 * dpr); ctx.lineTo(sx, H - padB); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  const hx = simT / DURATION * W;
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.85; ctx.lineWidth = 1.3 * dpr;
  ctx.beginPath(); ctx.moveTo(hx, padT - 3 * dpr); ctx.lineTo(hx, H - padB); ctx.stroke();
  ctx.globalAlpha = 1;
  if (opts.dot) {
    const dv = opts.dot[curIdx()];
    if (dv != null) {
      ctx.fillStyle = css(opts.dotColor);
      ctx.beginPath(); ctx.arc(hx, y(dv), 2.6 * dpr, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if (opts.readout) {
    ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillStyle = opts.readoutColor ? css(opts.readoutColor) : ink;
    ctx.fillText(opts.readout, W - 3 * dpr, 1 * dpr);
    ctx.textAlign = 'left';
  }
}

function drawCharts() {
  if (!anyChart || chartsPanel.classList.contains('hidden')) return;
  const t = T();
  const k = curIdx();
  if (wrenchOn) {
    const meas = wrenchUnit === 'f' ? F.fmeas : F.tmeas;
    const ff = wrenchUnit === 'f' ? F.fff : F.tff;
    const mv = meas ? meas[k] : null, fv = ff ? ff[k] : null;
    const fmt = (v) => (v == null ? '-' : v.toFixed(1));
    paintChart(cvWrench, {
      ymax: seriesMax(meas, ff) * 1.14,
      series: [
        { data: meas, color: t.cMeas, width: 1.6 },
        { data: ff, color: t.cFF, width: 1.6, dash: true },
      ],
      dot: meas || ff, dotColor: meas ? t.cMeas : t.cFF,
      readout: `${fmt(mv)} / ${fmt(fv)}`,
    });
  }
  if (residOn) {
    const ev = F.err[k];
    paintChart(cvResid, {
      ymax: Math.max(seriesMax(F.err), CHW * 1.15) * 1.05,
      threshold: CHW,
      series: [{ data: F.err, color: t.cErr, width: 1.7 }],
      dot: F.err, dotColor: t.cErr,
      readout: ev == null ? '-' : `${ev.toFixed(2)} m`,
      readoutColor: (ev != null && ev > CHW) ? t.cWall : t.cErr,
    });
  }
  if (bandOn) {
    const bv = F.band[k];
    paintChart(cvBand, {
      ymax: seriesMax(F.band) * 1.14,
      series: [{ data: F.band, color: t.members, width: 1.7 }],
      dot: F.band, dotColor: t.members,
      readout: bv == null ? '-' : `${bv.toFixed(2)} m`,
    });
  }
}

let chartsShown = anyChart;
const btnCharts = document.getElementById('btn-charts');
function setCharts(on) {
  chartsShown = on && anyChart;
  chartsPanel.classList.toggle('hidden', !chartsShown);
  btnCharts.classList.toggle('on', chartsShown);
  if (chartsShown) drawCharts();
}
if (!anyChart) btnCharts.style.display = 'none';
btnCharts.addEventListener('click', () => setCharts(!chartsShown));

/* resizable panel: a top-left grip grows the (bottom-right-anchored) panel up and
   to the left; the flex canvases follow. Size persists per browser. */
const grip = document.getElementById('chart-grip');
const SIZE_KEY = 'viz-charts-size';
const clampW = (w) => Math.max(220, Math.min(w, Math.min(620, innerWidth - 40)));
const clampH = (h) => Math.max(118, Math.min(h, innerHeight * 0.74));
function applySize(w, h) {
  chartsPanel.style.width = clampW(w) + 'px';
  chartsPanel.style.height = clampH(h) + 'px';
  drawCharts();
}
try {
  const s = JSON.parse(localStorage.getItem(SIZE_KEY));
  if (s && s.w && s.h) applySize(s.w, s.h);
} catch (e) { /* no stored size */ }
let rz = null;
if (grip) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = chartsPanel.getBoundingClientRect();
    rz = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (rz) applySize(rz.w + (rz.x - e.clientX), rz.h + (rz.y - e.clientY));
  });
  grip.addEventListener('pointerup', () => {
    if (!rz) return;
    rz = null;
    const r = chartsPanel.getBoundingClientRect();
    try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w: r.width, h: r.height })); } catch (e) {}
  });
}
addEventListener('resize', () => {
  if (chartsPanel.style.width)
    applySize(parseFloat(chartsPanel.style.width), parseFloat(chartsPanel.style.height));
});

/* ---------- chrome wiring ---------- */

document.getElementById('title').textContent = `${M.track} · ${M.plant}`;
const SCOPE_LABEL = { ood: 'frozen', pre: 'pre-trained', online: 'online (learning in flight)' };
const modelTag = (M.method === 'wrench_net' ? 'learning on the fly' : (M.method || 'residual'))
  + (M.scope ? ` · ${SCOPE_LABEL[M.scope] || M.scope}` : '');
document.getElementById('subtitle').textContent =
  `${modelTag} · commit ${(100 * M.commit_rate).toFixed(0)}% · ` +
  `${M.n_gates} gates · corridor ±${CHW} m`;

/* passive study: spell out the scenario (what payload, what model state) and what to
   watch for, so the scene reads without the task doc open. */
if (M.method === 'wrench_net') {
  const load = M.load === 'bare' ? 'No payload — the bare quad (band ≈ 0, the commit ceiling).'
    : M.load === 'rigid' ? 'Rigid payload — a constant downward weight.'
    : 'Swinging payload — a tethered load whose wrench is a hidden mode.';
  const state = M.load === 'bare' ? ''
    : M.scope === 'ood' ? ' Model trained OFF this track (frozen).'
    : M.scope === 'online' ? ' Model LEARNS in flight from a rolling buffer of this track.'
    : ' Model PRE-TRAINED on this track.';
  const commit = Math.round(100 * M.commit_rate);
  const watch = commit === 0
    ? 'Watch: the band is too wide to certify, so the quad never commits and crawls the backup — the path hugs the centerline slowly.'
    : commit >= 60
      ? 'Watch: the gatekeeper commits most ticks — the quad races the racing line, not the backup.'
      : 'Watch: the quad commits on the straights and falls back to the slow backup through the hard corners.';
  document.getElementById('scenario').textContent = load + state;
  document.getElementById('watch').textContent = watch;
}

/* payload badge: flips from the learned (in-distribution) load to the stepped
   (unmodeled) load the instant playback crosses the switch time. */
const badgeEl = document.getElementById('loadbadge');
let switchState = -2;
if (SWITCH) {
  const parts = (SWITCH.desc || '').split('->').map((s) => s.trim());
  const beforeTxt = parts.length === 2 ? `${parts[0]} kg` : (SWITCH.desc || 'load');
  const afterTxt = parts.length === 2 ? parts[1] : (SWITCH.desc || 'load');
  badgeEl.hidden = false;
  window._updateSwitchBadge = (force) => {
    const post = simT >= SWITCH.t ? 1 : 0;
    if (!force && post === switchState) return;
    switchState = post;
    const swc = css(T().switch);
    badgeEl.querySelector('.tag').textContent = post ? 'step ▲' : 'load';
    badgeEl.querySelector('.txt').textContent = post
      ? `payload ${afterTxt} · unmodeled step`
      : `payload ${beforeTxt} · learned`;
    badgeEl.style.setProperty('--sw-col', post ? swc : 'var(--ink-3)');
    badgeEl.style.setProperty('--sw-bg', post ? `${swc}22` : 'var(--hover)');
    badgeEl.style.setProperty('--sw-line', post ? `${swc}66` : 'var(--hairline)');
  };
}
function updateSwitchBadge(force) { if (window._updateSwitchBadge) window._updateSwitchBadge(force); }

btnFollow.addEventListener('click', () => setFollow(!follow));
document.getElementById('btn-theme').addEventListener('click', () => {
  themeName = themeName === 'dark' ? 'light' : 'dark';
  applyTheme();
});
const help = document.getElementById('help');
document.getElementById('btn-help').addEventListener('click', () => help.classList.toggle('open'));
help.addEventListener('click', (e) => { if (e.target === help) help.classList.remove('open'); });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const embedded = document.body.classList.contains('embed');
  if (embedded && (e.code === 'Space' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowRight' && TICKS.length) setTime(TICKS[Math.min(TICKS.length - 1, tickAt(simT) + 1)].t);
  else if (e.key === 'ArrowLeft' && TICKS.length) setTime(TICKS[Math.max(0, tickAt(simT) - (simT - TICKS[tickAt(simT)].t < 0.05 ? 1 : 0))].t);
  else if (e.key === 'f') setFollow(!follow);
  else if (e.key === 'c') setCharts(!chartsShown);
  else if (e.key === 't') document.getElementById('btn-theme').click();
  else if (e.key === 'r') resetCamera();
  else if (e.key === 'h') help.classList.toggle('open');
});

setTimeout(() => document.getElementById('hint').classList.add('gone'), 7000);

/* ---------- main loop ---------- */

let prev = null;
renderer.setAnimationLoop((now) => {
  const dt = prev === null ? 0 : Math.max(0, Math.min(0.05, (now - prev) / 1000));
  prev = now;
  if (playing && !scrubbing) {
    simT += dt * SPEEDS[speedIdx];
    if (simT >= DURATION) simT = 0;
    setTick(tickAt(simT));
  }
  updateWorld();
  applyCamera();
  if (playing || scrubbing) { drawTimeline(); drawCharts(); }
  renderer.render(scene, camera);
  renderGizmo();
});

/* shareable state: ?t=2.5&theme=light&play=1&follow=1&charts=0&embed=1
   camera presets: &az=<rad>&el=<rad>&zoom=<x default dist>&target=quad */
const qs = new URLSearchParams(location.search);
if (qs.get('embed') === '1') document.body.classList.add('embed');
if (qs.get('theme') === 'light') themeName = 'light';
setPlaying(qs.get('play') === '1');
if (qs.get('follow') === '1') setFollow(true);
setCharts(qs.get('charts') !== '0');
applyTheme();
resize();
setTime(parseFloat(qs.get('t')) || 0);
const qAz = parseFloat(qs.get('az')), qEl = parseFloat(qs.get('el')), qZoom = parseFloat(qs.get('zoom'));
if (Number.isFinite(qAz)) cam.gAz = qAz;
if (Number.isFinite(qEl)) cam.gEl = Math.min(1.52, Math.max(-1.3, qEl));
if (Number.isFinite(qZoom)) cam.gDist = Math.min(extent * 6, Math.max(extent * 0.05, cam.gDist * qZoom));
if (qs.get('target') === 'quad') {
  const k = Math.floor(Math.max(0, Math.min(simT / DT, N - 1)));
  cam.gTarget.set(P[k][0], P[k][1], P[k][2]);
}
cam.az = cam.gAz; cam.el = cam.gEl; cam.dist = cam.gDist; cam.target.copy(cam.gTarget);

/* parent-driven sync for the side-by-side compare page: the parent owns the
   clock and broadcasts the time so both scenes stay in lockstep. */
addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'seek') setTime(m.t);
  else if (m.type === 'theme') { themeName = m.name === 'light' ? 'light' : 'dark'; applyTheme(); }
  else if (m.type === 'follow') setFollow(!!m.on);
});
if (window.parent && window.parent !== window)
  window.parent.postMessage({ type: 'viewer-ready', duration: DURATION }, '*');
