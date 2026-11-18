import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildApartment, SPAWN as HOME_SPAWN } from './apartment.js';

// ---- Konfiguration ----------------------------------------------------------
const CONFIG = {
  // Dein 3D-Scan als GLB (Massstab in Metern). Überschreibbar per URL: ?model=pfad/zu/datei.glb
  modelUrl: 'models/wohnung.glb',
  // Startpunkt im Modell in Metern + Blickrichtung in Grad (0 = Richtung -Z, 90 = nach links gedreht).
  // null = Mitte des Modells. Tipp: am Desktop an die Stelle laufen und "P" drücken.
  spawn: null,
  // Modell so verschieben, dass sein tiefster Punkt (der Boden) auf y = 0 liegt.
  dropToFloor: true,
  moveSpeed: 1.5,   // m/s für Gleiten (Stick / WASD)
  snapTurnDeg: 30,
  eyeHeight: 1.6,   // nur Desktop
};


const UP = new THREE.Vector3(0, 1, 0);
const statusEl = document.getElementById('status');
const xrInfoEl = document.getElementById('xrinfo');
const setStatus = (t) => { statusEl.textContent = t; };

// ---- Szene ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x1d2026);
scene.background = BG;
// Realistischere Beleuchtung ohne Laufzeitkosten: Tonemapping + einmalig vorberechnete Umgebung (Reflexionen)
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xfff4e6, 0xb8b0a4, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(3, 6, 2);
scene.add(sun);

// Der "Rig" ist der Spieler: Kamera + Controller hängen daran. Teleport/Drehen bewegt den Rig.
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
rig.add(camera);

const apartment = new THREE.Group();
scene.add(apartment);
let spawn = { ...HOME_SPAWN };
window.wohnung = { scene, rig, camera, renderer };   // zum Debuggen in der Browser-Konsole
let alignRequested = false;
let pendingTeleport = null;

// ---- Modell laden -----------------------------------------------------------
const loader = new GLTFLoader();

function setApartment(object, spawnCfg, label) {
  apartment.clear();
  if (CONFIG.dropToFloor) {
    const box = new THREE.Box3().setFromObject(object);
    if (Number.isFinite(box.min.y)) object.position.y -= box.min.y;
  }
  apartment.add(object);
  if (spawnCfg) {
    spawn = { ...spawnCfg };
  } else {
    const c = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    spawn = { x: c.x, z: c.z, yaw: 0 };
  }
  placeAtSpawn();
  setStatus(label);
}

async function loadFromUrl(url, label) {
  setStatus('Lade Modell …');
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total) setStatus(`Lade Modell … ${Math.round((e.loaded / e.total) * 100)} %`);
  });
  setApartment(gltf.scene, CONFIG.spawn, `Modell geladen: ${label}`);
}

async function loadFile(file) {
  const url = URL.createObjectURL(file);
  try {
    await loadFromUrl(url, file.name);
  } catch (err) {
    setStatus('Fehler beim Laden: ' + err.message);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const modelUrl = new URLSearchParams(location.search).get('model') || CONFIG.modelUrl;
loadFromUrl(modelUrl, modelUrl).catch((err) => {
  console.warn(err);
  setApartment(buildApartment(), HOME_SPAWN,
    'Wohnzimmer + Küche (aus Fotos nachgebaut, Masse geschätzt – siehe apartment.js).\n' +
    `Ein echter 3D-Scan unter ${CONFIG.modelUrl} oder per „GLB laden" ersetzt dieses Modell.`);
});

document.getElementById('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadFile(f);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// ---- XR-Sessions ------------------------------------------------------------
const btnVR = document.getElementById('btn-vr');
const btnAR = document.getElementById('btn-ar');

async function setupButtons() {
  if (!navigator.xr) {
    xrInfoEl.textContent = window.isSecureContext
      ? 'Dieser Browser unterstützt kein WebXR. Öffne die Seite im Browser deiner VR-Brille.'
      : 'WebXR braucht HTTPS (z. B. GitHub Pages) oder localhost.';
    return;
  }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  btnVR.disabled = !vr;
  btnAR.disabled = !ar;
  if (!vr && !ar) xrInfoEl.textContent = 'Kein VR-Gerät gefunden – Desktop-Modus aktiv.';
}
setupButtons();
btnVR.onclick = () => startSession('immersive-vr');
btnAR.onclick = () => startSession('immersive-ar');

async function startSession(mode) {
  try {
    const session = await navigator.xr.requestSession(mode, {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });
    session.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(session);
    if (mode === 'immersive-ar') {
      scene.background = null;   // Passthrough sichtbar
      setXRay(true);             // Modell halbtransparent über der echten Wohnung
    }
    alignRequested = true;       // im ersten Frame an den Startpunkt setzen
  } catch (err) {
    xrInfoEl.textContent = 'XR konnte nicht gestartet werden: ' + err.message;
  }
}

function onSessionEnd() {
  scene.background = BG;
  setXRay(false);
  for (const c of controllers) c.userData.selecting = false;
  marker.visible = false;
  placeAtSpawn();
}

function setXRay(on) {
  apartment.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (on) {
        m.userData.orig ??= { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
        Object.assign(m, { transparent: true, opacity: 0.35, depthWrite: false });
      } else if (m.userData.orig) {
        Object.assign(m, m.userData.orig);
        delete m.userData.orig;
      }
      m.needsUpdate = true;
    }
  });
}

// ---- Controller -------------------------------------------------------------
const controllerFactory = new XRControllerModelFactory();
const controllers = [];
const rayGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);

