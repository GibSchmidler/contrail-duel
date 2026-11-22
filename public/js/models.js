// Procedural low-poly jet fighter and missile meshes (nose points to -Z).
import * as THREE from 'three';

function extrudeShape(pts, depth) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

export function buildMissileMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const body = new THREE.CylinderGeometry(0.13, 0.13, 2.9, 8); body.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(body, white));
  const nose = new THREE.ConeGeometry(0.13, 0.35, 8); nose.rotateX(-Math.PI / 2); nose.translate(0, 0, -1.62);
  g.add(new THREE.Mesh(nose, dark));
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.BoxGeometry(0.02, 0.5, 0.35);
    fin.translate(0, 0.28, 1.2);
    const m = new THREE.Mesh(fin, white);
    m.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    g.add(m);
    const cf = new THREE.BoxGeometry(0.02, 0.3, 0.2);
    cf.translate(0, 0.2, -0.9);
    const m2 = new THREE.Mesh(cf, white);
    m2.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    g.add(m2);
  }
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

  // missiles on hardpoints: wingtips then inner pylons
  const missiles = [];
  const mounts = [[5.35, 0.0, 2.6], [-5.35, 0.0, 2.6], [3.2, -0.5, 1.6], [-3.2, -0.5, 1.6]];
  for (const [x, y, z] of mounts) {
    const m = buildMissileMesh();
    m.position.set(x, y, z);
    g.add(m);
    missiles.push(m);
  }

  g.traverse((o) => { o.frustumCulled = true; });
  return {
    group: g, flame: flameGroup, flameOuter: outerMat, flameInner: innerMat, flameDisc: glowMat, missiles,
    // order missiles are fired in (alternate sides)
    setMissileCount(n) { const order = [2, 3, 0, 1]; for (let i = 0; i < 4; i++) missiles[order[i]].visible = i >= 4 - n; },
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
