import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildApartment, SPAWN as HOME_SPAWN } from './apartment.js';

// =============================================================================
//  Handy-Version: mit Touch-Joystick durch die Wohnung laufen.
//  Links: Joystick (erscheint dort, wo der Daumen aufsetzt) · Rechts: wischen = umsehen
// =============================================================================
const CONFIG = {
  modelUrl: 'models/wohnung.glb',   // überschreibbar per ?model=…
  eyeHeight: 1.6,
  radius: 0.22,                     // "Körperbreite" für die Kollision mit Wänden
  stepHeight: 0.3,                  // so hohe Stufen/Schwellen werden überstiegen
  speeds: [['langsam', 0.8], ['normal', 1.4], ['schnell', 2.5]],
  lookSpeed: 0.0045,                // rad pro Pixel Wischen
  stickRadius: 50,                  // px
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let statusTimer;
function setStatus(t, fadeAfterMs = 0) {
  statusEl.textContent = t;
  statusEl.classList.remove('fade');
  clearTimeout(statusTimer);
  if (fadeAfterMs) statusTimer = setTimeout(() => statusEl.classList.add('fade'), fadeAfterMs);
}

// ---- Szene (gleiche Beleuchtung wie die VR-Version) --------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xfff4e6, 0xb8b0a4, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(3, 6, 2);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
const apartment = new THREE.Group();
scene.add(apartment);

// Spieler: Füsse auf dem Boden, Blickrichtung als Yaw (Hochachse) + Pitch (hoch/runter)
const player = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
let spawn = { ...HOME_SPAWN };
window.wohnung = { scene, camera, renderer, player };   // zum Debuggen

// ---- Modell laden -----------------------------------------------------------
const loader = new GLTFLoader();
let bvhReady = null;   // nur für grosse Scans: beschleunigt die Kollisionsabfragen

async function accelerate(object) {
  try {
    bvhReady ??= import('https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js').then((bvh) => {
      THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
      THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;
    });
    await bvhReady;
    object.traverse((o) => { if (o.isMesh) o.geometry.computeBoundsTree(); });
  } catch (err) {
    console.warn('three-mesh-bvh nicht verfügbar, Kollision kann langsam sein', err);
  }
}

function setApartment(object, spawnCfg, label) {
  apartment.clear();
  const box = new THREE.Box3().setFromObject(object);
  if (Number.isFinite(box.min.y)) object.position.y -= box.min.y;   // Boden auf y = 0
  apartment.add(object);
  apartment.updateMatrixWorld(true);
  if (spawnCfg) {
    spawn = { ...spawnCfg };
  } else {
    const c = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    spawn = { x: c.x, z: c.z, yaw: 0 };
  }
  goToSpawn();
  setStatus(label, 5000);
}

async function loadFromUrl(url, label) {
  setStatus('Lade Modell …');
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total) setStatus(`Lade Modell … ${Math.round((e.loaded / e.total) * 100)} %`);
  });
  await accelerate(gltf.scene);
  setApartment(gltf.scene, null, `Scan geladen: ${label}`);
}

const modelUrl = new URLSearchParams(location.search).get('model') || CONFIG.modelUrl;
loadFromUrl(modelUrl, modelUrl).catch(() => {
  setApartment(buildApartment(), HOME_SPAWN, 'Wohnzimmer + Küche (aus Fotos nachgebaut)');
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  closeMenu();
  const url = URL.createObjectURL(f);
  try { await loadFromUrl(url, f.name); } catch (err) { setStatus('Fehler beim Laden: ' + err.message); }
  finally { URL.revokeObjectURL(url); }
});

function goToSpawn() {
  player.pos.set(spawn.x, 0, spawn.z);
  player.yaw = THREE.MathUtils.degToRad(spawn.yaw);
  player.pitch = 0;
  gyro.offset = null;   // Neige-Steuerung neu ausrichten
  snapToFloor();
}

// ---- Kollision --------------------------------------------------------------
const ray = new THREE.Raycaster();
const tmpO = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
let collide = true;

// Ist in Richtung dir (normiert, waagrecht) innerhalb von dist + Körperradius eine Wand?
function blocked(dir, dist) {
  if (!collide) return false;
  ray.far = dist + CONFIG.radius;
  for (const h of [CONFIG.stepHeight + 0.05, 1.0, 1.7]) {
    tmpO.copy(player.pos).y += h;
    ray.set(tmpO, dir);
    if (ray.intersectObject(apartment, true).length) return true;
  }
  return false;
}