for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(rayGeom, new THREE.LineBasicMaterial({ color: 0x88aaff }));
  line.scale.z = 6;
  line.visible = false;
  c.add(line);
  c.userData.line = line;
  c.addEventListener('selectstart', () => { c.userData.selecting = true; });
  c.addEventListener('selectend', () => {
    c.userData.selecting = false;
    if (c.userData.target) pendingTeleport = c.userData.target.clone();
    c.userData.target = null;
  });
  c.addEventListener('squeezestart', () => { alignRequested = true; });
  rig.add(c);
  controllers.push(c);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  rig.add(grip);
}

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4fc3ff }));
marker.visible = false;
scene.add(marker);

// ---- Bewegung ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();
const tmpN = new THREE.Vector3();
let snapLatched = false;

// Kopfposition + Blickrichtung (Yaw) in Weltkoordinaten
function getHeadPose(frame) {
  const m = new THREE.Matrix4();
  rig.updateMatrixWorld(true);
  if (frame) {
    const vp = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (!vp) return null;
    m.fromArray(vp.transform.matrix).premultiply(rig.matrixWorld);
  } else {
    m.copy(camera.matrixWorld);
  }
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
  return { pos, yaw: Math.atan2(-dir.x, -dir.z) };
}

const forwardOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

// Rig um einen Weltpunkt (meist den Kopf) um die Hochachse drehen
function rotateRigAround(p, delta) {
  const off = rig.position.clone().sub(p);
  off.y = 0;
  off.applyAxisAngle(UP, delta);
  rig.position.set(p.x + off.x, rig.position.y, p.z + off.z);
  rig.rotation.y += delta;
}

// Rig so verschieben/drehen, dass der Kopf genau am Startpunkt steht und in dessen Richtung schaut.
// Steht man dabei physisch am echten Startpunkt, deckt sich das Modell mit der echten Wohnung.
function alignToSpawn(head) {
  rotateRigAround(head.pos, THREE.MathUtils.degToRad(spawn.yaw) - head.yaw);
  rig.position.x += spawn.x - head.pos.x;
  rig.position.z += spawn.z - head.pos.z;
  rig.position.y = 0;
}

function placeAtSpawn() {
  if (renderer.xr.isPresenting) { alignRequested = true; return; }
  rig.position.set(spawn.x, 0, spawn.z);
  rig.rotation.set(0, THREE.MathUtils.degToRad(spawn.yaw), 0);
  camera.position.set(0, CONFIG.eyeHeight, 0);
  camera.rotation.set(0, 0, 0);
}

function xrUpdate(frame, dt) {
  const head = getHeadPose(frame);
  if (!head) return;

  if (alignRequested) { alignRequested = false; alignToSpawn(head); return; }
  if (pendingTeleport) {
    const p = pendingTeleport;
    pendingTeleport = null;
    rig.position.x += p.x - head.pos.x;
    rig.position.z += p.z - head.pos.z;
    rig.position.y = p.y;
    return;
  }

  // Thumbsticks: links gleiten, rechts Snap-Turn
  for (const src of renderer.xr.getSession().inputSources) {
    const gp = src.gamepad;
    if (!gp || gp.axes.length < 4) continue;
    const x = gp.axes[2], y = gp.axes[3];
    if (src.handedness === 'left') {
      if (Math.hypot(x, y) > 0.15) {
        const s = CONFIG.moveSpeed * dt;
        rig.position.addScaledVector(rightOf(head.yaw), x * s).addScaledVector(forwardOf(head.yaw), -y * s);
      }
    } else if (src.handedness === 'right') {
      if (!snapLatched && Math.abs(x) > 0.7) {
        rotateRigAround(head.pos, -Math.sign(x) * THREE.MathUtils.degToRad(CONFIG.snapTurnDeg));
        snapLatched = true;
      } else if (Math.abs(x) < 0.3) {
        snapLatched = false;
      }
    }
  }

  // Teleport zielen: nur auf (annähernd) waagrechte Flächen
  marker.visible = false;
  for (const c of controllers) {
    c.userData.line.visible = !!c.userData.selecting;
    c.userData.target = null;
    if (!c.userData.selecting) continue;
    tmpMat.identity().extractRotation(c.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const hit = raycaster.intersectObject(apartment, true)[0];
    if (hit && hit.face) {
      tmpN.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (tmpN.y > 0.7) {
        c.userData.target = hit.point.clone();
        marker.position.copy(hit.point).y += 0.01;
        marker.visible = true;
      }
    }
  }
}

// ---- Desktop-Steuerung ------------------------------------------------------
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) controls.lock();
});
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyP') printSpawn();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function desktopUpdate(dt) {
  if (!controls.isLocked) return;
  const k = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  const f = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  const r = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  if (!f && !r) return;
  const { yaw } = getHeadPose(null);
  const s = CONFIG.moveSpeed * (k('ShiftLeft', 'ShiftRight') ? 2.5 : 1) * dt;
  rig.position.addScaledVector(forwardOf(yaw), f * s).addScaledVector(rightOf(yaw), r * s);
}

function printSpawn() {
  if (renderer.xr.isPresenting) return;
  const h = getHeadPose(null);
  const s = `spawn: { x: ${h.pos.x.toFixed(2)}, z: ${h.pos.z.toFixed(2)}, yaw: ${Math.round(THREE.MathUtils.radToDeg(h.yaw))} },`;
  console.log(s);
  navigator.clipboard?.writeText(s).catch(() => {});
  setStatus('Aktuelle Position (in Zwischenablage kopiert):\n' + s + '\n→ in main.js bei CONFIG eintragen');
}

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- Loop -------------------------------------------------------------------
const clock = new THREE.Clock();
renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) {
    if (frame) xrUpdate(frame, dt);
  } else {
    desktopUpdate(dt);
  }
  renderer.render(scene, camera);
});
