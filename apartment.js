import * as THREE from 'three';

// =============================================================================
//  Wohnzimmer + Küche, nachgebaut aus Fotos.
//  ALLE MASSE SIND GESCHÄTZT (Meter). Für echtes 1:1-Laufen bitte nachmessen
//  und hier anpassen – vor allem die Raumgrössen und Türpositionen.
//
//  Koordinaten (Blick vom Flur ins Wohnzimmer = Richtung -z = "Norden"):
//    x  nach rechts (Osten, Richtung Küche)
//    z  nach hinten (Süden, Richtung Flur)
//    y  nach oben
// =============================================================================
export const M = {
  ceiling: 2.45,
  wall: 0.12,
  tile: 0.33,                                        // Bodenplatten-Kantenlänge
  living:  { x0: -4.5, x1: 3.0, z0: -2.0, z1: 2.0 }, // Wohn-/Esszimmer: 7.5 × 4.0 m (gemessen, ca.)
  kitchen: { x1: 7.5, z1: 1.0 },                     // Küche: 4.5 × 3.0 m (gemessen, ca.); x ab living.x1, z ab living.z0
  hall:    { x0: 1.9, x1: 3.0, z1: 3.6 },            // Flurstück vor der Wohnzimmertür (unbekannt)
  hallDoor:    { x0: 2.0, x1: 2.9 },                 // Tür Flur → Wohnzimmer (Südwand) – geschätzt
  kitchenDoor: { z0: -1.0, z1: -0.1 },               // Tür Wohnzimmer → Küche (Ostwand) – geschätzt
  balconyDoor: { z0: -0.7, z1: 0.2 },                // Balkontür (Westwand) – geschätzt
};

// Startpunkt: in der Wohnzimmertür vom Flur aus, Blick in den Raum (wie Foto 1)
export const SPAWN = { x: 2.45, z: 2.6, yaw: 0 };

const H = M.ceiling, T = M.wall;