// Füsse auf den Boden darunter setzen (für Scans mit unebenem Boden, Schwellen, Stufen)
function snapToFloor() {
  tmpO.copy(player.pos).y += CONFIG.stepHeight;
  ray.set(tmpO, DOWN);
  ray.far = CONFIG.stepHeight + 1.5;
  for (const hit of ray.intersectObject(apartment, true)) {
    if (!hit.face) continue;
    tmpN.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (Math.abs(tmpN.y) > 0.6) { player.pos.y = hit.point.y; return; }
  }
}

const stepDir = new THREE.Vector3();
function move(dx, dz) {
  // Getrennt nach x und z prüfen → an Wänden entlanggleiten statt stecken bleiben
  if (dx) {
    stepDir.set(Math.sign(dx), 0, 0);
    if (!blocked(stepDir, Math.abs(dx))) player.pos.x += dx;
  }
  if (dz) {
    stepDir.set(0, 0, Math.sign(dz));
    if (!blocked(stepDir, Math.abs(dz))) player.pos.z += dz;
  }
  snapToFloor();
}

// ---- Touch: Joystick links, Umsehen rechts ----------------------------------
const stickEl = $('stick'), knobEl = $('knob');
const stick = { id: null, cx: 0, cy: 0, x: 0, y: 0 };   // x/y: -1 … 1
const look = { id: null, lx: 0, ly: 0 };
let moved = false;

function placeStick(x, y) {
  stickEl.style.left = x + 'px';
  stickEl.style.top = y + 'px';
  stickEl.style.bottom = 'auto';
}
function resetStick() {
  stick.id = null;
  stick.x = stick.y = 0;
  knobEl.style.transform = '';
  stickEl.classList.remove('active');
  stickEl.style.left = stickEl.style.top = stickEl.style.bottom = '';
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  closeMenu();
  if (e.clientX < innerWidth * 0.45 && stick.id === null) {
    stick.id = e.pointerId;
    stick.cx = e.clientX;
    stick.cy = e.clientY;
    placeStick(e.clientX, e.clientY);
    stickEl.classList.add('active');
  } else if (look.id === null) {
    look.id = e.pointerId;
    look.lx = e.clientX;
    look.ly = e.clientY;
  } else {
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
    const d = Math.hypot(dx, dy), R = CONFIG.stickRadius;
    if (d > R) { dx *= R / d; dy *= R / d; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.x = dx / R;
    stick.y = dy / R;
  } else if (e.pointerId === look.id) {
    const dx = e.clientX - look.lx, dy = e.clientY - look.ly;
    look.lx = e.clientX;
    look.ly = e.clientY;
    if (gyro.on) { if (gyro.offset !== null) gyro.offset += dx * CONFIG.lookSpeed; return; }
    player.yaw += dx * CONFIG.lookSpeed;
    player.pitch = THREE.MathUtils.clamp(player.pitch + dy * CONFIG.lookSpeed, -1.4, 1.4);
  }
});

function release(e) {
  if (e.pointerId === stick.id) resetStick();
  if (e.pointerId === look.id) look.id = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Tastatur zum Testen am PC
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---- Umsehen durch Neigen des Handys (Gyroskop) -----------------------------
const gyro = { on: false, q: null, offset: null };
const gyroEuler = new THREE.Euler();
const gyroQ = new THREE.Quaternion();
const Q_CAM = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // Kamera schaut aus der Rückseite
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

function onOrientation(e) {
  if (e.alpha == null) return;
  const d = THREE.MathUtils.degToRad;
  const orient = d(screen.orientation?.angle ?? window.orientation ?? 0);
  gyroEuler.set(d(e.beta), d(e.alpha), -d(e.gamma), 'YXZ');
  gyroQ.setFromEuler(gyroEuler).multiply(Q_CAM).multiply(tmpQ.setFromAxisAngle(Z_AXIS, -orient));
  gyro.q = gyroQ;
}

async function toggleGyro() {
  if (!gyro.on) {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) { setStatus('Dieses Gerät hat keinen Lagesensor.', 4000); return; }
    if (typeof DOE.requestPermission === 'function') {   // iPhone
      try {
        if (await DOE.requestPermission() !== 'granted') { setStatus('Zugriff auf den Lagesensor verweigert.', 4000); return; }
      } catch (err) { setStatus('Lagesensor: ' + err.message, 4000); return; }
    }
    addEventListener('deviceorientation', onOrientation);
    gyro.on = true;
    gyro.offset = null;
    player.pitch = 0;
  } else {
    removeEventListener('deviceorientation', onOrientation);
    gyro.on = false;
    gyro.q = null;
    player.yaw = lastYaw;   // aktuelle Blickrichtung übernehmen
    player.pitch = 0;
  }
  setOpt('opt-gyro', gyro.on ? 'an' : 'aus');
}

