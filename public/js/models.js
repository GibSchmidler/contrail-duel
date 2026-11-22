// Procedural low-poly jet fighter and missile meshes (nose points to -Z).
import * as THREE from 'three';

function extrudeShape(pts, depth) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

// Missile meshes by type: AIM-9M (canards), AIM-9X (slim, tiny fins), AIM-120 (bigger, mid-body wings).
const MSL = {
  aim9m:  { len: 2.87, r: 0.064, tail: [0.42, 0.3], mid: null, canard: [0.36, 0.2], nose: 0x2a2a2a, band: 0xd8b400 },
  aim9x:  { len: 3.02, r: 0.064, tail: [0.3, 0.22], mid: null, canard: [0.12, 0.08], nose: 0x7a6a3a, band: 0xd8b400 },
  aim120: { len: 3.66, r: 0.089, tail: [0.42, 0.32], mid: [0.32, 0.5], canard: null, nose: 0xd8d8d0, band: 0xd8b400 },
};
export function buildMissileMesh(key = 'aim9x') {
  const d = MSL[key] || MSL.aim9x;
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5, metalness: 0.2 });
  const nose = new THREE.MeshStandardMaterial({ color: d.nose, roughness: 0.4, metalness: 0.3 });
  const band = new THREE.MeshStandardMaterial({ color: d.band, roughness: 0.5 });
  const R = d.r * 1.7, L = d.len; // slightly oversized so they read at a distance
  const body = new THREE.CylinderGeometry(R, R, L, 8); body.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(body, white));
  const cone = new THREE.ConeGeometry(R, key === 'aim120' ? 0.55 : 0.32, 8); cone.rotateX(-Math.PI / 2); cone.translate(0, 0, -L / 2 - (key === 'aim120' ? 0.27 : 0.16));
  g.add(new THREE.Mesh(cone, nose));
  const bandG = new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.08, 8); bandG.rotateX(Math.PI / 2); bandG.translate(0, 0, -L * 0.18);
  g.add(new THREE.Mesh(bandG, band));
  const fins = (span, chord, z) => {
    for (let i = 0; i < 4; i++) {
      const f = new THREE.BoxGeometry(0.02, span, chord); f.translate(0, R + span / 2, z);
      const m = new THREE.Mesh(f, white); m.rotation.z = (i * Math.PI) / 2 + Math.PI / 4; g.add(m);
    }
  };
  fins(d.tail[0], d.tail[1], L / 2 - d.tail[1] / 2);
  if (d.mid) fins(d.mid[0], d.mid[1], -0.15);
  if (d.canard) fins(d.canard[0], d.canard[1], -L / 2 + 0.35);
  return g;
}