// ---- Texturen (prozedural, keine Bilddateien nötig) -------------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const tileTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d6cdbf';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const v = 150 + Math.random() * 70 | 0;
    g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.12)`;
    g.fillRect(Math.random() * w, Math.random() * h, 4, 4);
  }
  g.strokeStyle = '#7d7466';
  g.lineWidth = 5;
  g.strokeRect(0, 0, w, h);
});

const slatTex = canvasTex(64, 8, (g, w, h) => {
  g.fillStyle = '#21170f';
  g.fillRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#9d7046');
  grd.addColorStop(0.5, '#c4945f');
  grd.addColorStop(1, '#9a6c43');
  g.fillStyle = grd;
  g.fillRect(9, 0, w - 18, h);
});

const curtainTex = canvasTex(128, 8, (g, w) => {
  for (let x = 0; x < w; x++) {
    const v = 228 + 24 * Math.sin((x / w) * Math.PI * 2);
    g.fillStyle = `rgb(${v | 0},${(v - 3) | 0},${(v - 10) | 0})`;
    g.fillRect(x, 0, 1, 8);
  }
});

function texMat(tex, rx, ry, extra = {}) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, ...extra });
}
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const glow = (color, intensity = 1.5) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

// ---- Materialien --------------------------------------------------------------
const wallMat = mat(0xece6dc, { roughness: 0.95 });
const ceilMat = mat(0xf4f1ea, { roughness: 1 });
const trim = mat(0xf3efe6);
const white = mat(0xf2f1ee, { roughness: 0.5 });
const darkMetal = mat(0x2b2b2e, { roughness: 0.4, metalness: 0.4 });
const steel = mat(0xb4b8bb, { roughness: 0.35, metalness: 0.7 });
const wood = mat(0x8a6542, { roughness: 0.6 });
const darkWood = mat(0x6e4a2e, { roughness: 0.6 });
const rattan = mat(0xb98c55, { roughness: 0.9 });
const leather = mat(0x5b3f30, { roughness: 0.5 });
const fabricLight = mat(0xbdb6aa);
const fabricDark = mat(0x3a3d42);
const granite = mat(0xd8d8d6, { roughness: 0.4 });
const glass = new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 });

// ---- Bausteine ----------------------------------------------------------------
// Achsparallele Box über Min/Max-Koordinaten
function box(g, material, x0, x1, y0, y1, z0, z1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.add(m);
  return m;
}

// Wand von A nach B (Mittellinie), mit Öffnungen [{ from, to, top }] in Metern ab A
function wallRun(g, ax, az, bx, bz, openings = []) {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const seg = (s, e, y0, y1) => {
    if (e - s < 0.001 || y1 - y0 < 0.001) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(e - s, y1 - y0, T), wallMat);
    const mid = (s + e) / 2;
    m.position.set(ax + dx * mid, (y0 + y1) / 2, az + dz * mid);
    m.rotation.y = -Math.atan2(dz, dx);
    g.add(m);
  };
  let cur = -T / 2;
  for (const o of [...openings].sort((p, q) => p.from - q.from)) {
    seg(cur, o.from, 0, H);
    seg(o.from, o.to, o.top ?? 2.05, H);
    cur = o.to;
  }
  seg(cur, len + T / 2, 0, H);
}

// Türzarge; axis 'x' = Wand verläuft entlang x (bei z = at), 'z' = entlang z (bei x = at)
function doorFrame(g, axis, at, a, b, top = 2.05) {
  const d = T + 0.04, w = 0.06;
  if (axis === 'x') {
    box(g, trim, a - w, a, 0, top + w, at - d / 2, at + d / 2);
    box(g, trim, b, b + w, 0, top + w, at - d / 2, at + d / 2);
    box(g, trim, a - w, b + w, top, top + w, at - d / 2, at + d / 2);
  } else {
    box(g, trim, at - d / 2, at + d / 2, 0, top + w, a - w, a);
    box(g, trim, at - d / 2, at + d / 2, 0, top + w, b, b + w);
    box(g, trim, at - d / 2, at + d / 2, top, top + w, a - w, b + w);
  }
}

// Boden (Platten) + Decke für ein Rechteck
function floorAndCeiling(g, x0, x1, z0, z1, yOff = 0) {
  const w = x1 - x0 + T, d = z1 - z0 + T;
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const f = new THREE.Mesh(geo, texMat(tileTex, w / M.tile, d / M.tile, { roughness: 0.55 }));
  f.position.set((x0 + x1) / 2, yOff, (z0 + z1) / 2);
  g.add(f);
  const c = new THREE.Mesh(geo.clone().rotateX(Math.PI), ceilMat);
  c.position.set((x0 + x1) / 2, H, (z0 + z1) / 2);
  g.add(c);
}

// Stuhl: Sitzfläche zeigt lokal nach -z; rotY dreht ihn
function chair(g, x, z, rotY, material) {
  const c = new THREE.Group();
  box(c, material, -0.22, 0.22, 0.42, 0.5, -0.22, 0.22);
  box(c, material, -0.22, 0.22, 0.5, 0.9, 0.16, 0.23);
  box(c, darkMetal, -0.03, 0.03, 0, 0.42, -0.03, 0.03);
  c.position.set(x, 0, z);
  c.rotation.y = rotY;
  g.add(c);
}

// Vorhang vor einer Wand
function curtain(g, axis, at, a, b, y0, y1, colorTex = curtainTex, tint = 0xffffff) {
  const len = b - a;
  const m = texMat(colorTex, len / 0.12, 1, { color: tint, roughness: 1 });
  if (axis === 'x') box(g, m, a, b, y0, y1, at - 0.03, at + 0.03);
  else {
    const mesh = box(g, m, at - 0.03, at + 0.03, y0, y1, a, b);
    mesh.material.map.repeat.set(len / 0.12, 1);
  }
}

function lamp(g, x, z, baseY, shadeY0, shadeY1, light = true) {
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, shadeY1 - shadeY0, 24), glow(0xffe2b0, 0.9));
  shade.position.set(x, (shadeY0 + shadeY1) / 2, z);
  g.add(shade);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, shadeY0 - baseY, 12), darkWood);
  base.position.set(x, (baseY + shadeY0) / 2, z);
  g.add(base);
  if (light) {
    const l = new THREE.PointLight(0xffc98a, 2.5, 6, 1.5);
    l.position.set(x, shadeY0 + 0.05, z);
    g.add(l);
  }
}

// =============================================================================
export function buildApartment() {
  const g = new THREE.Group();
  g.name = 'Wohnung';
  const L = M.living, K = M.kitchen, HL = M.hall;
  const inN = L.z0 + T / 2, inS = L.z1 - T / 2, inW = L.x0 + T / 2, inE = L.x1 - T / 2;

  // ---- Böden, Decken ----
  floorAndCeiling(g, L.x0, L.x1, L.z0, L.z1, 0);
  floorAndCeiling(g, L.x1, K.x1, L.z0, K.z1, 0.001);
  floorAndCeiling(g, HL.x0, HL.x1, L.z1, HL.z1, 0.002);

  // ---- Wände ----
  // Wohnzimmer
  wallRun(g, L.x0, L.z0, L.x1, L.z0);                                                   // Nord (Fenster)
  wallRun(g, L.x0, L.z1, L.x1, L.z1, [{ from: M.hallDoor.x0 - L.x0, to: M.hallDoor.x1 - L.x0 }]); // Süd
  wallRun(g, L.x0, L.z0, L.x0, L.z1, [{ from: M.balconyDoor.z0 - L.z0, to: M.balconyDoor.z1 - L.z0, top: 2.1 }]); // West
  wallRun(g, L.x1, L.z0, L.x1, L.z1, [{ from: M.kitchenDoor.z0 - L.z0, to: M.kitchenDoor.z1 - L.z0 }]); // Ost / Küche
  // Küche
  wallRun(g, L.x1, L.z0, K.x1, L.z0);
  wallRun(g, K.x1, L.z0, K.x1, K.z1);
  wallRun(g, L.x1, K.z1, K.x1, K.z1);
  // Flurstück
  wallRun(g, HL.x0, L.z1, HL.x0, HL.z1);
  wallRun(g, HL.x1, L.z1, HL.x1, HL.z1);
  wallRun(g, HL.x0, HL.z1, HL.x1, HL.z1);

  // Türzargen + Balkontür-Glas
  doorFrame(g, 'x', L.z1, M.hallDoor.x0, M.hallDoor.x1);
  doorFrame(g, 'z', L.x1, M.kitchenDoor.z0, M.kitchenDoor.z1);
  doorFrame(g, 'z', L.x0, M.balconyDoor.z0, M.balconyDoor.z1, 2.1);
  box(g, glass, L.x0 - 0.01, L.x0 + 0.01, 0, 2.1, M.balconyDoor.z0, M.balconyDoor.z1);

  // ======================= Essbereich (Foto 1) =======================
  // Esstisch (Holz, Längsseite Nord-Süd) mit 4 hellen Stühlen
  box(g, wood, 0.35, 1.25, 0.72, 0.76, inN + 0.3, inN + 2.1);
  box(g, darkMetal, 0.75, 0.85, 0, 0.72, inN + 0.55, inN + 0.65);
  box(g, darkMetal, 0.75, 0.85, 0, 0.72, inN + 1.75, inN + 1.85);
  chair(g, 1.55, inN + 0.75, Math.PI / 2, fabricLight);
  chair(g, 1.55, inN + 1.65, Math.PI / 2, fabricLight);
  chair(g, 0.05, inN + 0.75, -Math.PI / 2, fabricLight);
  chair(g, 0.05, inN + 1.65, -Math.PI / 2, fabricLight);
  // Fenster mit weissem Vorhang über dem Tisch
  curtain(g, 'x', inN + 0.04, -0.1, 1.9, 0.95, 2.38);
  // Rattan-Schrank in der Ecke + Tischlampe + Baumbild
  box(g, rattan, 2.05, inE, 0, 0.82, inN, inN + 0.42);
  lamp(g, 2.45, inN + 0.2, 0.82, 1.12, 1.36);
  box(g, mat(0xc9a875), 2.2, 2.75, 1.5, 2.2, inN, inN + 0.03);
  box(g, mat(0xd9c6a8), 2.24, 2.71, 1.54, 2.16, inN + 0.03, inN + 0.035);
  // Dunkle Holzkommode an der Ostwand, runder Spiegel, Hundenapf
  const sbZ0 = M.kitchenDoor.z1 + 0.15, sbZ1 = inS - 0.75;   // zwischen Küchentür und Flurtür-Ecke
  box(g, darkWood, inE - 0.45, inE, 0.12, 0.9, sbZ0, sbZ1);
  box(g, darkMetal, inE - 0.43, inE - 0.4, 0, 0.12, sbZ0 + 0.02, sbZ0 + 0.05);
  box(g, darkMetal, inE - 0.43, inE - 0.4, 0, 0.12, sbZ1 - 0.05, sbZ1 - 0.02);
  const mz = (sbZ0 + sbZ1) / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 40).rotateZ(Math.PI / 2), darkMetal);
  rim.position.set(inE - 0.015, 1.7, mz);
  g.add(rim);
  const mirror = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.01, 40).rotateZ(Math.PI / 2),
    mat(0xcfd6dc, { metalness: 0.9, roughness: 0.05 }));
  mirror.position.set(inE - 0.03, 1.7, mz);
  g.add(mirror);
  box(g, white, inE - 0.32, inE - 0.05, 0, 0.22, sbZ1 + 0.1, sbZ1 + 0.5);

  // ======================= Wohnbereich (Fotos 2–4) =======================
  // Südwand: weisses Sideboard mit lila LED + grosses weisses Bild
  // (alle x-Werte relativ zur Westwand inW, damit der Wohnbereich mit der Raumbreite mitwandert)
  const w = (dx) => inW + dx;
  box(g, white, w(2.34), w(3.94), 0, 0.85, inS - 0.42, inS);
  box(g, glow(0xc040ff, 2.5), w(2.44), w(3.84), 0.86, 0.88, inS - 0.06, inS - 0.02);
  box(g, mat(0xd2bf9c), w(2.49), w(3.79), 1.05, 1.95, inS - 0.04, inS);
  box(g, mat(0xf1ece4), w(2.53), w(3.75), 1.09, 1.91, inS - 0.045, inS - 0.04);
  // Holzlamellen-Wand mit TV-Board und Fernseher
  box(g, texMat(slatTex, 1.2 / 0.045, 1), w(0.94), w(2.14), 0.45, H, inS - 0.03, inS);
  box(g, white, w(0.04), w(2.19), 0, 0.42, inS - 0.4, inS);
  box(g, darkMetal, w(1.34), w(1.74), 0.42, 0.45, inS - 0.3, inS - 0.15);
  box(g, mat(0x111111, { roughness: 0.2 }), w(0.82), w(2.26), 0.5, 1.33, inS - 0.25, inS - 0.21);
  box(g, glow(0x5a7da0, 0.6), w(0.86), w(2.22), 0.53, 1.3, inS - 0.255, inS - 0.25);
  // Blumenbild rechts neben der Lamellenwand
  box(g, mat(0xc9a875), w(0.19), w(0.84), 1.0, 2.15, inS - 0.03, inS);
  box(g, mat(0xe2d3bb), w(0.23), w(0.8), 1.04, 2.11, inS - 0.035, inS - 0.03);
  // Ledersofa an der Nordwand, Blick zum TV
  box(g, leather, w(0.19), w(2.64), 0, 0.42, inN, inN + 0.95);
  box(g, leather, w(0.19), w(2.64), 0.42, 0.88, inN, inN + 0.25);
  box(g, leather, w(0.19), w(0.42), 0.42, 0.62, inN, inN + 0.95);
  box(g, leather, w(2.41), w(2.64), 0.42, 0.62, inN, inN + 0.95);
  box(g, mat(0xe4d7c9), w(1.99), w(2.34), 0.42, 0.75, inN + 0.25, inN + 0.4);
  // Teppich, Hundebett, Stehlampe
  box(g, mat(0xcdbfa8, { roughness: 1 }), w(0.54), w(2.34), 0.003, 0.013, inN + 1.05, inS - 0.45);
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.15, 24), mat(0x9bb08c));
  bed.position.set(w(2.95), 0.075, inN + 1.25);
  g.add(bed);
  lamp(g, w(0.34), inN + 1.1, 0, 1.35, 1.62);
  // Vorhänge: weiss an der Nordwand (bodenlang), braun an der Westwand
  curtain(g, 'x', inN + 0.04, inW, w(3.34), 0.02, 2.38);
  curtain(g, 'z', inW + 0.04, M.balconyDoor.z1 + 0.05, 0.6, 0.02, 2.38, curtainTex, 0x9a7a5e);
  curtain(g, 'z', inW + 0.04, inN, M.balconyDoor.z0 - 0.05, 0.02, 2.38);

  // ======================= Küche (Fotos 5–11) =======================
  const kW = L.x1 + T / 2, kE = K.x1 - T / 2, kN = L.z0 + T / 2, kS = K.z1 - T / 2;
  // Kühlschrank (Edelstahl) links neben der Tür, Fenster rechts davon
  box(g, steel, kW, kW + 0.65, 0, 1.85, kN, kN + 0.65);
  box(g, mat(0x111111), kW + 0.651, kW + 0.66, 1.0, 1.25, kN + 0.25, kN + 0.42);
  curtain(g, 'x', kN + 0.04, kW + 0.75, kW + 1.6, 0.95, 2.38);
  // Hochschrank (schwarz/weiss) rechts von der Tür
  box(g, mat(0x151515, { roughness: 0.2 }), kW, kW + 0.6, 0, 1.85, kS - 0.6, kS);
  box(g, white, kW, kW + 0.6, 1.85, 2.4, kS - 0.6, kS);
  // Küchenzeile an der Südwand: Unterschränke, Granit, Spüle, Herd, Oberschränke
  box(g, white, kW + 0.6, kE - 0.6, 0, 0.86, kS - 0.6, kS);
  box(g, granite, kW + 0.6, kE - 0.6, 0.86, 0.9, kS - 0.62, kS);
  box(g, mat(0x111111, { roughness: 0.2 }), kW + 1.3, kW + 1.9, 0.08, 0.84, kS - 0.61, kS - 0.6); // Geschirrspüler
  box(g, steel, kW + 1.95, kW + 2.75, 0.9, 0.905, kS - 0.52, kS - 0.12);                          // Spüle
  box(g, mat(0x0d0d0d, { roughness: 0.15 }), kE - 1.35, kE - 0.75, 0.9, 0.905, kS - 0.55, kS - 0.05); // Kochfeld
  box(g, mat(0x111111, { roughness: 0.2 }), kE - 1.35, kE - 0.75, 0.1, 0.8, kS - 0.61, kS - 0.6);     // Backofen
  box(g, white, kW + 0.6, kE - 0.6, 1.45, 2.3, kS - 0.35, kS);
  box(g, mat(0x111111), kE - 1.35, kE - 0.75, 1.36, 1.45, kS - 0.4, kS);                          // Dunstabzug
  // Esstisch weiss an der Nordwand mit 3 dunklen Stühlen + Bildschirm
  box(g, white, kW + 1.7, kW + 2.9, 0.72, 0.75, kN, kN + 0.75);
  box(g, white, kW + 1.72, kW + 1.76, 0, 0.72, kN + 0.68, kN + 0.72);
  box(g, white, kW + 2.84, kW + 2.88, 0, 0.72, kN + 0.68, kN + 0.72);
  box(g, mat(0x111111), kW + 1.95, kW + 2.55, 0.8, 1.15, kN + 0.08, kN + 0.11);
  chair(g, kW + 1.95, kN + 1.0, 0, fabricDark);
  chair(g, kW + 2.6, kN + 1.0, 0, fabricDark);
  chair(g, kW + 3.15, kN + 0.4, Math.PI / 2, fabricDark);
  // Ostwand: Fenster mit Vorhang, weisses Sideboard, Mülleimer
  curtain(g, 'z', kE - 0.04, kN + 0.2, kN + 1.7, 0.95, 2.38);
  box(g, white, kE - 0.45, kE, 0, 0.85, kN + 0.3, kN + 1.6);
  box(g, steel, kE - 0.4, kE - 0.05, 0, 0.65, kN + 1.7, kN + 2.0);
  // Neonröhre an der Decke + Licht
  box(g, glow(0xffffff, 2), kW + 1.6, kW + 2.8, H - 0.07, H - 0.03, kN + 1.2, kN + 1.28);
  const kl = new THREE.PointLight(0xf2f6ff, 1.5, 7, 1.2);
  kl.position.set(kW + 2.2, H - 0.8, kN + 1.3);
  g.add(kl);

  return g;
}