// Gyro-Richtung → Yaw-Winkel der Blickrichtung
const fwd = new THREE.Vector3();
const yawOfQuat = (q) => { fwd.set(0, 0, -1).applyQuaternion(q); return Math.atan2(-fwd.x, -fwd.z); };

// ---- Menü -------------------------------------------------------------------
const menuEl = $('menu');
const closeMenu = () => menuEl.classList.remove('open');
const setOpt = (id, v) => { $(id).querySelector('.val').textContent = v; };
$('btn-menu').onclick = () => menuEl.classList.toggle('open');

$('opt-collide').onclick = () => { collide = !collide; setOpt('opt-collide', collide ? 'an' : 'aus'); };
$('opt-gyro').onclick = toggleGyro;
let speedIdx = 1;
$('opt-speed').onclick = () => {
  speedIdx = (speedIdx + 1) % CONFIG.speeds.length;
  setOpt('opt-speed', CONFIG.speeds[speedIdx][0]);
};
$('opt-spawn').onclick = () => { goToSpawn(); closeMenu(); };

const fsBtn = $('btn-full');
const root = document.documentElement;
const fsRequest = root.requestFullscreen || root.webkitRequestFullscreen;
if (!fsRequest) fsBtn.style.display = 'none';   // z. B. iPhone: stattdessen "Zum Home-Bildschirm"
fsBtn.onclick = () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    fsRequest.call(root).catch?.(() => {});
  }
};

// ---- Loop -------------------------------------------------------------------
function resize() {
  camera.aspect = innerWidth / innerHeight;
  // Hochformat: Sichtfeld weiter machen, sonst wirkt alles wie durchs Schlüsselloch
  const hfov = THREE.MathUtils.degToRad(80);
  camera.fov = Math.min(95, Math.max(70, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect))));
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();
addEventListener('orientationchange', () => setTimeout(resize, 200));

const forwardOf = (yaw, v) => v.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const fwdV = new THREE.Vector3(), rightV = new THREE.Vector3();
const yawQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let lastYaw = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);

  // Eingabe sammeln: Joystick oder Tastatur
  let ix = stick.x, iy = -stick.y;
  const k = (...c) => (c.some((x) => keys.has(x)) ? 1 : 0);
  ix += k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  iy += k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  if (!gyro.on) player.yaw -= (k('KeyE') - k('KeyQ')) * 1.8 * dt;
  let mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }

  // Blickrichtung
  let yaw = player.yaw;
  if (gyro.on && gyro.q) {
    if (gyro.offset === null) gyro.offset = player.yaw - yawOfQuat(gyro.q);
    // offset = Drehung von Wischen + Ausrichtung beim Einschalten
    camera.quaternion.copy(yawQ.setFromAxisAngle(UP, gyro.offset)).multiply(gyro.q);
    yaw = yawOfQuat(camera.quaternion);
  } else {
    camera.rotation.set(-player.pitch, player.yaw, 0);
  }

  lastYaw = yaw;

  if (mag > 0.12) {
    const s = CONFIG.speeds[speedIdx][1] * dt;   // Tempo wächst mit dem Joystick-Ausschlag
    forwardOf(yaw, fwdV);
    rightV.set(-fwdV.z, 0, fwdV.x);
    move((fwdV.x * iy + rightV.x * ix) * s, (fwdV.z * iy + rightV.z * ix) * s);
    if (!moved) { moved = true; $('help').classList.add('fade'); }
  }

  camera.position.copy(player.pos).y += CONFIG.eyeHeight;
  renderer.render(scene, camera);
});