export function buildJet(scheme) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: scheme.body, roughness: 0.55, metalness: 0.35, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: scheme.accent, roughness: 0.5, metalness: 0.3, flatShading: true });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2c3d, roughness: 0.1, metalness: 0.9 });

  // fuselage
  const prof = [[0, -8.4], [0.22, -7.8], [0.5, -6.8], [0.82, -5.2], [1.02, -3.2], [1.1, -1], [1.12, 3], [1.02, 5.6], [0.86, 7.3], [0.78, 7.7]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.LatheGeometry(prof, 14);
  fus.rotateX(Math.PI / 2);
  fus.scale(1, 0.86, 1);
  g.add(new THREE.Mesh(fus, body));

  // nose radome tip
  const tip = new THREE.ConeGeometry(0.23, 0.7, 10); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -8.6);
  g.add(new THREE.Mesh(tip, darkMetal));

  // canopy
  const can = new THREE.SphereGeometry(1, 14, 10);
  can.scale(0.55, 0.55, 1.75);
  const canopy = new THREE.Mesh(can, glass);
  canopy.position.set(0, 0.72, -4.3);
  g.add(canopy);

  // intake
  const intake = new THREE.BoxGeometry(1.45, 0.95, 4.2);
  const im = new THREE.Mesh(intake, body); im.position.set(0, -0.95, -1.0); g.add(im);
  const lip = new THREE.BoxGeometry(1.3, 0.8, 0.1);
  const lm = new THREE.Mesh(lip, darkMetal); lm.position.set(0, -0.95, -3.12); g.add(lm);

  // main wing (one piece through fuselage)
  const wing = extrudeShape([[0, -2.8], [5.3, 2.4], [5.3, 3.5], [0, 4.4], [-5.3, 3.5], [-5.3, 2.4]], 0.16);
  wing.rotateX(Math.PI / 2); wing.translate(0, 0.0, 0);
  g.add(new THREE.Mesh(wing, body));
  // leading-edge extension
  const lex = extrudeShape([[0, -6.0], [1.5, -2.6], [1.0, 0], [-1.0, 0], [-1.5, -2.6]], 0.12);
  lex.rotateX(Math.PI / 2); lex.translate(0, 0.05, 0);
  g.add(new THREE.Mesh(lex, body));

  // stabilators
  const stab = extrudeShape([[0, 5.4], [3.1, 7.2], [3.1, 8.0], [0, 7.9], [-3.1, 8.0], [-3.1, 7.2]], 0.1);
  stab.rotateX(Math.PI / 2); stab.translate(0, -0.15, 0);
  g.add(new THREE.Mesh(stab, body));

  // vertical tail (x of shape -> z, y up)
  const fin = extrudeShape([[4.2, 0.6], [7.7, 0.6], [8.0, 4.4], [6.8, 4.4]], 0.16);
  fin.rotateY(-Math.PI / 2); fin.translate(0.08, 0, 0);
  g.add(new THREE.Mesh(fin, accent));
  const finCap = extrudeShape([[6.75, 3.6], [7.95, 3.6], [8.0, 4.4], [6.8, 4.4]], 0.2);
  finCap.rotateY(-Math.PI / 2); finCap.translate(0.1, 0, 0);
  g.add(new THREE.Mesh(finCap, body));

  // nose stripe / roundel-ish band
  const band = new THREE.CylinderGeometry(1.08, 1.1, 0.5, 14, 1, true); band.rotateX(Math.PI / 2); band.scale(1, 0.86, 1); band.translate(0, 0, 1.5);
  g.add(new THREE.Mesh(band, accent));

  // nozzle
  const noz = new THREE.CylinderGeometry(0.78, 0.66, 1.0, 14, 1, true); noz.rotateX(Math.PI / 2); noz.translate(0, 0, 8.1);
  const nozMat = darkMetal.clone(); nozMat.side = THREE.DoubleSide;
  g.add(new THREE.Mesh(noz, nozMat));

  // afterburner flame
  const flameGroup = new THREE.Group();
  flameGroup.position.set(0, 0, 8.5);
  const outer = new THREE.ConeGeometry(0.62, 4, 14, 1, true); outer.rotateX(Math.PI / 2); outer.translate(0, 0, 2);
  const outerMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  flameGroup.add(new THREE.Mesh(outer, outerMat));
  const inner = new THREE.ConeGeometry(0.4, 2.5, 12, 1, true); inner.rotateX(Math.PI / 2); inner.translate(0, 0, 1.25);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  flameGroup.add(new THREE.Mesh(inner, innerMat));
  const glowDisc = new THREE.CircleGeometry(0.66, 14);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(glowDisc, glowMat); disc.position.z = 0.0;
  flameGroup.add(disc);
  g.add(flameGroup);

  // stores: each station holds one mesh per missile type, shown to match the loadout
  const mounts = [[5.35, 0.0, 2.6], [-5.35, 0.0, 2.6], [3.4, -0.55, 1.7], [-3.4, -0.55, 1.7], [2.2, -0.75, 0.6], [-2.2, -0.75, 0.6]];
  const pylonMat = new THREE.MeshStandardMaterial({ color: scheme.body, roughness: 0.6, metalness: 0.3, flatShading: true });
  const stations = mounts.map(([x, y, z], i) => {
    const st = {};
    for (const key of ['aim9m', 'aim9x', 'aim120']) {
      const m = buildMissileMesh(key);
      m.position.set(x, y - (i >= 2 ? 0.25 : 0), z + (key === 'aim120' ? -0.3 : 0));
      m.visible = false; g.add(m); st[key] = m;
    }
    if (i >= 2) { const py = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 1.6), pylonMat); py.position.set(x, y + 0.05, z); g.add(py); }
    return st;
  });
  g.traverse((o) => { o.frustumCulled = true; });
  return {
    group: g, flame: flameGroup, flameOuter: outerMat, flameInner: innerMat, flameDisc: glowMat,
    setStores(stores) { stations.forEach((st, i) => { for (const k in st) st[k].visible = !!stores && stores[i] === k; }); },
    setThrottle(eng, t) {
      const ab = Math.max(0, (eng - 1) / 0.2);
      const flick = 0.9 + 0.1 * Math.sin(t * 60) + 0.05 * Math.sin(t * 97);
      flameGroup.visible = eng > 0.05;
      const len = (0.25 + eng * 0.35 + ab * 1.2) * flick;
      flameGroup.scale.set(0.8 + ab * 0.25, 0.8 + ab * 0.25, len);
      outerMat.opacity = 0.15 + ab * 0.5;
      innerMat.opacity = 0.25 + ab * 0.55;
      glowMat.opacity = 0.35 + eng * 0.3 + ab * 0.3;
    },
  };
}
