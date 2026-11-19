// Procedural 3D lunar alien bio-horrors for Lunar Siege mode.
// Built for stark lunar lighting (bloom > 1.1 luminance on eyes, pustules & weakpoints)
// and high FPS on integrated GPUs: shared procedural organic CanvasTextures (albedo,
// bump, roughness, alpha-cutout membranes), shared deformed geometries, minimal shadows,
// instanced lunar-gravity droplet bursts, and articulated procedural gaits.

import * as THREE from 'three';
import { heightAt } from '../world/heightfield';
import { sfx, type Sfx } from '../audio/audio';

export type AlienKind =
  | 'stalker'
  | 'burrower'
  | 'flyer'
  | 'spitter'
  | 'boss_broodmother'
  | 'boss_leviathan'
  | 'boss_apex';

export interface AlienProjectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dmg: number;
  life: number;
  mesh: THREE.Mesh;
}

export interface AlienHitResult {
  alien: Alien;
  weakpoint: boolean;
  point: THREE.Vector3;
  distance: number;
}

export interface AlienUpdateCtx {
  dt: number;
  now: number;
  playerPos: THREE.Vector3;
  playerEye: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  inRover: boolean;
  roverPos: THREE.Vector3;
  roverSpeed: number;
  habInside: boolean;
  habCenter: THREE.Vector3;
  grabbedAlienId: number | null;
}

export interface Alien {
  readonly id: number;
  readonly kind: AlienKind;
  readonly isBoss: boolean;
  readonly isFlying: boolean;
  readonly nameKey: string;
  readonly root: THREE.Group;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  grabTaps: number;
  state: 'emerging' | 'chase' | 'grabbing' | 'stunned' | 'dying';
  pos: THREE.Vector3;
  slowTimer: number;
  stunTimer: number;
}

export interface AlienCallbacks {
  onGrabAttempt: (a: Alien) => void;
  onRangedHit: (dmg: number, pos: THREE.Vector3) => void;
  onBossSpawnMinion: (kind: AlienKind, x: number, z: number) => void;
  onRoverRam: (a: Alien, impactSpeed: number) => void;
  onShockwave: (dmg: number, dist: number) => void;
}

// Safe helper so audio calls compile cleanly regardless of audio.ts load order.
const playSfx = (name: string, strength = 1) => {
  try {
    sfx(name as Sfx, strength);
  } catch {
    // Audio context not ready yet
  }
};

const HAB_EXCLUSION_RADIUS = 7.2;
const PLAY_BOUND = 330;
const MAX_PARTICLES = 320;
const GRAV_LUNAR = -4.2;

const NAME_KEYS: Record<AlienKind, string> = {
  stalker: 'sg.alien.stalker',
  burrower: 'sg.alien.burrower',
  flyer: 'sg.alien.flyer',
  spitter: 'sg.alien.spitter',
  boss_broodmother: 'sg.boss.broodmother',
  boss_leviathan: 'sg.boss.leviathan',
  boss_apex: 'sg.boss.apex',
};

// Reusable scratch math objects (zero per-frame heap allocations)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _hitPt = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _col = new THREE.Color();

interface LegJoint {
  hip: THREE.Group;
  knee: THREE.Group;
  side: -1 | 1;
  index: number;
  baseHipY: number;
  baseHipZ: number;
  baseKneeZ: number;
  isFrontClaw?: boolean;
  isHindLeap?: boolean;
}

interface JawPiece {
  obj: THREE.Object3D;
  axis: 'y' | 'x';
  dir: number;
  base: number;
}

interface WingRig {
  leftInner: THREE.Group;
  leftOuter?: THREE.Group;
  rightInner: THREE.Group;
  rightOuter?: THREE.Group;
}

interface AlienRec extends Alien {
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  jaws: JawPiece[];
  tongue: THREE.Object3D | null;
  feelers: THREE.Object3D[];
  legs: LegJoint[];
  wings: WingRig | null;
  tentacles: THREE.Group[];
  pulseMeshes: THREE.Object3D[];
  weakpointAnchor: THREE.Object3D;
  carapaceMat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseEmissiveInt: number;
  ichorColor: [number, number, number];
  bodyCenterY: number;
  headFrontZ: number;

  vel: THREE.Vector3;
  knockVel: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  gaitPhase: number;
  seed: number;

  emergeT: number;
  emergeDur: number;
  emergeDepth: number;
  emergeDustTimer: number;

  flashTimer: number;
  flashCrit: boolean;
  deathTimer: number;
  deathDur: number;
  deathRollDir: number;

  ramCooldown: number;
  grabCooldown: number;
  attackCooldown: number;
  minionCooldown: number;
  diveTimer: number;
  diveCooldown: number;
  slamWindup: number;
  dustTrailTimer: number;

  orbitDir: -1 | 1;
  orbitAngle: number;
  flankAngle: number;
  flightAlt: number;
  airborne: boolean;
  tier: number;
  waveScale: number;
}

interface EruptionMound {
  group: THREE.Group;
  fissure: THREE.Mesh;
  tendrils: THREE.Group[];
  baseY: number;
  age: number;
  maxAge: number;
  scale: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  center: THREE.Vector3;
  radius: number;
  maxRadius: number;
  speed: number;
  dmg: number;
  hitPlayer: boolean;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  life: number;
  maxLife: number;
  gravity: number;
  r: number;
  g: number;
  b: number;
}

interface ProjRec extends AlienProjectile {
  gravity: number;
  trailTimer: number;
  color: [number, number, number];
}

// ============================================================================
// Procedural Disgusting Organic Canvas Textures (created once, shared)
// ============================================================================

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function wrapTex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function drawVeinBranch(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
  depth: number,
  color: string,
): void {
  if (depth <= 0 || len < 4) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x;
  let cy = y;
  let a = angle;
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    a += (rand() - 0.5) * 0.7;
    cx += Math.cos(a) * (len / steps);
    cy += Math.sin(a) * (len / steps);
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
  if (depth > 1) {
    drawVeinBranch(ctx, rand, cx, cy, a + 0.4 + rand() * 0.4, len * 0.68, width * 0.65, depth - 1, color);
    if (rand() < 0.72) {
      drawVeinBranch(ctx, rand, cx, cy, a - 0.4 - rand() * 0.4, len * 0.62, width * 0.6, depth - 1, color);
    }
  }
}

function createFleshTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 256;
  const rand = seededRand(99103);
  const [cMap, gMap] = makeCanvas(S);
  const [cBump, gBump] = makeCanvas(S);
  const [cRough, gRough] = makeCanvas(S);

  // Sickly bruised purplish-grey & rotting ochre base
  gMap.fillStyle = '#4a3843';
  gMap.fillRect(0, 0, S, S);
  gBump.fillStyle = '#808080';
  gBump.fillRect(0, 0, S, S);
  gRough.fillStyle = '#3c3c3c'; // wet base gloss
  gRough.fillRect(0, 0, S, S);

  // Mottled necrotic ochre, bruised purple, and raw bloody patches
  const blotches = ['#5c5538', '#3c2638', '#6e2836', '#4d4137', '#2f1f2b', '#75333d'];
  for (let i = 0; i < 85; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 12 + rand() * 34;
    const grad = gMap.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, blotches[Math.floor(rand() * blotches.length)]);
    grad.addColorStop(1, 'rgba(74,56,67,0)');
    gMap.fillStyle = grad;
    gMap.fillRect(x - r, y - r, r * 2, r * 2);

    const bGrad = gBump.createRadialGradient(x, y, 2, x, y, r);
    bGrad.addColorStop(0, rand() < 0.5 ? 'rgba(215,215,215,0.45)' : 'rgba(55,55,55,0.45)');
    bGrad.addColorStop(1, 'rgba(128,128,128,0)');
    gBump.fillStyle = bGrad;
    gBump.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Pulsing dark-purple & crimson blood vessels
  for (let i = 0; i < 18; i++) {
    const sx = rand() * S;
    const sy = rand() * S;
    const ang = rand() * Math.PI * 2;
    drawVeinBranch(gMap, rand, sx, sy, ang, 38 + rand() * 34, 2.2, 3, 'rgba(110, 14, 28, 0.72)');
    drawVeinBranch(gMap, rand, sx + 1, sy + 1, ang, 34 + rand() * 30, 1.1, 3, 'rgba(185, 32, 58, 0.55)');
    drawVeinBranch(gBump, rand, sx, sy, ang, 38 + rand() * 34, 2.6, 3, 'rgba(235, 235, 235, 0.7)');
  }

  // Pitted pores & glistening wet blisters
  for (let i = 0; i < 140; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 1.5 + rand() * 5.2;
    const isBlister = rand() < 0.35;
    gMap.beginPath();
    gMap.arc(x, y, r, 0, Math.PI * 2);
    gMap.fillStyle = isBlister ? 'rgba(135, 118, 64, 0.55)' : 'rgba(28, 12, 20, 0.52)';
    gMap.fill();

    gBump.beginPath();
    gBump.arc(x, y, r, 0, Math.PI * 2);
    gBump.fillStyle = isBlister ? 'rgba(248,248,248,0.8)' : 'rgba(28,28,28,0.75)';
    gBump.fill();

    // Very wet slime gloss around blisters
    gRough.beginPath();
    gRough.arc(x, y, r * 1.6, 0, Math.PI * 2);
    gRough.fillStyle = isBlister ? 'rgba(18,18,18,0.85)' : 'rgba(95,95,95,0.45)';
    gRough.fill();
  }

  // Wet slime drip streaks
  for (let i = 0; i < 28; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 22 + rand() * 65;
    gRough.strokeStyle = 'rgba(14,14,14,0.8)';
    gRough.lineWidth = 2 + rand() * 4;
    gRough.beginPath();
    gRough.moveTo(x, y);
    gRough.lineTo(x + (rand() - 0.5) * 10, y + h);
    gRough.stroke();
  }

  return {
    map: wrapTex(cMap, 2, 2, true),
    bumpMap: wrapTex(cBump, 2, 2, false),
    roughnessMap: wrapTex(cRough, 2, 2, false),
  };
}

function createChitinTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 256;
  const rand = seededRand(42077);
  const [cMap, gMap] = makeCanvas(S);
  const [cBump, gBump] = makeCanvas(S);
  const [cRough, gRough] = makeCanvas(S);

  // Dark scarred chitin base (tinted per archetype by material.color)
  gMap.fillStyle = '#a4aa9c';
  gMap.fillRect(0, 0, S, S);
  gBump.fillStyle = '#787878';
  gBump.fillRect(0, 0, S, S);
  gRough.fillStyle = '#585858';
  gRough.fillRect(0, 0, S, S);

  // Horizontal overlapping carapace plate bands + dirty bone-yellow edge wear
  for (let y = 0; y < S; y += 28) {
    const grad = gMap.createLinearGradient(0, y, 0, y + 28);
    grad.addColorStop(0, '#5a6054');
    grad.addColorStop(0.2, '#b6ba9e');
    grad.addColorStop(0.85, '#8c9484');
    grad.addColorStop(1, '#30342b');
    gMap.fillStyle = grad;
    gMap.fillRect(0, y, S, 28);

    const bGrad = gBump.createLinearGradient(0, y, 0, y + 28);
    bGrad.addColorStop(0, '#222222');
    bGrad.addColorStop(0.18, '#dcdcdc');
    bGrad.addColorStop(0.88, '#969696');
    bGrad.addColorStop(1, '#181818');
    gBump.fillStyle = bGrad;
    gBump.fillRect(0, y, S, 28);
  }

  // Cracked exoskeleton fractures with toxic yellow-green bile seams
  for (let i = 0; i < 24; i++) {
    const sx = rand() * S;
    const sy = rand() * S;
    const ang = rand() * Math.PI * 2;
    drawVeinBranch(gMap, rand, sx, sy, ang, 32 + rand() * 34, 2.4, 2, 'rgba(32, 34, 26, 0.85)');
    drawVeinBranch(gMap, rand, sx, sy, ang, 28 + rand() * 30, 0.9, 2, 'rgba(135, 185, 62, 0.65)');
    drawVeinBranch(gBump, rand, sx, sy, ang, 32 + rand() * 34, 2.6, 2, 'rgba(15, 15, 15, 0.9)');
  }

  // Scarred pits, chitin tubercles, and slime streaks
  for (let i = 0; i < 160; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 1 + rand() * 4;
    const raised = rand() < 0.45;
    gMap.beginPath();
    gMap.arc(x, y, r, 0, Math.PI * 2);
    gMap.fillStyle = raised ? 'rgba(195, 188, 145, 0.32)' : 'rgba(26, 30, 22, 0.45)';
    gMap.fill();

    gBump.beginPath();
    gBump.arc(x, y, r, 0, Math.PI * 2);
    gBump.fillStyle = raised ? 'rgba(240,240,240,0.75)' : 'rgba(24,24,24,0.75)';
    gBump.fill();
  }

  for (let i = 0; i < 36; i++) {
    const x = rand() * S;
    const y = rand() * S;
    gRough.strokeStyle = 'rgba(20,20,20,0.85)';
    gRough.lineWidth = 2 + rand() * 5;
    gRough.beginPath();
    gRough.moveTo(x, y);
    gRough.lineTo(x + (rand() - 0.5) * 14, y + 35 + rand() * 60);
    gRough.stroke();
  }

  return {
    map: wrapTex(cMap, 2, 2, true),
    bumpMap: wrapTex(cBump, 2, 2, false),
    roughnessMap: wrapTex(cRough, 2, 2, false),
  };
}

function createPustuleTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
} {
  const S = 256;
  const rand = seededRand(77419);
  const [cMap, gMap] = makeCanvas(S);
  const [cBump, gBump] = makeCanvas(S);
  const [cEm, gEm] = makeCanvas(S);

  gMap.fillStyle = '#c8c4a0';
  gMap.fillRect(0, 0, S, S);
  gBump.fillStyle = '#909090';
  gBump.fillRect(0, 0, S, S);
  gEm.fillStyle = '#909090';
  gEm.fillRect(0, 0, S, S);

  // Glowing translucent internal larval/pus pockets
  for (let i = 0; i < 55; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 8 + rand() * 24;
    const g1 = gEm.createRadialGradient(x, y, 1, x, y, r);
    g1.addColorStop(0, '#ffffff');
    g1.addColorStop(0.55, '#c8c8c8');
    g1.addColorStop(1, 'rgba(60,60,60,0)');
    gEm.fillStyle = g1;
    gEm.fillRect(x - r, y - r, r * 2, r * 2);

    const g2 = gBump.createRadialGradient(x, y, 1, x, y, r);
    g2.addColorStop(0, '#ffffff');
    g2.addColorStop(0.7, '#999999');
    g2.addColorStop(1, 'rgba(80,80,80,0)');
    gBump.fillStyle = g2;
    gBump.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Dark vascular web stretched over glowing pus sacs (blocks emissive along veins!)
  for (let i = 0; i < 24; i++) {
    const sx = rand() * S;
    const sy = rand() * S;
    const ang = rand() * Math.PI * 2;
    drawVeinBranch(gMap, rand, sx, sy, ang, 46 + rand() * 34, 2.5, 3, 'rgba(42, 12, 22, 0.88)');
    drawVeinBranch(gEm, rand, sx, sy, ang, 46 + rand() * 34, 3.0, 3, 'rgba(12, 12, 12, 0.92)');
    drawVeinBranch(gBump, rand, sx, sy, ang, 46 + rand() * 34, 2.8, 3, 'rgba(245, 245, 245, 0.78)');
  }

  return {
    map: wrapTex(cMap, 1, 1, true),
    bumpMap: wrapTex(cBump, 1, 1, false),
    emissiveMap: wrapTex(cEm, 1, 1, false),
  };
}

function createWingTextures(veinColor: string, glowColor: string): {
  map: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const S = 256;
  const rand = seededRand(veinColor.length * 1337 + 55);
  const [cMap, gMap] = makeCanvas(S);
  const [cAlpha, gAlpha] = makeCanvas(S);
  const [cBump, gBump] = makeCanvas(S);

  // Membrane base with darker necrotic rot along edges
  const bg = gMap.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#361a2e');
  bg.addColorStop(0.55, '#1d1228');
  bg.addColorStop(1, '#0e0814');
  gMap.fillStyle = bg;
  gMap.fillRect(0, 0, S, S);

  gAlpha.fillStyle = '#e0e0e0';
  gAlpha.fillRect(0, 0, S, S);
  gBump.fillStyle = '#707070';
  gBump.fillRect(0, 0, S, S);

  // Branching bloody/bioluminescent veins radiating across membrane
  for (let i = 0; i < 20; i++) {
    const sy = rand() * S;
    drawVeinBranch(gMap, rand, 0, sy, (rand() - 0.5) * 0.7, 90 + rand() * 80, 3.0, 3, veinColor);
    drawVeinBranch(gMap, rand, 0, sy, (rand() - 0.5) * 0.7, 85 + rand() * 70, 1.3, 3, glowColor);
    drawVeinBranch(gBump, rand, 0, sy, (rand() - 0.5) * 0.7, 90 + rand() * 80, 3.2, 3, '#f0f0f0');
  }

  // Torn rot holes punched cleanly into alphaMap with necrotic dark rims
  for (let i = 0; i < 16; i++) {
    const hx = 45 + rand() * (S - 65);
    const hy = 35 + rand() * (S - 70);
    const hr = 5 + rand() * 15;

    gMap.beginPath();
    gMap.arc(hx, hy, hr + 4, 0, Math.PI * 2);
    gMap.fillStyle = 'rgba(20, 6, 12, 0.9)';
    gMap.fill();

    gAlpha.beginPath();
    gAlpha.ellipse(hx, hy, hr, hr * (0.6 + rand() * 0.7), rand() * Math.PI, 0, Math.PI * 2);
    gAlpha.fillStyle = '#000000';
    gAlpha.fill();
  }

  return {
    map: wrapTex(cMap, 1, 1, true),
    alphaMap: wrapTex(cAlpha, 1, 1, false),
    bumpMap: wrapTex(cBump, 1, 1, false),
  };
}

function createFangTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(64);
  // Dirty yellowed ivory root -> stained crimson/green necrotic tip
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#5e1418'); // blood-stained tip
  grad.addColorStop(0.28, '#997a58');
  grad.addColorStop(0.68, '#d4cab0');
  grad.addColorStop(1, '#685947'); // filthy gum root
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Vertical enamel striations
  for (let x = 0; x < 64; x += 4) {
    g.fillStyle = x % 8 === 0 ? 'rgba(40,25,18,0.22)' : 'rgba(255,248,225,0.16)';
    g.fillRect(x, 0, 2, 64);
  }
  return wrapTex(c, 1, 1, true);
}

// ============================================================================
// Organic Geometry Builders (deformed, gnarled, shared across all aliens)
// ============================================================================

function perturbGeo(g: THREE.BufferGeometry, amp: number, freq: number): THREE.BufferGeometry {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * freq + y * (freq * 1.3)) * Math.cos(z * (freq * 1.1) - x * 2.7) * amp +
      Math.sin(z * freq * 2.1 + y * 5.3) * (amp * 0.45);
    const l = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / l) * n, y + (y / l) * n, z + (z / l) * n);
  }
  g.computeVertexNormals();
  return g;
}

function makeRibbedLathe(pts: [number, number][], segs: number, ribAmp = 0.028): THREE.BufferGeometry {
  const vecs = pts.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(vecs, segs);
  g.rotateX(Math.PI / 2); // align along local +Z forward
  return perturbGeo(g, ribAmp, 8.5);
}

function makeCurvedFangGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const segs = 6;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Curves inward slightly as it tapers to a needle point along +Z
    pts.push(new THREE.Vector3(-t * t * 0.08, -t * t * 0.05, t * 0.44));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 6, 0.05, 5, false);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, z / 0.44));
    const c = curve.getPoint(t);
    const taper = Math.pow(1 - t, 0.95);
    pos.setXYZ(
      i,
      c.x + (pos.getX(i) - c.x) * taper,
      c.y + (pos.getY(i) - c.y) * taper,
      c.z + (pos.getZ(i) - c.z) * taper,
    );
  }
  g.computeVertexNormals();
  return g;
}

function makeCurvedRibGeo(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.35, 0),
    new THREE.Vector3(0.45, 0.25, 0.04),
    new THREE.Vector3(0.62, -0.15, 0.08),
    new THREE.Vector3(0.32, -0.45, 0.05),
  ]);
  return new THREE.TubeGeometry(curve, 7, 0.055, 5, false);
}

function makeScytheGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.14, -0.05);
  s.quadraticCurveTo(0.32, -0.42, 0.06, -0.96);
  s.lineTo(-0.08, -1.18);
  // Serrated inner cutting edge
  s.lineTo(-0.01, -0.82);
  s.lineTo(-0.08, -0.72);
  s.lineTo(0.01, -0.48);
  s.lineTo(-0.07, -0.38);
  s.lineTo(-0.06, -0.1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -0.035);
  return g;
}

function makeWingGeo(span: number, chord: number, swept: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, chord * 0.48);
  s.quadraticCurveTo(span * 0.42, chord * 0.56, span, swept);
  // Deeply ragged, jagged bat-like trailing scallops
  s.lineTo(span * 0.84, swept - chord * 0.5);
  s.lineTo(span * 0.72, swept - chord * 0.14);
  s.lineTo(span * 0.56, -chord * 0.62);
  s.lineTo(span * 0.42, -chord * 0.18);
  s.lineTo(span * 0.26, -chord * 0.58);
  s.lineTo(span * 0.14, -chord * 0.2);
  s.lineTo(0, -chord * 0.45);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 5);
  // Normalize UVs cleanly into 0..1 so alpha-cutout & veins map cleanly across the wing!
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, x / Math.max(span, 0.1), (y + chord * 0.65) / Math.max(chord * 1.3, 0.1));
  }
  g.rotateX(-Math.PI / 2); // Extend along +X in XZ plane
  return g;
}

function makeCrestGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.28, 0.06);
  s.lineTo(0.14, 0.38);
  s.lineTo(0.02, 0.2);
  s.lineTo(-0.1, 0.48);
  s.lineTo(-0.24, 0.24);
  s.lineTo(-0.38, 0.44);
  s.lineTo(-0.48, 0.08);
  s.lineTo(-0.34, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.075, bevelEnabled: false });
  g.translate(0, 0, -0.0375);
  g.rotateY(-Math.PI / 2);
  return g;
}

function makeMoundRingGeo(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(1.06, 0.36, 6, 13);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 7.3 + z * 5.1) * 0.16 + Math.cos(z * 9.7 - x * 4.3) * 0.12;
    pos.setXYZ(i, x * (1 + n * 0.65), Math.max(-0.05, y * 0.78 + 0.2 + n * 0.6), z * (1 + n * 0.65));
  }
  g.computeVertexNormals();
  return g;
}

// ============================================================================
// Shared Assets Registry (initialized once)
// ============================================================================

interface SharedAssets {
  geo: {
    thorax: THREE.BufferGeometry;
    abdomen: THREE.BufferGeometry;
    head: THREE.BufferGeometry;
    fleshBelly: THREE.BufferGeometry;
    pustule: THREE.BufferGeometry;
    eye: THREE.BufferGeometry;
    fang: THREE.BufferGeometry;
    femur: THREE.BufferGeometry;
    tibia: THREE.BufferGeometry;
    spur: THREE.BufferGeometry;
    scythe: THREE.BufferGeometry;
    spine: THREE.BufferGeometry;
    rib: THREE.BufferGeometry;
    armorPlate: THREE.BufferGeometry;
    wingFlyer: THREE.BufferGeometry;
    wingLevInner: THREE.BufferGeometry;
    wingLevOuter: THREE.BufferGeometry;
    tentacle: THREE.BufferGeometry;
    tongue: THREE.BufferGeometry;
    crest: THREE.BufferGeometry;
    mawRing: THREE.BufferGeometry;
    moundRing: THREE.BufferGeometry;
    moundPit: THREE.BufferGeometry;
    moundFissure: THREE.BufferGeometry;
    moundRock: THREE.BufferGeometry;
    projCore: THREE.BufferGeometry;
    projHalo: THREE.BufferGeometry;
    shockRing: THREE.BufferGeometry;
    particle: THREE.BufferGeometry;
  };
  mat: {
    carapace: Record<AlienKind, THREE.MeshStandardMaterial>;
    fleshWet: THREE.MeshStandardMaterial;
    fleshBloody: THREE.MeshStandardMaterial;
    fleshBurrower: THREE.MeshStandardMaterial;
    mouthWet: THREE.MeshStandardMaterial;
    boneFang: THREE.MeshStandardMaterial;
    clawObsidian: THREE.MeshStandardMaterial;
    eyeCrimson: THREE.MeshStandardMaterial;
    eyeSickly: THREE.MeshStandardMaterial;
    eyeAmber: THREE.MeshStandardMaterial;
    eyeCyan: THREE.MeshStandardMaterial;
    eyeGold: THREE.MeshStandardMaterial;
    eyeViolet: THREE.MeshStandardMaterial;
    pustuleAcid: THREE.MeshStandardMaterial;
    pustuleViolet: THREE.MeshStandardMaterial;
    pustuleAmber: THREE.MeshStandardMaterial;
    pustuleMagenta: THREE.MeshStandardMaterial;
    pustuleEmerald: THREE.MeshStandardMaterial;
    eggOrange: THREE.MeshStandardMaterial;
    eggOuterMembrane: THREE.MeshStandardMaterial;
    coreViolet: THREE.MeshStandardMaterial;
    crestGoldRed: THREE.MeshStandardMaterial;
    wingFlyer: THREE.MeshStandardMaterial;
    wingLeviathan: THREE.MeshStandardMaterial;
    moundRegolith: THREE.MeshStandardMaterial;
    moundPit: THREE.MeshBasicMaterial;
    moundFissure: THREE.MeshBasicMaterial;
    projAcid: THREE.MeshBasicMaterial;
    projPlasma: THREE.MeshBasicMaterial;
    projViolet: THREE.MeshBasicMaterial;
    projHaloAcid: THREE.MeshBasicMaterial;
    projHaloCyan: THREE.MeshBasicMaterial;
    projHaloViolet: THREE.MeshBasicMaterial;
    particle: THREE.MeshBasicMaterial;
  };
}

let _assets: SharedAssets | null = null;

function getAssets(): SharedAssets {
  if (_assets) return _assets;

  const flesh = createFleshTextures();
  const chitin = createChitinTextures();
  const pustule = createPustuleTextures();
  const wingFlyTex = createWingTextures('rgba(165, 22, 46, 0.9)', 'rgba(65, 235, 255, 0.72)');
  const wingLevTex = createWingTextures('rgba(145, 18, 56, 0.9)', 'rgba(186, 82, 255, 0.8)');
  const fangMap = createFangTexture();

  // Gnarled femur: pivot at hip (0,0,0), extends along +Y to 1.0 with muscular bulge
  const femur = new THREE.CylinderGeometry(0.04, 0.075, 1.0, 6, 3);
  femur.translate(0, 0.5, 0);
  perturbGeo(femur, 0.014, 10);

  // Curved serrated tibia: pivot at knee (0,0,0), tapers down to razor claw at -1.0
  const tibia = new THREE.ConeGeometry(0.056, 1.0, 6, 3);
  tibia.rotateX(Math.PI);
  tibia.translate(0, -0.5, 0);
  const tPos = tibia.attributes.position;
  for (let i = 0; i < tPos.count; i++) {
    const y = tPos.getY(i);
    const t = Math.abs(y);
    tPos.setX(i, tPos.getX(i) + Math.sin(t * Math.PI) * 0.06);
  }
  tibia.computeVertexNormals();

  // Jagged knee spur / spine
  const spur = new THREE.ConeGeometry(0.055, 0.36, 5);
  spur.translate(0, 0.18, 0);

  const spine = new THREE.ConeGeometry(0.068, 0.46, 5);
  spine.translate(0, 0.22, 0);
  spine.rotateX(-0.46);

  // Twisted fleshy tentacle / feeler
  const tentacle = new THREE.ConeGeometry(0.062, 0.8, 6, 4);
  tentacle.rotateX(Math.PI);
  tentacle.translate(0, -0.4, 0);
  const tenPos = tentacle.attributes.position;
  for (let i = 0; i < tenPos.count; i++) {
    const y = tenPos.getY(i);
    tenPos.setX(i, tenPos.getX(i) + Math.sin(y * 7) * 0.05);
    tenPos.setZ(i, tenPos.getZ(i) + Math.cos(y * 6) * 0.04);
  }
  tentacle.computeVertexNormals();

  // Wet darting tongue
  const tongue = new THREE.ConeGeometry(0.055, 0.52, 6, 3);
  tongue.rotateX(Math.PI / 2);
  tongue.translate(0, 0, 0.24);
  const tgPos = tongue.attributes.position;
  for (let i = 0; i < tgPos.count; i++) {
    const z = tgPos.getZ(i);
    tgPos.setY(i, tgPos.getY(i) - Math.sin((z / 0.52) * Math.PI) * 0.06);
  }
  tongue.computeVertexNormals();

  const moundPit = new THREE.CircleGeometry(0.95, 12);
  moundPit.rotateX(-Math.PI / 2);

  const moundFissure = new THREE.RingGeometry(0.14, 0.78, 12);
  moundFissure.rotateX(-Math.PI / 2);

  const shockRing = new THREE.RingGeometry(0.76, 1.0, 32);
  shockRing.rotateX(-Math.PI / 2);

  const geo = {
    thorax: makeRibbedLathe(
      [
        [0.01, -0.44],
        [0.26, -0.34],
        [0.39, -0.14],
        [0.34, 0.0],
        [0.38, 0.16],
        [0.24, 0.36],
        [0.01, 0.46],
      ],
      11,
      0.032,
    ),
    abdomen: makeRibbedLathe(
      [
        [0.01, -0.72],
        [0.18, -0.58],
        [0.38, -0.3],
        [0.46, -0.02],
        [0.38, 0.26],
        [0.18, 0.46],
        [0.01, 0.52],
      ],
      11,
      0.036,
    ),
    head: makeRibbedLathe(
      [
        [0.01, -0.24],
        [0.27, -0.12],
        [0.32, 0.04],
        [0.24, 0.24],
        [0.14, 0.36],
        [0.01, 0.42],
      ],
      10,
      0.026,
    ),
    fleshBelly: perturbGeo(new THREE.IcosahedronGeometry(0.38, 2), 0.045, 7),
    pustule: perturbGeo(new THREE.IcosahedronGeometry(0.24, 2), 0.032, 11),
    eye: new THREE.IcosahedronGeometry(0.056, 1),
    fang: makeCurvedFangGeo(),
    femur,
    tibia,
    spur,
    scythe: makeScytheGeo(),
    spine,
    rib: makeCurvedRibGeo(),
    armorPlate: perturbGeo(new THREE.SphereGeometry(0.44, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0.024, 9),
    wingFlyer: makeWingGeo(1.48, 0.84, -0.38),
    wingLevInner: makeWingGeo(2.25, 1.55, -0.36),
    wingLevOuter: makeWingGeo(2.38, 1.24, -0.88),
    tentacle,
    tongue,
    crest: makeCrestGeo(),
    mawRing: perturbGeo(new THREE.TorusGeometry(0.22, 0.085, 7, 12), 0.018, 12),
    moundRing: makeMoundRingGeo(),
    moundPit,
    moundFissure,
    moundRock: perturbGeo(new THREE.DodecahedronGeometry(0.24, 1), 0.035, 8),
    projCore: new THREE.IcosahedronGeometry(0.18, 1),
    projHalo: new THREE.IcosahedronGeometry(0.32, 1),
    shockRing,
    // Small rounded/faceted wet organic droplet (~0.045m base radius, never giant squares!)
    particle: new THREE.IcosahedronGeometry(0.045, 1),
  };

  const makeChitinMat = (color: number, emissive: number, emInt: number, rough = 0.24, metal = 0.28) =>
    new THREE.MeshStandardMaterial({
      color,
      map: chitin.map,
      bumpMap: chitin.bumpMap,
      bumpScale: 0.1,
      roughnessMap: chitin.roughnessMap,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity: emInt,
    });

  const mat = {
    carapace: {
      stalker: makeChitinMat(0x283226, 0x071608, 0.25, 0.24, 0.28),
      burrower: makeChitinMat(0x7c7160, 0x1a0c18, 0.22, 0.42, 0.16),
      flyer: makeChitinMat(0x2d2444, 0x100824, 0.28, 0.24, 0.34),
      spitter: makeChitinMat(0x224c30, 0x092914, 0.3, 0.24, 0.24),
      boss_broodmother: makeChitinMat(0x3a2024, 0x240804, 0.32, 0.26, 0.36),
      boss_leviathan: makeChitinMat(0x281c46, 0x180730, 0.36, 0.22, 0.4),
      boss_apex: makeChitinMat(0x4a1620, 0x260509, 0.36, 0.2, 0.38),
    },
    fleshWet: new THREE.MeshStandardMaterial({
      color: 0xc2b2b8,
      map: flesh.map,
      bumpMap: flesh.bumpMap,
      bumpScale: 0.085,
      roughnessMap: flesh.roughnessMap,
      roughness: 0.18,
      metalness: 0.06,
      emissive: 0x1a0810,
      emissiveIntensity: 0.25,
    }),
    fleshBloody: new THREE.MeshStandardMaterial({
      color: 0xa84852,
      map: flesh.map,
      bumpMap: flesh.bumpMap,
      bumpScale: 0.095,
      roughnessMap: flesh.roughnessMap,
      roughness: 0.15,
      metalness: 0.05,
      emissive: 0x32060c,
      emissiveIntensity: 0.42,
    }),
    fleshBurrower: new THREE.MeshStandardMaterial({
      color: 0xb8a48c,
      map: flesh.map,
      bumpMap: flesh.bumpMap,
      bumpScale: 0.09,
      roughnessMap: flesh.roughnessMap,
      roughness: 0.2,
      metalness: 0.05,
      emissive: 0x1d110e,
      emissiveIntensity: 0.2,
    }),
    mouthWet: new THREE.MeshStandardMaterial({
      color: 0x6b0d1d,
      bumpMap: flesh.bumpMap,
      bumpScale: 0.07,
      roughness: 0.11,
      metalness: 0.08,
      emissive: 0x3b040e,
      emissiveIntensity: 0.65,
    }),
    boneFang: new THREE.MeshStandardMaterial({
      color: 0xdcd4be,
      map: fangMap,
      bumpMap: chitin.bumpMap,
      bumpScale: 0.035,
      roughness: 0.3,
      metalness: 0.08,
    }),
    clawObsidian: new THREE.MeshStandardMaterial({
      color: 0x19181c,
      map: chitin.map,
      bumpMap: chitin.bumpMap,
      bumpScale: 0.06,
      roughness: 0.16,
      metalness: 0.55,
    }),
    eyeCrimson: new THREE.MeshStandardMaterial({
      color: 0xff3044,
      emissive: 0xff1228,
      emissiveIntensity: 3.1,
      roughness: 0.08,
    }),
    eyeSickly: new THREE.MeshStandardMaterial({
      color: 0xc8ff38,
      emissive: 0xa2ff1a,
      emissiveIntensity: 2.7,
      roughness: 0.08,
    }),
    eyeAmber: new THREE.MeshStandardMaterial({
      color: 0xffc638,
      emissive: 0xff9410,
      emissiveIntensity: 2.9,
      roughness: 0.08,
    }),
    eyeCyan: new THREE.MeshStandardMaterial({
      color: 0x8affff,
      emissive: 0x26ffff,
      emissiveIntensity: 3.2,
      roughness: 0.08,
    }),
    eyeGold: new THREE.MeshStandardMaterial({
      color: 0xffee66,
      emissive: 0xffb414,
      emissiveIntensity: 3.2,
      roughness: 0.08,
    }),
    eyeViolet: new THREE.MeshStandardMaterial({
      color: 0xebb2ff,
      emissive: 0xc440ff,
      emissiveIntensity: 3.2,
      roughness: 0.08,
    }),
    pustuleAcid: new THREE.MeshStandardMaterial({
      color: 0x628028,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.08,
      emissive: 0x6aff2b,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.15,
      roughness: 0.12,
      metalness: 0.05,
    }),
    pustuleViolet: new THREE.MeshStandardMaterial({
      color: 0x5c2e6b,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.08,
      emissive: 0xd944ff,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.25,
      roughness: 0.12,
    }),
    pustuleAmber: new THREE.MeshStandardMaterial({
      color: 0x704218,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.08,
      emissive: 0xff8a14,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.35,
      roughness: 0.12,
    }),
    pustuleMagenta: new THREE.MeshStandardMaterial({
      color: 0x61205e,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.08,
      emissive: 0xf032ff,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.35,
      roughness: 0.12,
    }),
    pustuleEmerald: new THREE.MeshStandardMaterial({
      color: 0x266e38,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.08,
      emissive: 0x42ff6e,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.35,
      roughness: 0.12,
    }),
    eggOrange: new THREE.MeshStandardMaterial({
      color: 0x7a2b0d,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.09,
      emissive: 0xff6210,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.65,
      roughness: 0.12,
    }),
    eggOuterMembrane: new THREE.MeshStandardMaterial({
      color: 0x421a20,
      map: flesh.map,
      bumpMap: flesh.bumpMap,
      bumpScale: 0.08,
      emissive: 0x5c1808,
      emissiveIntensity: 0.6,
      roughness: 0.14,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
    coreViolet: new THREE.MeshStandardMaterial({
      color: 0x45126b,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.09,
      emissive: 0xbd42ff,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.95,
      roughness: 0.11,
    }),
    crestGoldRed: new THREE.MeshStandardMaterial({
      color: 0x6e1a0e,
      map: pustule.map,
      bumpMap: pustule.bumpMap,
      bumpScale: 0.07,
      emissive: 0xff4c18,
      emissiveMap: pustule.emissiveMap,
      emissiveIntensity: 2.75,
      roughness: 0.14,
    }),
    wingFlyer: new THREE.MeshStandardMaterial({
      color: 0x80607a,
      map: wingFlyTex.map,
      alphaMap: wingFlyTex.alphaMap,
      bumpMap: wingFlyTex.bumpMap,
      bumpScale: 0.06,
      emissive: 0x2094b8,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.88,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.22,
    }),
    wingLeviathan: new THREE.MeshStandardMaterial({
      color: 0x7c5088,
      map: wingLevTex.map,
      alphaMap: wingLevTex.alphaMap,
      bumpMap: wingLevTex.bumpMap,
      bumpScale: 0.08,
      emissive: 0x8224cc,
      emissiveIntensity: 1.05,
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.2,
    }),
    moundRegolith: new THREE.MeshStandardMaterial({
      color: 0x2c2b2e,
      bumpMap: chitin.bumpMap,
      bumpScale: 0.08,
      roughness: 0.94,
      metalness: 0.02,
    }),
    moundPit: new THREE.MeshBasicMaterial({ color: 0x050507 }),
    moundFissure: new THREE.MeshBasicMaterial({
      color: 0xd94cff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    projAcid: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 2.2, 0.4), toneMapped: false }),
    projPlasma: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.2, 2.5), toneMapped: false }),
    projViolet: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.45, 2.5), toneMapped: false }),
    projHaloAcid: new THREE.MeshBasicMaterial({
      color: 0x4dff36,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    projHaloCyan: new THREE.MeshBasicMaterial({
      color: 0x33f6ff,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    projHaloViolet: new THREE.MeshBasicMaterial({
      color: 0xd04cff,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    particle: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  };

  _assets = { geo, mat };
  return _assets;
}

// ============================================================================
// Grotesque Procedural Anatomy Builders (all local +Z forward, +Y up)
// ============================================================================

function addMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  parent: THREE.Object3D,
  opts: {
    pos?: [number, number, number];
    rot?: [number, number, number];
    scale?: [number, number, number];
    weakpoint?: boolean;
    castShadow?: boolean;
    shadowLazy?: boolean;
  } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (opts.pos) m.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
  if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  m.castShadow = opts.castShadow ?? false;
  m.receiveShadow = false;
  if (opts.shadowLazy !== false) m.userData.shadowLazy = true;
  if (opts.weakpoint) m.userData.weakpoint = true;
  parent.add(m);
  return m;
}

/** Gnarled 3-segment spiny spider leg with fleshy hip tendon bulge, spiky knee spur & razor bone claw! */
function attachGnarledLeg(
  assets: SharedAssets,
  parent: THREE.Object3D,
  carapaceMat: THREE.Material,
  fleshMat: THREE.Material,
  side: -1 | 1,
  index: number,
  x: number,
  y: number,
  z: number,
  femurLen: number,
  tibiaLen: number,
  thickness: number,
  hipYawBase: number,
  hipLiftZ: number,
  kneeAngleZ: number,
  accentMat?: THREE.Material,
): LegJoint {
  const hip = new THREE.Group();
  hip.position.set(x * side, y, z);
  hip.rotation.order = 'YZX';
  hip.rotation.y = hipYawBase * side;
  hip.rotation.z = -hipLiftZ * side;
  parent.add(hip);

  // Fleshy tendon bulge at coxa/hip joint
  addMesh(assets.geo.pustule, fleshMat, hip, {
    pos: [0, 0.05, 0],
    scale: [thickness * 0.48, thickness * 0.42, thickness * 0.48],
  });

  // Gnarled armored upper femur
  addMesh(assets.geo.femur, carapaceMat, hip, {
    scale: [thickness, femurLen, thickness],
  });

  // Spiky bone knee-joint spur + optional glowing bile node
  addMesh(assets.geo.spur, assets.mat.boneFang, hip, {
    pos: [0, femurLen * 0.96, 0],
    rot: [0.35, 0, -0.32 * side],
    scale: [thickness * 0.95, thickness * 0.95, thickness * 0.95],
  });
  if (accentMat) {
    addMesh(assets.geo.pustule, accentMat, hip, {
      pos: [0, femurLen * 0.92, 0.03],
      scale: [thickness * 0.34, thickness * 0.32, thickness * 0.34],
    });
  }

  const knee = new THREE.Group();
  knee.position.set(0, femurLen, 0);
  knee.rotation.z = -kneeAngleZ * side;
  hip.add(knee);

  // Curved serrated lower tibia
  addMesh(assets.geo.tibia, assets.mat.clawObsidian, knee, {
    scale: [thickness * 0.92, tibiaLen * 0.78, thickness * 0.92],
  });
  // Mid-tibia serrated barb
  addMesh(assets.geo.spur, assets.mat.boneFang, knee, {
    pos: [0.02 * side, -tibiaLen * 0.35, -0.02],
    rot: [-2.1, 0, -0.35 * side],
    scale: [thickness * 0.65, thickness * 0.7, thickness * 0.65],
  });
  // Dirty blood-stained razor claw tip (3rd segment!)
  addMesh(assets.geo.tibia, assets.mat.boneFang, knee, {
    pos: [0, -tibiaLen * 0.72, 0],
    rot: [0, 0, 0.25 * side],
    scale: [thickness * 0.65, tibiaLen * 0.36, thickness * 0.65],
  });

  return {
    hip,
    knee,
    side,
    index,
    baseHipY: hipYawBase * side,
    baseHipZ: -hipLiftZ * side,
    baseKneeZ: -kneeAngleZ * side,
  };
}

/** Attaches a grotesque 4-piece split snapping jaw lined with dirty needle fangs + wet crimson gullet + darting tongue! */
function buildGrotesqueMaw(
  assets: SharedAssets,
  headGroup: THREE.Group,
  carapaceMat: THREE.Material,
  jaws: JawPiece[],
  scale: number,
  zOff: number,
): THREE.Object3D {
  // Wet bloody inner mouth gullet
  addMesh(assets.geo.mawRing, assets.mat.mouthWet, headGroup, {
    pos: [0, -0.05 * scale, zOff],
    scale: [0.85 * scale, 0.72 * scale, 0.9 * scale],
    weakpoint: true,
  });
  addMesh(assets.geo.fleshBelly, assets.mat.mouthWet, headGroup, {
    pos: [0, -0.05 * scale, zOff - 0.06 * scale],
    scale: [0.48 * scale, 0.38 * scale, 0.32 * scale],
    weakpoint: true,
  });

  // Darting wet fleshy tongue
  const tongue = new THREE.Group();
  tongue.position.set(0, -0.06 * scale, zOff - 0.02 * scale);
  addMesh(assets.geo.tongue, assets.mat.fleshBloody, tongue, {
    scale: [scale, scale, scale * 1.1],
  });
  headGroup.add(tongue);

  // 2 Large Left/Right Outer Mandibles (each lined with 3 dirty curved needle fangs!)
  for (const side of [-1, 1] as const) {
    const m = new THREE.Group();
    m.position.set(0.17 * scale * side, -0.03 * scale, zOff);
    addMesh(assets.geo.fang, carapaceMat, m, {
      rot: [0.06, -0.22 * side, 0],
      scale: [1.35 * scale, 1.25 * scale, 1.35 * scale],
    });
    // Row of 3 jagged inner bone needle-fangs
    for (let f = 0; f < 3; f++) {
      addMesh(assets.geo.fang, assets.mat.boneFang, m, {
        pos: [-0.04 * scale * side, -0.02 * scale, (0.1 + f * 0.13) * scale],
        rot: [0.1, -0.78 * side, 0],
        scale: [(0.58 - f * 0.08) * scale, (0.58 - f * 0.08) * scale, (0.68 - f * 0.08) * scale],
      });
    }
    headGroup.add(m);
    jaws.push({ obj: m, axis: 'y', dir: -side, base: 0.08 * side });
  }

  // 2 Lower/Upper Split Jaw Flaps with needle fangs
  const upperJaw = new THREE.Group();
  upperJaw.position.set(0, 0.07 * scale, zOff);
  for (const fx of [-0.08, 0, 0.08]) {
    addMesh(assets.geo.fang, assets.mat.boneFang, upperJaw, {
      pos: [fx * scale, -0.02 * scale, 0.04 * scale],
      rot: [0.52, 0, 0],
      scale: [0.55 * scale, 0.55 * scale, 0.72 * scale],
    });
  }
  headGroup.add(upperJaw);
  jaws.push({ obj: upperJaw, axis: 'x', dir: -1, base: -0.08 });

  const lowerJaw = new THREE.Group();
  lowerJaw.position.set(0, -0.14 * scale, zOff - 0.02 * scale);
  addMesh(assets.geo.head, carapaceMat, lowerJaw, {
    pos: [0, -0.02 * scale, 0.08 * scale],
    scale: [0.52 * scale, 0.25 * scale, 0.58 * scale],
  });
  for (const fx of [-0.1, -0.03, 0.03, 0.1]) {
    addMesh(assets.geo.fang, assets.mat.boneFang, lowerJaw, {
      pos: [fx * scale, 0.03 * scale, 0.12 * scale],
      rot: [-0.55, 0, 0],
      scale: [0.48 * scale, 0.48 * scale, 0.68 * scale],
    });
  }
  headGroup.add(lowerJaw);
  jaws.push({ obj: lowerJaw, axis: 'x', dir: 1, base: 0.12 });

  return tongue;
}

/** Attaches pulsing cluster of grotesque bile pustules / blisters! */
function addPustuleCluster(
  assets: SharedAssets,
  parent: THREE.Object3D,
  mat: THREE.Material,
  pulseMeshes: THREE.Object3D[],
  specs: [number, number, number, number][],
  weakpoint = true,
): void {
  for (const [x, y, z, s] of specs) {
    const p = addMesh(assets.geo.pustule, mat, parent, {
      pos: [x, y, z],
      rot: [x * 3.1, y * 4.7, z * 2.3],
      scale: [s, s * 0.88, s * 1.08],
      weakpoint,
    });
    pulseMeshes.push(p);
  }
}

function buildAlienRig(
  kind: AlienKind,
  assets: SharedAssets,
): {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  jaws: JawPiece[];
  tongue: THREE.Object3D | null;
  feelers: THREE.Object3D[];
  legs: LegJoint[];
  wings: WingRig | null;
  tentacles: THREE.Group[];
  pulseMeshes: THREE.Object3D[];
  weakpointAnchor: THREE.Object3D;
  carapaceMat: THREE.MeshStandardMaterial;
  ichorColor: [number, number, number];
  bodyCenterY: number;
  headFrontZ: number;
} {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const headGroup = new THREE.Group();
  const jaws: JawPiece[] = [];
  let tongue: THREE.Object3D | null = null;
  const feelers: THREE.Object3D[] = [];
  const legs: LegJoint[] = [];
  let wings: WingRig | null = null;
  const tentacles: THREE.Group[] = [];
  const pulseMeshes: THREE.Object3D[] = [];
  let weakpointAnchor: THREE.Object3D = headGroup;

  const carapaceMat = assets.mat.carapace[kind].clone();
  let ichorColor: [number, number, number] = [0.35, 2.0, 0.35];
  let bodyCenterY = 0.65;
  let headFrontZ = 0.72;

  if (kind === 'stalker') {
    ichorColor = [0.42, 2.15, 0.28];
    bodyCenterY = 0.64;
    headFrontZ = 0.78;

    // Exposed pulsing wet necrotic flesh underbelly + ribbed thorax & bloated abdomen
    addMesh(assets.geo.fleshBelly, assets.mat.fleshWet, bodyGroup, { pos: [0, 0.48, 0.08], scale: [0.85, 0.65, 1.35] });
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, { pos: [0, 0.6, 0.14], scale: [0.96, 0.74, 1.1] });
    addMesh(assets.geo.abdomen, assets.mat.fleshWet, bodyGroup, { pos: [0, 0.64, -0.58], rot: [-0.22, 0, 0], scale: [1.06, 0.92, 1.16] });

    // 4 Overlapping scarred chitin dorsal plates + jagged bone spinal ridges
    for (let i = 0; i < 4; i++) {
      addMesh(assets.geo.armorPlate, carapaceMat, bodyGroup, {
        pos: [0, 0.78 - i * 0.03, 0.32 - i * 0.3],
        rot: [0.22 - i * 0.14, 0, 0],
        scale: [0.82 + i * 0.06, 0.45, 0.72],
      });
      addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
        pos: [0, 0.88 - i * 0.02, 0.28 - i * 0.28],
        scale: [0.75, 0.95 - i * 0.08, 0.75],
      });
    }

    // Throbbing cluster of 7 grotesque translucent acid-green bile pustules on abdomen!
    addPustuleCluster(
      assets,
      bodyGroup,
      assets.mat.pustuleAcid,
      pulseMeshes,
      [
        [0, 0.72, -0.88, 1.15],
        [0.24, 0.66, -0.68, 0.78],
        [-0.26, 0.68, -0.64, 0.82],
        [0.18, 0.84, -0.46, 0.65],
        [-0.2, 0.82, -0.44, 0.62],
        [0.15, 0.56, -0.96, 0.72],
        [-0.14, 0.58, -0.98, 0.68],
      ],
      true,
    );

    // Terrifying Detailed Arachnid Head: 8 asymmetric glossy eyes, 4-piece fanged maw, feelers!
    headGroup.position.set(0, 0.6, 0.6);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [1.08, 0.84, 1.08], weakpoint: true });
    addMesh(assets.geo.armorPlate, carapaceMat, headGroup, { pos: [0, 0.18, -0.02], rot: [0.35, 0, 0], scale: [0.68, 0.45, 0.65], weakpoint: true });

    // Asymmetric cluster of 8 wet spider eyes (crimson + sickly yellow-green!)
    const eyes: [number, number, number, number, boolean][] = [
      [0.09, 0.09, 0.27, 1.3, true],
      [-0.1, 0.08, 0.27, 1.15, true],
      [0.2, 0.05, 0.17, 0.9, false],
      [-0.19, 0.06, 0.16, 1.0, false],
      [0.02, 0.17, 0.22, 1.05, true],
      [-0.08, 0.16, 0.19, 0.72, false],
      [0.14, 0.15, 0.18, 0.78, true],
      [0.25, -0.01, 0.08, 0.65, true],
    ];
    for (const [ex, ey, ez, es, crim] of eyes) {
      addMesh(assets.geo.eye, crim ? assets.mat.eyeCrimson : assets.mat.eyeSickly, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }

    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 1.05, 0.24);

    // 2 twitching barbed antennae/feelers
    for (const side of [-1, 1] as const) {
      const f = new THREE.Group();
      f.position.set(0.16 * side, 0.14, 0.18);
      f.rotation.set(-0.9, 0.35 * side, -0.3 * side);
      addMesh(assets.geo.tentacle, assets.mat.fleshWet, f, { scale: [0.5, 0.72, 0.5] });
      headGroup.add(f);
      feelers.push(f);
    }

    // 6 Gnarled 3-Segment Spiny Spider Legs
    const legSpecs: [number, number, number, number][] = [
      [0.36, 0.58, 0.76, 1.12],
      [0.02, 0.02, 0.8, 1.15],
      [-0.34, -0.56, 0.86, 1.2],
    ];
    for (let i = 0; i < legSpecs.length; i++) {
      const [lz, yawBase, fLen, tLen] = legSpecs[i];
      for (const side of [-1, 1] as const) {
        legs.push(
          attachGnarledLeg(
            assets,
            bodyGroup,
            carapaceMat,
            assets.mat.fleshWet,
            side,
            i,
            0.26,
            0.58,
            lz,
            fLen,
            tLen,
            0.92,
            yawBase,
            0.8,
            0.66,
            assets.mat.pustuleAcid,
          ),
        );
      }
    }
    weakpointAnchor = headGroup;
  } else if (kind === 'burrower') {
    ichorColor = [1.85, 0.55, 2.25];
    bodyCenterY = 0.74;
    headFrontZ = 0.92;

    // Gross 6-ringed maggot-centipede body: alternating wet pale flesh & scarred armor rings!
    for (let i = 0; i < 6; i++) {
      const rz = 0.52 - i * 0.3;
      const w = 1.15 - Math.abs(i - 2) * 0.12;
      addMesh(assets.geo.fleshBelly, assets.mat.fleshBurrower, bodyGroup, {
        pos: [0, 0.58 - i * 0.02, rz],
        scale: [w * 1.1, w * 0.88, 0.72],
      });
      addMesh(assets.geo.armorPlate, carapaceMat, bodyGroup, {
        pos: [0, 0.84 - i * 0.03, rz + 0.05],
        rot: [-0.14 + i * 0.05, 0, 0],
        scale: [w * 1.12, 0.56, 0.72],
      });
      addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
        pos: [0.24 * w, 0.86 - i * 0.03, rz],
        rot: [-0.35, 0, -0.35],
        scale: [0.65, 0.75, 0.65],
      });
      addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
        pos: [-0.24 * w, 0.86 - i * 0.03, rz],
        rot: [-0.35, 0, 0.35],
        scale: [0.65, 0.75, 0.65],
      });
      // Pulsing amber-violet bile pustule vents between segments!
      if (i < 5) {
        const ventMat = i % 2 === 0 ? assets.mat.pustuleViolet : assets.mat.pustuleAmber;
        addPustuleCluster(
          assets,
          bodyGroup,
          ventMat,
          pulseMeshes,
          [
            [0, 0.88 - i * 0.03, rz - 0.14, 0.68],
            [0.26, 0.74 - i * 0.03, rz - 0.14, 0.45],
            [-0.26, 0.74 - i * 0.03, rz - 0.14, 0.45],
          ],
          i < 3,
        );
      }
    }

    // Grotesque Burrower Head + Circular Fanged Maw + 7 uneven eyes
    headGroup.position.set(0, 0.6, 0.78);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [1.32, 0.94, 1.18], weakpoint: true });
    for (const [ex, ey, ez, es, amb] of [
      [0.14, 0.12, 0.26, 1.3, true],
      [-0.15, 0.11, 0.26, 1.2, true],
      [0.26, 0.06, 0.14, 0.95, false],
      [-0.25, 0.05, 0.15, 0.95, false],
      [0, 0.2, 0.22, 1.05, true],
      [0.08, 0.18, 0.18, 0.75, false],
      [-0.09, 0.18, 0.18, 0.75, false],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, amb ? assets.mat.eyeAmber : assets.mat.eyeCrimson, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }
    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 1.24, 0.26);

    // Oversized Curved Blood-Stained Bone Digging Scythes on muscular forelimbs!
    for (const side of [-1, 1] as const) {
      const hip = new THREE.Group();
      hip.position.set(0.46 * side, 0.6, 0.52);
      hip.rotation.order = 'YZX';
      hip.rotation.y = 0.38 * side;
      hip.rotation.z = -0.56 * side;
      bodyGroup.add(hip);
      addMesh(assets.geo.pustule, assets.mat.fleshBloody, hip, { pos: [0, 0.06, 0], scale: [0.85, 0.7, 0.85] });
      addMesh(assets.geo.femur, carapaceMat, hip, { scale: [1.55, 0.68, 1.55] });
      addMesh(assets.geo.spur, assets.mat.boneFang, hip, { pos: [0, 0.65, 0], rot: [0.4, 0, -0.4 * side], scale: [1.1, 1.1, 1.1] });

      const knee = new THREE.Group();
      knee.position.set(0, 0.68, 0);
      knee.rotation.z = -0.72 * side;
      hip.add(knee);
      addMesh(assets.geo.scythe, assets.mat.boneFang, knee, {
        rot: [0.14, Math.PI * 0.5 * side, 0],
        scale: [1.22, 1.22, 1.22],
      });
      legs.push({
        hip,
        knee,
        side,
        index: 0,
        baseHipY: 0.38 * side,
        baseHipZ: -0.56 * side,
        baseKneeZ: -0.72 * side,
        isFrontClaw: true,
      });
    }

    // 6 Heavy Centipede Rear Scuttling Legs
    for (let i = 0; i < 3; i++) {
      const lz = 0.05 - i * 0.38;
      for (const side of [-1, 1] as const) {
        legs.push(
          attachGnarledLeg(
            assets,
            bodyGroup,
            carapaceMat,
            assets.mat.fleshBurrower,
            side,
            i + 1,
            0.38,
            0.56,
            lz,
            0.72,
            0.96,
            1.15,
            -0.1 - i * 0.28,
            0.74,
            0.62,
          ),
        );
      }
    }
    weakpointAnchor = headGroup;
  } else if (kind === 'flyer') {
    ichorColor = [0.4, 2.05, 2.35];
    bodyCenterY = 0.0;
    headFrontZ = 0.9;

    // Elongated mosquito-manta body with exposed bone spine & wet fleshy underside
    addMesh(assets.geo.fleshBelly, assets.mat.fleshBloody, bodyGroup, { pos: [0, -0.08, 0.08], scale: [0.82, 0.55, 1.55] });
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, { pos: [0, 0.04, 0.14], scale: [0.95, 0.65, 1.4] });
    addMesh(assets.geo.abdomen, assets.mat.fleshWet, bodyGroup, { pos: [0, -0.06, -0.7], rot: [0.22, 0, 0], scale: [0.85, 0.72, 1.28] });

    // Dorsal spinal bones
    for (let i = 0; i < 4; i++) {
      addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
        pos: [0, 0.28 - i * 0.05, 0.38 - i * 0.36],
        scale: [0.72, 0.9, 0.72],
      });
    }

    // Bloated glowing translucent venom sac + curved stinger barb (weakpoint)
    addPustuleCluster(
      assets,
      bodyGroup,
      assets.mat.pustuleMagenta,
      pulseMeshes,
      [
        [0, -0.24, -1.16, 1.15],
        [0.18, -0.18, -0.95, 0.65],
        [-0.18, -0.18, -0.95, 0.65],
      ],
      true,
    );
    addMesh(assets.geo.fang, assets.mat.eyeCyan, bodyGroup, {
      pos: [0, -0.34, -1.42],
      rot: [Math.PI + 0.3, 0, 0],
      scale: [1.1, 1.1, 1.5],
      weakpoint: true,
    });

    // Mosquito-Demon Head: 7 glossy cyan/crimson eyes, split fanged jaws, bone horns!
    headGroup.position.set(0, 0.06, 0.78);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [0.98, 0.8, 1.18], weakpoint: true });
    addMesh(assets.geo.spine, assets.mat.boneFang, headGroup, { pos: [0.18, 0.16, -0.04], rot: [-0.55, 0, -0.38], scale: [0.8, 1.4, 0.8] });
    addMesh(assets.geo.spine, assets.mat.boneFang, headGroup, { pos: [-0.18, 0.16, -0.04], rot: [-0.55, 0, 0.38], scale: [0.8, 1.4, 0.8] });

    for (const [ex, ey, ez, es, cy] of [
      [0.11, 0.06, 0.26, 1.25, true],
      [-0.11, 0.06, 0.26, 1.25, true],
      [0.2, 0.02, 0.14, 0.9, false],
      [-0.2, 0.02, 0.14, 0.9, false],
      [0, 0.14, 0.22, 0.95, true],
      [0.09, 0.13, 0.18, 0.7, false],
      [-0.09, 0.13, 0.18, 0.7, false],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, cy ? assets.mat.eyeCyan : assets.mat.eyeCrimson, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }
    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 0.95, 0.24);

    // 2 Bony-Fingered Ragged Bloody-Veined Membrane Wings!
    const buildFlyerWing = (side: -1 | 1): THREE.Group => {
      const wg = new THREE.Group();
      wg.position.set(0.24 * side, 0.08, 0.24);
      addMesh(assets.geo.wingFlyer, assets.mat.wingFlyer, wg, { scale: [side, 1, 1] });
      // Leading bony arm + 3 splayed bony finger-struts
      addMesh(assets.geo.femur, assets.mat.boneFang, wg, { rot: [0, 0, -Math.PI * 0.46 * side], scale: [0.8, 1.45, 0.8] });
      addMesh(assets.geo.femur, assets.mat.boneFang, wg, { pos: [0.55 * side, 0.02, 0.08], rot: [0.35, -0.45 * side, -Math.PI * 0.48 * side], scale: [0.45, 1.05, 0.45] });
      addMesh(assets.geo.femur, assets.mat.boneFang, wg, { pos: [0.92 * side, 0.02, -0.02], rot: [0.4, -0.75 * side, -Math.PI * 0.48 * side], scale: [0.4, 0.85, 0.4] });
      addMesh(assets.geo.spur, assets.mat.boneFang, wg, { pos: [1.42 * side, 0.02, -0.3], rot: [0, 0, -1.2 * side], scale: [0.8, 1.1, 0.8] });
      bodyGroup.add(wg);
      return wg;
    };
    wings = { leftInner: buildFlyerWing(1), rightInner: buildFlyerWing(-1) };

    // 5 Twitching Barbed Feeding Tentacles dangling underneath
    for (let i = 0; i < 5; i++) {
      const ang = ((i - 2) / 2) * 0.9;
      const t = new THREE.Group();
      t.position.set(Math.sin(ang) * 0.26, -0.14, 0.2 - Math.abs(i - 2) * 0.18);
      addMesh(assets.geo.tentacle, assets.mat.fleshBloody, t, { scale: [0.95, 1.25, 0.95] });
      addMesh(assets.geo.spur, assets.mat.boneFang, t, { pos: [0, -0.68, 0.04], rot: [2.5, 0, 0], scale: [0.65, 0.8, 0.65] });
      bodyGroup.add(t);
      tentacles.push(t);
    }
    weakpointAnchor = headGroup;
  } else if (kind === 'spitter') {
    ichorColor = [0.28, 2.3, 0.6];
    bodyCenterY = 0.74;
    headFrontZ = 0.8;

    // Hunched blister-covered acid-hound body
    addMesh(assets.geo.fleshBelly, assets.mat.fleshWet, bodyGroup, { pos: [0, 0.6, 0.05], scale: [0.8, 0.68, 1.3] });
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, { pos: [0, 0.7, 0.14], rot: [-0.24, 0, 0], scale: [0.84, 0.78, 1.18] });
    addMesh(assets.geo.abdomen, carapaceMat, bodyGroup, { pos: [0, 0.58, -0.52], rot: [0.16, 0, 0], scale: [0.76, 0.7, 1.08] });

    // Glowing serrated acid spinal crest + 8 throbbing emerald bile blisters!
    const crest = addMesh(assets.geo.crest, assets.mat.pustuleEmerald, bodyGroup, {
      pos: [0, 0.95, 0.08],
      scale: [1.15, 1.2, 1.28],
      weakpoint: true,
    });
    pulseMeshes.push(crest);
    addPustuleCluster(
      assets,
      bodyGroup,
      assets.mat.pustuleEmerald,
      pulseMeshes,
      [
        [0.24, 0.8, 0.14, 0.62],
        [-0.24, 0.82, 0.1, 0.65],
        [0.28, 0.68, -0.26, 0.72],
        [-0.26, 0.7, -0.32, 0.7],
        [0.16, 0.74, -0.62, 0.68],
        [-0.18, 0.72, -0.66, 0.64],
      ],
      true,
    );

    // Acid-hound head with SWOLLEN glowing bile-cheek sacs + 7 eyes + fanged maw
    headGroup.position.set(0, 0.82, 0.64);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [0.96, 0.8, 1.14], weakpoint: true });
    addPustuleCluster(
      assets,
      headGroup,
      assets.mat.pustuleEmerald,
      pulseMeshes,
      [
        [0.24, -0.02, 0.08, 0.82],
        [-0.24, -0.02, 0.08, 0.82],
      ],
      true,
    );

    for (const [ex, ey, ez, es, sick] of [
      [0.11, 0.09, 0.25, 1.2, true],
      [-0.11, 0.09, 0.25, 1.2, true],
      [0, 0.16, 0.21, 1.0, false],
      [0.18, 0.06, 0.14, 0.85, false],
      [-0.18, 0.06, 0.14, 0.85, false],
      [0.08, 0.16, 0.16, 0.7, true],
      [-0.08, 0.16, 0.16, 0.7, true],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, sick ? assets.mat.eyeSickly : assets.mat.eyeCrimson, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }
    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 0.96, 0.24);

    // 2 Huge Reverse-Jointed Springy Hind Legs + 2 Barbed Front Claws
    for (const side of [-1, 1] as const) {
      const leg = attachGnarledLeg(
        assets,
        bodyGroup,
        carapaceMat,
        assets.mat.fleshWet,
        side,
        1,
        0.28,
        0.64,
        -0.3,
        0.98,
        1.32,
        1.12,
        -0.46,
        0.54,
        0.42,
        assets.mat.pustuleEmerald,
      );
      leg.isHindLeap = true;
      legs.push(leg);
    }
    for (const side of [-1, 1] as const) {
      const leg = attachGnarledLeg(
        assets,
        bodyGroup,
        carapaceMat,
        assets.mat.fleshWet,
        side,
        0,
        0.24,
        0.66,
        0.38,
        0.58,
        0.78,
        0.78,
        0.56,
        0.9,
        0.72,
      );
      leg.isFrontClaw = true;
      legs.push(leg);
    }

    // Spiked balancing whip-tail
    const tail = new THREE.Group();
    tail.position.set(0, 0.56, -0.96);
    tail.rotation.x = 1.25;
    addMesh(assets.geo.tentacle, carapaceMat, tail, { scale: [1.05, 1.5, 1.05] });
    addMesh(assets.geo.spur, assets.mat.boneFang, tail, { pos: [0, -0.65, 0.08], rot: [2.2, 0, 0], scale: [0.8, 1.0, 0.8] });
    bodyGroup.add(tail);
    tentacles.push(tail);
    weakpointAnchor = headGroup;
  } else if (kind === 'boss_broodmother') {
    ichorColor = [2.4, 0.9, 0.18];
    bodyCenterY = 1.68;
    headFrontZ = 1.95;

    // Enormous grotesque spider matriarch thorax + exposed bloody fleshy underside
    addMesh(assets.geo.fleshBelly, assets.mat.fleshBloody, bodyGroup, {
      pos: [0, 1.28, 0.1],
      scale: [2.4, 1.65, 3.1],
    });
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, {
      pos: [0, 1.58, 0.35],
      scale: [2.5, 1.88, 2.6],
      castShadow: true,
      shadowLazy: false,
    });

    // Armored dorsal ribs & jagged bone spines
    for (let i = 0; i < 4; i++) {
      addMesh(assets.geo.armorPlate, carapaceMat, bodyGroup, {
        pos: [0, 2.22 - i * 0.08, 0.72 - i * 0.62],
        rot: [0.14 - i * 0.14, 0, 0],
        scale: [2.25 + i * 0.12, 1.15, 1.85],
      });
      for (const side of [-1, 1] as const) {
        addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
          pos: [0.65 * side, 2.42, 0.42 - i * 0.54],
          rot: [-0.36, 0, -0.32 * side],
          scale: [1.85, 2.3, 1.85],
        });
      }
    }

    // BLOATED TRANSLUCENT VEINED EGG-SAC ABDOMEN packed with visible pulsing glowing larval pods!
    const eggSacGroup = new THREE.Group();
    eggSacGroup.position.set(0, 2.02, -1.78);
    bodyGroup.add(eggSacGroup);

    // Translucent outer fleshy veined membrane shell
    const outerSac = addMesh(assets.geo.abdomen, assets.mat.eggOuterMembrane, eggSacGroup, {
      rot: [-0.26, 0, 0],
      scale: [3.15, 2.7, 3.25],
      weakpoint: true,
      castShadow: true,
      shadowLazy: false,
    });
    pulseMeshes.push(outerSac);

    // Curved bone ribs wrapping over the egg-sac
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1] as const) {
        addMesh(assets.geo.rib, assets.mat.boneFang, eggSacGroup, {
          pos: [0.15 * side, 0.55 - i * 0.12, 0.6 - i * 0.75],
          rot: [0.18, 0, 0],
          scale: [2.4 * side, 2.2, 2.2],
        });
      }
    }

    // 10 Visible pulsing glowing fiery-orange larval pods bulging inside & out of the egg sac!
    addPustuleCluster(
      assets,
      eggSacGroup,
      assets.mat.eggOrange,
      pulseMeshes,
      [
        [0, 0.08, -0.3, 2.8],
        [0.68, 0.25, 0.15, 1.8],
        [-0.68, 0.22, 0.18, 1.85],
        [0.72, -0.22, -0.45, 1.75],
        [-0.72, -0.2, -0.42, 1.7],
        [0.0, 0.65, -0.2, 1.9],
        [0.42, 0.52, -0.82, 1.65],
        [-0.44, 0.48, -0.85, 1.65],
        [0.0, -0.15, -1.18, 2.15],
        [0.0, -0.58, -0.35, 1.7],
      ],
      true,
    );
    weakpointAnchor = eggSacGroup;

    // Crowned Matriarch Skull + Spiked Bone Crown + 9 blazing spider eyes + Dripping Triple-Jawed Maw!
    headGroup.position.set(0, 1.54, 1.65);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [2.55, 2.0, 2.45], weakpoint: true });
    // Spiked bone crown
    for (let c = -2; c <= 2; c++) {
      addMesh(assets.geo.spine, assets.mat.boneFang, headGroup, {
        pos: [c * 0.28, 0.58 - Math.abs(c) * 0.08, -0.05 + Math.abs(c) * 0.05],
        rot: [-0.25, 0, -c * 0.24],
        scale: [1.6, 2.4 - Math.abs(c) * 0.25, 1.6],
      });
    }
    for (const [ex, ey, ez, es, crim] of [
      [0.28, 0.2, 0.64, 2.5, true],
      [-0.28, 0.2, 0.64, 2.5, true],
      [0.54, 0.14, 0.4, 1.95, false],
      [-0.54, 0.14, 0.4, 1.95, false],
      [0.14, 0.38, 0.54, 1.75, true],
      [-0.14, 0.38, 0.54, 1.75, true],
      [0, 0.44, 0.5, 1.9, false],
      [0.42, 0.32, 0.42, 1.4, true],
      [-0.42, 0.32, 0.42, 1.4, true],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, crim ? assets.mat.eyeCrimson : assets.mat.eyeAmber, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }
    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 2.45, 0.58);

    // 8 Massive Armored Spider Legs with bone knee blades
    const bossLegs: [number, number, number, number][] = [
      [1.08, 0.72, 2.0, 2.8],
      [0.34, 0.25, 2.1, 2.9],
      [-0.42, -0.25, 2.15, 2.95],
      [-1.12, -0.75, 2.25, 3.1],
    ];
    for (let i = 0; i < bossLegs.length; i++) {
      const [lz, yawBase, fLen, tLen] = bossLegs[i];
      for (const side of [-1, 1] as const) {
        legs.push(
          attachGnarledLeg(
            assets,
            bodyGroup,
            carapaceMat,
            assets.mat.fleshBloody,
            side,
            i,
            0.78,
            1.54,
            lz,
            fLen,
            tLen,
            2.65,
            yawBase,
            0.72,
            0.64,
            assets.mat.eggOrange,
          ),
        );
      }
    }
  } else if (kind === 'boss_leviathan') {
    ichorColor = [1.7, 0.42, 2.5];
    bodyCenterY = 0.0;
    headFrontZ = 2.15;

    // Colossal 8m jagged veined sky-horror
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, {
      pos: [0, 0.25, 0.32],
      scale: [2.35, 1.25, 3.25],
      castShadow: true,
      shadowLazy: false,
    });
    addMesh(assets.geo.abdomen, assets.mat.fleshWet, bodyGroup, {
      pos: [0, 0.0, -1.55],
      scale: [1.85, 1.15, 2.68],
      castShadow: true,
      shadowLazy: false,
    });

    // EXPOSED BONE RIBCAGE framing a pulsing glowing violet HEART (weakpoint)!
    for (let r = 0; r < 6; r++) {
      for (const side of [-1, 1] as const) {
        addMesh(assets.geo.rib, assets.mat.boneFang, bodyGroup, {
          pos: [0.18 * side, -0.1, 1.25 - r * 0.44],
          rot: [0.22, 0, 0.1 * side],
          scale: [(2.05 - r * 0.12) * side, 1.95 - r * 0.1, 1.85],
        });
      }
    }
    const heart = addMesh(assets.geo.pustule, assets.mat.coreViolet, bodyGroup, {
      pos: [0, -0.52, 0.42],
      scale: [2.65, 2.15, 3.1],
      weakpoint: true,
    });
    pulseMeshes.push(heart);
    weakpointAnchor = heart;

    // Horned abyssal skull + LAMPREY CIRCULAR TOOTHED MOUTH + 8 glaring eyes!
    headGroup.position.set(0, 0.16, 1.98);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [2.2, 1.5, 2.45], weakpoint: true });
    addMesh(assets.geo.spine, assets.mat.boneFang, headGroup, { pos: [0.58, 0.38, -0.14], rot: [-0.65, 0, -0.45], scale: [2.2, 3.4, 2.2] });
    addMesh(assets.geo.spine, assets.mat.boneFang, headGroup, { pos: [-0.58, 0.38, -0.14], rot: [-0.65, 0, 0.45], scale: [2.2, 3.4, 2.2] });

    // Lamprey circular fleshy mouth funnel lined with 10 inward-curving ivory teeth!
    const lamprey = new THREE.Group();
    lamprey.position.set(0, -0.14, 0.85);
    addMesh(assets.geo.mawRing, assets.mat.mouthWet, lamprey, { scale: [2.1, 2.1, 2.2], weakpoint: true });
    addMesh(assets.geo.fleshBelly, assets.mat.mouthWet, lamprey, { pos: [0, 0, -0.18], scale: [1.1, 1.1, 0.6], weakpoint: true });
    for (let f = 0; f < 10; f++) {
      const a = (f / 10) * Math.PI * 2;
      const tooth = new THREE.Group();
      tooth.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.08);
      tooth.rotation.z = a + Math.PI * 0.5;
      addMesh(assets.geo.fang, assets.mat.boneFang, tooth, {
        rot: [0.38, 0, 0],
        scale: [1.35, 1.35, 1.6],
      });
      lamprey.add(tooth);
    }
    headGroup.add(lamprey);
    tongue = addMesh(assets.geo.tongue, assets.mat.fleshBloody, lamprey, { scale: [2.2, 2.2, 2.6] });

    for (const [ex, ey, ez, es, v] of [
      [0.26, 0.24, 0.66, 2.2, true],
      [-0.26, 0.24, 0.66, 2.2, true],
      [0.48, 0.16, 0.4, 1.85, false],
      [-0.48, 0.16, 0.4, 1.85, false],
      [0.62, 0.06, 0.18, 1.5, true],
      [-0.62, 0.06, 0.18, 1.5, true],
      [0.14, 0.38, 0.5, 1.45, false],
      [-0.14, 0.38, 0.5, 1.45, false],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, v ? assets.mat.eyeViolet : assets.mat.eyeCyan, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }

    // Colossal 2-stage bony-fingered jagged veined membrane wings (~8.8m wingspan!)
    const buildLevWing = (side: -1 | 1): [THREE.Group, THREE.Group] => {
      const inner = new THREE.Group();
      inner.position.set(0.66 * side, 0.2, 0.46);
      addMesh(assets.geo.wingLevInner, assets.mat.wingLeviathan, inner, { scale: [side, 1, 1] });
      addMesh(assets.geo.femur, assets.mat.boneFang, inner, { rot: [0, 0, -Math.PI * 0.48 * side], scale: [1.85, 2.3, 1.85] });
      addMesh(assets.geo.femur, assets.mat.boneFang, inner, { pos: [1.1 * side, 0.02, 0.1], rot: [0.32, -0.5 * side, -Math.PI * 0.48 * side], scale: [1.0, 1.75, 1.0] });

      const outer = new THREE.Group();
      outer.position.set(2.18 * side, 0.05, -0.22);
      addMesh(assets.geo.wingLevOuter, assets.mat.wingLeviathan, outer, { scale: [side, 1, 1] });
      addMesh(assets.geo.femur, assets.mat.boneFang, outer, { rot: [0, -0.24 * side, -Math.PI * 0.48 * side], scale: [1.35, 2.35, 1.35] });
      addMesh(assets.geo.spur, assets.mat.boneFang, outer, { pos: [2.25 * side, 0.04, -0.75], rot: [0, 0, -1.25 * side], scale: [1.8, 2.2, 1.8] });
      inner.add(outer);
      bodyGroup.add(inner);
      return [inner, outer];
    };
    const [leftInner, leftOuter] = buildLevWing(1);
    const [rightInner, rightOuter] = buildLevWing(-1);
    wings = { leftInner, leftOuter, rightInner, rightOuter };

    // 6-Segment Barbed Trailing Tail with dorsal bone spines
    let prevTail: THREE.Object3D = bodyGroup;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? -0.05 : 0, i === 0 ? -2.75 : -0.92);
      const s = 1.0 - i * 0.12;
      addMesh(assets.geo.thorax, i % 2 === 0 ? carapaceMat : assets.mat.fleshWet, seg, { pos: [0, 0, -0.45], scale: [0.76 * s, 0.56 * s, 1.08] });
      addMesh(assets.geo.spine, assets.mat.boneFang, seg, { pos: [0, 0.25 * s, -0.45], scale: [1.1 * s, 1.6 * s, 1.1 * s] });
      addMesh(assets.geo.pustule, assets.mat.coreViolet, seg, { pos: [0, -0.12 * s, -0.45], scale: [0.55 * s, 0.45 * s, 0.85 * s] });
      if (i === 5) {
        addMesh(assets.geo.fang, assets.mat.eyeCyan, seg, {
          pos: [0, 0, -0.82],
          rot: [Math.PI, 0, 0],
          scale: [1.8, 1.8, 2.6],
        });
      }
      prevTail.add(seg);
      tentacles.push(seg);
      prevTail = seg;
    }
  } else {
    // boss_apex: Towering 3.6m sinewy exposed-muscle & bone-plate hunter!
    ichorColor = [2.45, 0.3, 0.42];
    bodyCenterY = 1.75;
    headFrontZ = 1.48;

    // Exposed sinewy bloody muscle torso wrapped in midnight-crimson bone armor plates + chest ribs!
    addMesh(assets.geo.fleshBelly, assets.mat.fleshBloody, bodyGroup, { pos: [0, 1.68, 0.18], scale: [1.85, 1.85, 2.35] });
    addMesh(assets.geo.thorax, carapaceMat, bodyGroup, {
      pos: [0, 1.86, 0.24],
      rot: [-0.36, 0, 0],
      scale: [1.78, 1.56, 2.28],
      castShadow: true,
      shadowLazy: false,
    });
    addMesh(assets.geo.abdomen, assets.mat.fleshBloody, bodyGroup, {
      pos: [0, 1.32, -0.96],
      rot: [0.35, 0, 0],
      scale: [1.38, 1.18, 1.98],
      castShadow: true,
      shadowLazy: false,
    });

    // Exposed chest ribs + long curved dorsal bone spines!
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1] as const) {
        addMesh(assets.geo.rib, assets.mat.boneFang, bodyGroup, {
          pos: [0.14 * side, 1.72 - i * 0.14, 0.72 - i * 0.34],
          rot: [0.35, 0, 0],
          scale: [1.3 * side, 1.25, 1.25],
        });
      }
      addMesh(assets.geo.spine, assets.mat.boneFang, bodyGroup, {
        pos: [0, 2.36 - i * 0.18, 0.46 - i * 0.48],
        rot: [-0.58, 0, 0],
        scale: [1.6, 2.45 - i * 0.2, 1.6],
      });
    }

    // Blazing Gold-Crimson Predator Skull + Gaping Split Predator Jaw (weakpoint)!
    headGroup.position.set(0, 2.38, 1.08);
    bodyGroup.add(headGroup);
    addMesh(assets.geo.head, carapaceMat, headGroup, { scale: [1.9, 1.6, 2.3], weakpoint: true });
    const crown = addMesh(assets.geo.crest, assets.mat.crestGoldRed, headGroup, {
      pos: [0, 0.48, -0.05],
      scale: [2.75, 2.75, 2.65],
      weakpoint: true,
    });
    const throatCore = addMesh(assets.geo.pustule, assets.mat.crestGoldRed, headGroup, {
      pos: [0, -0.18, 0.34],
      scale: [0.95, 0.85, 0.95],
      weakpoint: true,
    });
    pulseMeshes.push(crown, throatCore);
    weakpointAnchor = headGroup;

    for (const [ex, ey, ez, es, gold] of [
      [0.24, 0.18, 0.58, 2.1, true],
      [-0.24, 0.18, 0.58, 2.1, true],
      [0.42, 0.26, 0.36, 1.55, false],
      [-0.42, 0.26, 0.36, 1.55, false],
      [0, 0.34, 0.48, 1.5, true],
      [0.14, 0.3, 0.44, 1.15, false],
      [-0.14, 0.3, 0.44, 1.15, false],
    ] as [number, number, number, number, boolean][]) {
      addMesh(assets.geo.eye, gold ? assets.mat.eyeGold : assets.mat.eyeCrimson, headGroup, {
        pos: [ex, ey, ez],
        scale: [es, es, es],
        weakpoint: true,
      });
    }
    tongue = buildGrotesqueMaw(assets, headGroup, carapaceMat, jaws, 2.15, 0.54);

    // 4 Towering Digitigrade Spiny Hunter Legs
    for (let i = 0; i < 2; i++) {
      const lz = i === 0 ? -0.15 : -0.94;
      const fLen = i === 0 ? 1.88 : 2.18;
      const tLen = i === 0 ? 2.48 : 2.78;
      for (const side of [-1, 1] as const) {
        const leg = attachGnarledLeg(
          assets,
          bodyGroup,
          carapaceMat,
          assets.mat.fleshBloody,
          side,
          i + 1,
          0.56,
          1.46 - i * 0.18,
          lz,
          fLen,
          tLen,
          2.1,
          i === 0 ? 0.18 : -0.45,
          0.54,
          0.46,
          assets.mat.crestGoldRed,
        );
        if (i === 1) leg.isHindLeap = true;
        legs.push(leg);
      }
    }

    // 2 Elongated Dual Scythe-Blade Raptorial Forearms!
    for (const side of [-1, 1] as const) {
      const hip = new THREE.Group();
      hip.position.set(0.7 * side, 2.0, 0.74);
      hip.rotation.order = 'YZX';
      hip.rotation.y = 0.42 * side;
      hip.rotation.z = -0.58 * side;
      bodyGroup.add(hip);
      addMesh(assets.geo.pustule, assets.mat.fleshBloody, hip, { pos: [0, 0.15, 0], scale: [1.4, 1.2, 1.4] });
      addMesh(assets.geo.femur, carapaceMat, hip, { scale: [2.05, 1.38, 2.05] });
      addMesh(assets.geo.spur, assets.mat.boneFang, hip, { pos: [0, 1.35, 0], rot: [0.4, 0, -0.4 * side], scale: [1.7, 1.9, 1.7] });

      const knee = new THREE.Group();
      knee.position.set(0, 1.38, 0);
      knee.rotation.z = -0.82 * side;
      hip.add(knee);
      addMesh(assets.geo.scythe, assets.mat.boneFang, knee, {
        rot: [0.15, Math.PI * 0.5 * side, 0],
        scale: [2.25, 2.25, 2.25],
      });
      addMesh(assets.geo.pustule, assets.mat.crestGoldRed, knee, {
        pos: [0, -0.62, 0.16],
        scale: [0.7, 1.6, 0.5],
      });
      legs.push({
        hip,
        knee,
        side,
        index: 0,
        baseHipY: 0.42 * side,
        baseHipZ: -0.58 * side,
        baseKneeZ: -0.82 * side,
        isFrontClaw: true,
      });
    }

    // Barbed crimson whip-tail
    let prevTail: THREE.Object3D = bodyGroup;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 1.16 : 0, i === 0 ? -1.85 : -0.82);
      addMesh(assets.geo.thorax, i % 2 === 0 ? carapaceMat : assets.mat.fleshBloody, seg, {
        pos: [0, 0, -0.4],
        scale: [0.46 - i * 0.07, 0.46 - i * 0.07, 0.96],
      });
      addMesh(assets.geo.spine, assets.mat.boneFang, seg, { pos: [0, 0.22, -0.4], scale: [0.85, 1.25, 0.85] });
      if (i === 3) {
        addMesh(assets.geo.fang, assets.mat.crestGoldRed, seg, {
          pos: [0, 0, -0.78],
          rot: [Math.PI, 0, 0],
          scale: [1.6, 1.6, 2.4],
        });
      }
      prevTail.add(seg);
      tentacles.push(seg);
      prevTail = seg;
    }
  }

  return {
    root,
    bodyGroup,
    headGroup,
    jaws,
    tongue,
    feelers,
    legs,
    wings,
    tentacles,
    pulseMeshes,
    weakpointAnchor,
    carapaceMat,
    ichorColor,
    bodyCenterY,
    headFrontZ,
  };
}

// ============================================================================
// AlienManager
// ============================================================================

export class AlienManager {
  readonly group = new THREE.Group();
  readonly aliens: Alien[] = [];

  private nextId = 1;
  private assets: SharedAssets;
  private mounds: EruptionMound[] = [];
  private projectiles: ProjRec[] = [];
  private shockwaves: ShockwaveRing[] = [];

  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;
  private particlesDirty = false;

  constructor(scene: THREE.Scene) {
    this.assets = getAssets();
    this.group.name = 'siege-aliens';
    scene.add(this.group);

    // Single InstancedMesh for ALL wet ichor droplets & lunar regolith rock chunks!
    this.particleMesh = new THREE.InstancedMesh(this.assets.geo.particle, this.assets.mat.particle, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.castShadow = false;
    this.particleMesh.receiveShadow = false;
    this.particleMesh.userData.shadowLazy = true;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    _mat4.makeScale(0, 0, 0);
    _col.setRGB(1, 1, 1);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
        life: 0,
        maxLife: 1,
        gravity: GRAV_LUNAR,
        r: 1,
        g: 1,
        b: 1,
      });
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, _col);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.group.add(this.particleMesh);
  }

  spawn(kind: AlienKind, x: number, z: number, waveScale: number, tier = 1): Alien {
    const isBoss = kind === 'boss_broodmother' || kind === 'boss_leviathan' || kind === 'boss_apex';
    const isFlying = kind === 'flyer' || kind === 'boss_leviathan';
    const scale = Math.max(0.6, waveScale);
    const bossTierMul = 1 + Math.max(0, tier - 1) * 0.55;

    const rig = buildAlienRig(kind, this.assets);

    let maxHp = 60;
    let speed = 8;
    let radius = 0.9;
    let damage = 12;
    let grabTaps = 5;
    let startsEmerging = false;
    let emergeDur = 1.5;
    let emergeDepth = 2.1;

    switch (kind) {
      case 'stalker':
        maxHp = Math.round(54 * scale);
        speed = 8.4 + Math.min(scale * 0.45, 3.2);
        radius = 0.92;
        damage = Math.round(12 * (0.85 + 0.15 * scale));
        grabTaps = 5;
        break;
      case 'burrower':
        maxHp = Math.round(86 * scale);
        speed = 7.1 + Math.min(scale * 0.35, 2.6);
        radius = 1.08;
        damage = Math.round(16 * (0.85 + 0.15 * scale));
        grabTaps = 6;
        startsEmerging = true;
        emergeDur = 1.5;
        emergeDepth = 2.0;
        break;
      case 'flyer':
        maxHp = Math.round(64 * scale);
        speed = 9.5 + Math.min(scale * 0.35, 3.0);
        radius = 1.12;
        damage = Math.round(13 * (0.85 + 0.15 * scale));
        grabTaps = 5;
        break;
      case 'spitter':
        maxHp = Math.round(62 * scale);
        speed = 7.8 + Math.min(scale * 0.4, 2.8);
        radius = 0.95;
        damage = Math.round(14 * (0.85 + 0.15 * scale));
        grabTaps = 5;
        break;
      case 'boss_broodmother':
        maxHp = Math.round(680 * scale * bossTierMul);
        speed = 5.4 + Math.min((tier - 1) * 0.45, 2.0);
        radius = 2.3;
        damage = Math.round(26 * (1 + (tier - 1) * 0.25));
        grabTaps = 9;
        startsEmerging = true;
        emergeDur = 2.0;
        emergeDepth = 4.2;
        break;
      case 'boss_leviathan':
        maxHp = Math.round(620 * scale * bossTierMul);
        speed = 10.6 + Math.min((tier - 1) * 0.5, 2.6);
        radius = 2.4;
        damage = Math.round(24 * (1 + (tier - 1) * 0.25));
        grabTaps = 9;
        break;
      case 'boss_apex':
        maxHp = Math.round(590 * scale * bossTierMul);
        speed = 10.2 + Math.min((tier - 1) * 0.6, 3.0);
        radius = 1.85;
        damage = Math.round(25 * (1 + (tier - 1) * 0.25));
        grabTaps = 10;
        break;
    }

    const groundY = heightAt(x, z);
    const flightAlt = kind === 'boss_leviathan' ? 11.5 : 5.5 + Math.random() * 5.5;
    const spawnY = isFlying ? groundY + flightAlt + 4.0 : groundY;
    const pos = new THREE.Vector3(x, spawnY, z);
    rig.root.position.copy(pos);

    if (startsEmerging) {
      rig.bodyGroup.position.y = -emergeDepth;
      rig.bodyGroup.rotation.x = -0.65;
      this.spawnEruptionMound(x, groundY, z, isBoss ? 2.6 : 1.08);
      this.spawnBurst(x, groundY + 0.25, z, isBoss ? 34 : 18, {
        r: 0.44,
        g: 0.42,
        b: 0.4,
        speed: isBoss ? 8.5 : 5.0,
        upSpeed: isBoss ? 7.2 : 4.5,
        scale: isBoss ? 1.8 : 1.05,
        life: 1.05,
        gravity: -4.8,
      });
      this.spawnBurst(x, groundY + 0.2, z, isBoss ? 14 : 7, {
        r: rig.ichorColor[0],
        g: rig.ichorColor[1],
        b: rig.ichorColor[2],
        speed: 4.4,
        upSpeed: 3.8,
        scale: isBoss ? 1.15 : 0.72,
        life: 0.72,
        gravity: -3.6,
      });
      playSfx('burrow', isBoss ? 1.0 : 0.75);
    }

    if (isBoss) {
      playSfx('boss_roar', 1.0);
    }

    const rec: AlienRec = {
      id: this.nextId++,
      kind,
      isBoss,
      isFlying,
      nameKey: NAME_KEYS[kind],
      root: rig.root,
      hp: maxHp,
      maxHp,
      speed,
      radius,
      damage,
      grabTaps,
      state: startsEmerging ? 'emerging' : 'chase',
      pos,
      slowTimer: 0,
      stunTimer: 0,

      bodyGroup: rig.bodyGroup,
      headGroup: rig.headGroup,
      jaws: rig.jaws,
      tongue: rig.tongue,
      feelers: rig.feelers,
      legs: rig.legs,
      wings: rig.wings,
      tentacles: rig.tentacles,
      pulseMeshes: rig.pulseMeshes,
      weakpointAnchor: rig.weakpointAnchor,
      carapaceMat: rig.carapaceMat,
      baseEmissive: rig.carapaceMat.emissive.clone(),
      baseEmissiveInt: rig.carapaceMat.emissiveIntensity,
      ichorColor: rig.ichorColor,
      bodyCenterY: rig.bodyCenterY,
      headFrontZ: rig.headFrontZ,

      vel: new THREE.Vector3(),
      knockVel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      pitch: 0,
      roll: 0,
      gaitPhase: Math.random() * Math.PI * 2,
      seed: Math.random() * 100,

      emergeT: startsEmerging ? 0 : 1,
      emergeDur,
      emergeDepth,
      emergeDustTimer: 0,

      flashTimer: 0,
      flashCrit: false,
      deathTimer: 0,
      deathDur: isBoss ? 1.45 : 0.78,
      deathRollDir: Math.random() < 0.5 ? -1 : 1,

      ramCooldown: 0,
      grabCooldown: 0.4,
      attackCooldown: kind === 'boss_broodmother' ? 5.0 : 2.0 + Math.random() * 2.2,
      minionCooldown: 9.5,
      diveTimer: 0,
      diveCooldown: 5.5 + Math.random() * 4.5,
      slamWindup: 0,
      dustTrailTimer: 0,

      orbitDir: Math.random() < 0.5 ? -1 : 1,
      orbitAngle: Math.random() * Math.PI * 2,
      flankAngle: (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.45),
      flightAlt,
      airborne: isFlying,
      tier,
      waveScale: scale,
    };

    this.group.add(rec.root);
    this.aliens.push(rec);
    return rec;
  }

  clear(): void {
    for (const a of this.aliens as AlienRec[]) {
      this.group.remove(a.root);
      a.carapaceMat.dispose();
    }
    this.aliens.length = 0;

    for (const m of this.mounds) {
      this.group.remove(m.group);
    }
    this.mounds.length = 0;

    for (const p of this.projectiles) {
      this.group.remove(p.mesh);
    }
    this.projectiles.length = 0;

    for (const s of this.shockwaves) {
      this.group.remove(s.mesh);
      s.mat.dispose();
    }
    this.shockwaves.length = 0;

    _mat4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles[i].active = false;
      this.particleMesh.setMatrixAt(i, _mat4);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particlesDirty = false;
  }

  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.aliens.length; i++) {
      if (this.aliens[i].state !== 'dying') n++;
    }
    return n;
  }

  activeBoss(): Alien | null {
    for (let i = 0; i < this.aliens.length; i++) {
      const a = this.aliens[i];
      if (a.isBoss && a.state !== 'dying') return a;
    }
    return null;
  }

  // ==========================================================================
  // Main Simulation Update
  // ==========================================================================

  update(ctx: AlienUpdateCtx, callbacks: AlienCallbacks): void {
    const dt = Math.min(ctx.dt, 0.05);
    if (dt <= 0) return;

    const habBaseY = heightAt(ctx.habCenter.x, ctx.habCenter.z);
    let grabTriggeredThisFrame = ctx.grabbedAlienId !== null;
    const list = this.aliens as AlienRec[];

    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];

      if (a.slowTimer > 0) a.slowTimer = Math.max(0, a.slowTimer - dt);
      if (a.ramCooldown > 0) a.ramCooldown = Math.max(0, a.ramCooldown - dt);
      if (a.grabCooldown > 0) a.grabCooldown = Math.max(0, a.grabCooldown - dt);
      if (a.flashTimer > 0) a.flashTimer = Math.max(0, a.flashTimer - dt);

      this.updateCarapaceTint(a, ctx.now);

      // Organic pulsing of throbbing bile-pustules, larval egg-pods, and glowing hearts
      const pulseSpeed = a.slamWindup > 0 ? 18 : a.state === 'grabbing' ? 14 : 4.8;
      const pulseAmp = a.slamWindup > 0 ? 0.18 : 0.1;
      for (let p = 0; p < a.pulseMeshes.length; p++) {
        const pm = a.pulseMeshes[p];
        const s = 1 + Math.sin(ctx.now * pulseSpeed + a.seed + p * 1.15) * pulseAmp;
        const bx = pm.userData.baseScaleX ?? (pm.userData.baseScaleX = pm.scale.x);
        const by = pm.userData.baseScaleY ?? (pm.userData.baseScaleY = pm.scale.y);
        const bz = pm.userData.baseScaleZ ?? (pm.userData.baseScaleZ = pm.scale.z);
        pm.scale.set(bx * s, by * s, bz * s);
      }

      // ---- STATE: DYING ----
      if (a.state === 'dying') {
        a.deathTimer += dt;
        const t = Math.min(1, a.deathTimer / a.deathDur);
        if (a.isFlying) {
          a.vel.y += GRAV_LUNAR * 1.4 * dt;
          a.pos.addScaledVector(a.vel, dt);
          const gy = heightAt(a.pos.x, a.pos.z) + 0.35;
          if (a.pos.y < gy) {
            if (a.vel.y < -2.0) {
              this.spawnBurst(a.pos.x, gy, a.pos.z, 16, {
                r: a.ichorColor[0],
                g: a.ichorColor[1],
                b: a.ichorColor[2],
                speed: 5.5,
                upSpeed: 3.5,
                scale: 0.85,
                life: 0.7,
                gravity: -4.2,
              });
            }
            a.pos.y = gy;
            a.vel.multiplyScalar(0.75);
          }
          a.root.position.copy(a.pos);
          a.bodyGroup.rotation.z += a.deathRollDir * 4.5 * dt * (1 - t * 0.7);
          a.bodyGroup.rotation.x += 2.2 * dt * (1 - t);
        } else {
          a.knockVel.multiplyScalar(Math.exp(-4.5 * dt));
          a.pos.x += a.knockVel.x * dt;
          a.pos.z += a.knockVel.z * dt;
          const gy = heightAt(a.pos.x, a.pos.z);
          a.pos.y = Math.max(gy, a.pos.y + a.vel.y * dt);
          a.vel.y += GRAV_LUNAR * 1.6 * dt;
          a.root.position.copy(a.pos);
          a.bodyGroup.rotation.z = THREE.MathUtils.lerp(0, a.deathRollDir * 1.65, Math.min(1, t * 2.2));
          a.bodyGroup.position.y = -t * (a.isBoss ? 0.9 : 0.38);
        }

        this.animateLimbs(a, dt, ctx.now, (1 - t) * 0.4, 2.2, true);

        if (t > 0.65) {
          const s = Math.max(0.01, 1 - (t - 0.65) / 0.35);
          a.root.scale.setScalar(s);
        }

        if (a.deathTimer >= a.deathDur) {
          this.group.remove(a.root);
          a.carapaceMat.dispose();
          list.splice(i, 1);
        }
        continue;
      }

      // ---- STATE: GRABBING ----
      if (a.state === 'grabbing') {
        this.animateLimbs(a, dt, ctx.now, 1.15, 2.8, false);
        continue;
      }

      // ---- STATE: EMERGING ----
      if (a.state === 'emerging') {
        a.emergeT = Math.min(1, a.emergeT + dt / a.emergeDur);
        const dx = ctx.playerPos.x - a.pos.x;
        const dz = ctx.playerPos.z - a.pos.z;
        a.yaw = Math.atan2(dx, dz);
        a.root.rotation.set(0, a.yaw, 0);

        const ease = 1 - Math.pow(1 - a.emergeT, 2.2);
        const heave = Math.sin(a.emergeT * Math.PI * 6) * 0.08 * (1 - a.emergeT);
        a.bodyGroup.position.y = -(1 - ease) * a.emergeDepth + heave;
        a.bodyGroup.rotation.x = -(1 - ease) * 0.72;
        a.bodyGroup.rotation.z = Math.sin(a.emergeT * Math.PI * 8) * 0.12 * (1 - a.emergeT);

        a.emergeDustTimer -= dt;
        if (a.emergeDustTimer <= 0) {
          a.emergeDustTimer = 0.08;
          this.spawnBurst(a.pos.x, a.pos.y + 0.15, a.pos.z, a.isBoss ? 6 : 3, {
            r: 0.44,
            g: 0.42,
            b: 0.4,
            speed: a.isBoss ? 6.0 : 3.4,
            upSpeed: a.isBoss ? 6.2 : 3.8,
            scale: a.isBoss ? 1.5 : 0.85,
            life: 0.9,
            gravity: -4.4,
          });
        }

        this.animateLimbs(a, dt, ctx.now, 1.0, 2.2, false);

        if (a.emergeT >= 1) {
          a.state = 'chase';
          a.bodyGroup.position.y = 0;
          a.bodyGroup.rotation.set(0, 0, 0);
        }
        continue;
      }

      // ---- STATE: STUNNED ----
      if (a.state === 'stunned') {
        a.stunTimer -= dt;
        this.applyKnockbackAndFloor(a, dt, ctx.habCenter, habBaseY);
        a.bodyGroup.rotation.z = Math.sin(ctx.now * 26 + a.seed) * 0.18;
        this.animateLimbs(a, dt, ctx.now, 0.25, 1.8, true);

        if (a.stunTimer <= 0) {
          a.stunTimer = 0;
          a.state = 'chase';
          a.bodyGroup.rotation.z = 0;
        }
        continue;
      }

      // ---- STATE: CHASE ----
      const speedFactor = a.slowTimer > 0 ? 0.48 : 1.0;
      const effSpeed = a.speed * speedFactor;

      if (a.isFlying) {
        this.updateFlyingChase(a, ctx, callbacks, dt, effSpeed, habBaseY, grabTriggeredThisFrame, () => {
          grabTriggeredThisFrame = true;
        });
      } else {
        this.updateGroundChase(a, ctx, callbacks, dt, effSpeed, habBaseY, grabTriggeredThisFrame, () => {
          grabTriggeredThisFrame = true;
        });
      }

      const distOrigin = Math.hypot(a.pos.x, a.pos.z);
      if (distOrigin > PLAY_BOUND) {
        const s = PLAY_BOUND / distOrigin;
        a.pos.x *= s;
        a.pos.z *= s;
      }

      a.root.position.copy(a.pos);
    }

    this.updateProjectiles(ctx, callbacks, dt, habBaseY);
    this.updateShockwaves(ctx, callbacks, dt);
    this.updateMounds(dt, ctx.now);
    this.updateParticles(dt);
  }

  private updateGroundChase(
    a: AlienRec,
    ctx: AlienUpdateCtx,
    callbacks: AlienCallbacks,
    dt: number,
    effSpeed: number,
    habBaseY: number,
    grabAlreadyTriggered: boolean,
    markGrabTriggered: () => void,
  ): void {
    const targetPos = ctx.inRover ? ctx.roverPos : ctx.playerPos;
    const dxRaw = targetPos.x - a.pos.x;
    const dzRaw = targetPos.z - a.pos.z;
    const distToPlayer = Math.hypot(dxRaw, dzRaw);

    let goalX = targetPos.x;
    let goalZ = targetPos.z;
    if (ctx.habInside) {
      a.orbitAngle += a.orbitDir * dt * (a.isBoss ? 0.35 : 0.62);
      const prowlR = a.isBoss ? 12.5 : 9.8 + (a.seed % 3.5);
      goalX = ctx.habCenter.x + Math.cos(a.orbitAngle) * prowlR;
      goalZ = ctx.habCenter.z + Math.sin(a.orbitAngle) * prowlR;
    }

    let gdx = goalX - a.pos.x;
    let gdz = goalZ - a.pos.z;
    const gDist = Math.hypot(gdx, gdz) || 0.001;
    gdx /= gDist;
    gdz /= gDist;

    if (!ctx.habInside && !a.airborne && a.slamWindup <= 0) {
      if (a.kind === 'stalker' && distToPlayer < 24 && distToPlayer > 3.2) {
        const zig = Math.sin(ctx.now * 4.8 + a.seed) * 0.52;
        const rx = -gdz;
        const rz = gdx;
        gdx += rx * zig;
        gdz += rz * zig;
        const l = Math.hypot(gdx, gdz) || 1;
        gdx /= l;
        gdz /= l;
      } else if (a.kind === 'spitter' && distToPlayer > 7 && distToPlayer < 32) {
        const ang = a.flankAngle * Math.min(1, (distToPlayer - 6) / 18);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = gdx * ca - gdz * sa;
        const nz = gdx * sa + gdz * ca;
        gdx = nx;
        gdz = nz;
      } else if (a.kind === 'boss_apex' && distToPlayer > 8 && distToPlayer < 28) {
        const weave = Math.sin(ctx.now * 3.1 + a.seed) * 0.36;
        const rx = -gdz;
        const rz = gdx;
        gdx += rx * weave;
        gdz += rz * weave;
        const l = Math.hypot(gdx, gdz) || 1;
        gdx /= l;
        gdz /= l;
      }
    }

    a.attackCooldown -= dt;

    // 1. Broodmother: Ground-Slam Shockwave + Minion Spawning
    if (a.kind === 'boss_broodmother') {
      a.minionCooldown -= dt;
      if (a.minionCooldown <= 0 && !ctx.habInside) {
        a.minionCooldown = 11.5 + Math.random() * 3.0;
        if (this.aliveCount() < 26) {
          const perpX = -gdz;
          const perpZ = gdx;
          for (const side of [-1, 1] as const) {
            let mx = a.pos.x + perpX * 4.2 * side - gdx * 1.4;
            let mz = a.pos.z + perpZ * 4.2 * side - gdz * 1.4;
            const hd = Math.hypot(mx - ctx.habCenter.x, mz - ctx.habCenter.z);
            if (hd < HAB_EXCLUSION_RADIUS + 2.0) {
              const s = (HAB_EXCLUSION_RADIUS + 2.2) / (hd || 1);
              mx = ctx.habCenter.x + (mx - ctx.habCenter.x) * s;
              mz = ctx.habCenter.z + (mz - ctx.habCenter.z) * s;
            }
            const mk: AlienKind = side === 1 ? 'stalker' : 'burrower';
            callbacks.onBossSpawnMinion(mk, mx, mz);
          }
          this.spawnBurst(a.pos.x, a.pos.y + 2.1, a.pos.z, 22, {
            r: 2.4,
            g: 1.0,
            b: 0.15,
            speed: 6.5,
            upSpeed: 4.5,
            scale: 1.15,
            life: 0.85,
            gravity: -3.5,
          });
        }
      }

      if (a.slamWindup > 0) {
        a.slamWindup -= dt;
        const w = Math.max(0, a.slamWindup / 0.65);
        a.bodyGroup.rotation.x = -0.45 * Math.sin((1 - w) * Math.PI);
        if (a.slamWindup <= 0) {
          a.bodyGroup.rotation.x = 0;
          const gy = heightAt(a.pos.x, a.pos.z);
          this.spawnShockwave(a.pos.x, gy + 0.25, a.pos.z, 22, 18, a.damage * 0.85, 0xff6a1a);
          this.spawnBurst(a.pos.x, gy + 0.3, a.pos.z, 26, {
            r: 0.5,
            g: 0.45,
            b: 0.4,
            speed: 10.5,
            upSpeed: 5.5,
            scale: 1.5,
            life: 1.0,
            gravity: -4.8,
          });
          playSfx('boss_roar', 0.7);
        }
      } else if (a.attackCooldown <= 0 && distToPlayer < 26 && !ctx.habInside) {
        a.attackCooldown = 6.8 + Math.random() * 2.2;
        a.slamWindup = 0.65;
      }
    }

    // 2. Boss Apex: Lunar-Gravity Pounce Leap
    if (a.kind === 'boss_apex') {
      if (a.slamWindup > 0) {
        a.slamWindup -= dt;
        a.bodyGroup.position.y = -0.35 * Math.sin((1 - a.slamWindup / 0.42) * Math.PI);
        a.bodyGroup.rotation.x = 0.28;
        if (a.slamWindup <= 0) {
          a.bodyGroup.position.y = 0;
          a.bodyGroup.rotation.x = 0;
          a.airborne = true;
          const vy = 10.4;
          const airTime = Math.max(1.2, (2 * vy) / 5.8);
          const horizSpd = Math.min(22, Math.max(11, distToPlayer / (airTime * 0.72)));
          a.vel.set(gdx * horizSpd, vy, gdz * horizSpd);
          this.spawnBurst(a.pos.x, a.pos.y + 0.2, a.pos.z, 20, {
            r: 0.5,
            g: 0.48,
            b: 0.45,
            speed: 7.0,
            upSpeed: 4.5,
            scale: 1.3,
            life: 0.9,
            gravity: -4.2,
          });
          playSfx('boss_roar', 0.65);
        }
      } else if (!a.airborne && a.attackCooldown <= 0 && distToPlayer > 9.5 && distToPlayer < 42 && !ctx.habInside) {
        a.attackCooldown = 4.6 + Math.random() * 1.8;
        a.slamWindup = 0.42;
      }
    }

    // 3. Spitter: Low-Gravity Lunar Leaps + Acid Spit
    if (a.kind === 'spitter' && !a.airborne && !ctx.habInside) {
      if (a.attackCooldown <= 0 && distToPlayer > 7 && distToPlayer < 34) {
        if (distToPlayer > 14 && Math.random() < 0.42) {
          a.attackCooldown = 2.6 + Math.random() * 1.4;
          this.fireProjectile(a, ctx.playerEye, 26, a.damage * 0.75, 'acid', 0);
        } else {
          a.attackCooldown = 2.4 + Math.random() * 1.3;
          a.airborne = true;
          const leapSpd = effSpeed * 1.55;
          a.vel.set(gdx * leapSpd, 5.8 + Math.random() * 2.0, gdz * leapSpd);
          this.spawnBurst(a.pos.x, a.pos.y + 0.15, a.pos.z, 8, {
            r: 0.45,
            g: 0.44,
            b: 0.42,
            speed: 3.5,
            upSpeed: 2.5,
            scale: 0.75,
            life: 0.6,
            gravity: -4.2,
          });
        }
      }
    }

    const moveMul = a.slamWindup > 0 ? 0.18 : 1.0;
    if (a.airborne) {
      const grav = a.kind === 'boss_apex' ? -5.8 : -4.5;
      a.vel.y += grav * dt;
      a.pos.x += (a.vel.x + a.knockVel.x) * dt;
      a.pos.z += (a.vel.z + a.knockVel.z) * dt;
      a.pos.y += a.vel.y * dt;

      const gy = heightAt(a.pos.x, a.pos.z);
      if (a.pos.y <= gy) {
        a.pos.y = gy;
        a.airborne = false;
        a.vel.set(0, 0, 0);
        a.bodyGroup.rotation.x = 0;

        this.spawnBurst(a.pos.x, gy + 0.2, a.pos.z, a.isBoss ? 22 : 8, {
          r: 0.48,
          g: 0.46,
          b: 0.44,
          speed: a.isBoss ? 8.5 : 4.0,
          upSpeed: a.isBoss ? 5.0 : 2.5,
          scale: a.isBoss ? 1.35 : 0.75,
          life: 0.8,
          gravity: -4.5,
        });
        if (a.kind === 'boss_apex') {
          this.spawnShockwave(a.pos.x, gy + 0.22, a.pos.z, 7.5, 16, a.damage * 0.6, 0xff3a24);
        }
      } else {
        a.bodyGroup.rotation.x = THREE.MathUtils.clamp(-a.vel.y * 0.055, -0.55, 0.55);
      }
    } else {
      a.pos.x += (gdx * effSpeed * moveMul + a.knockVel.x) * dt;
      a.pos.z += (gdz * effSpeed * moveMul + a.knockVel.z) * dt;
      a.pos.y = heightAt(a.pos.x, a.pos.z);

      // Burrower dripping slime + regolith dust trail
      if (a.kind === 'burrower') {
        a.dustTrailTimer -= dt;
        if (a.dustTrailTimer <= 0) {
          a.dustTrailTimer = 0.14;
          this.spawnBurst(a.pos.x, a.pos.y + 0.12, a.pos.z, 2, {
            r: 0.46,
            g: 0.44,
            b: 0.42,
            speed: 1.5,
            upSpeed: 1.5,
            scale: 0.65,
            life: 0.55,
            gravity: -3.4,
          });
          this.spawnBurst(a.pos.x, a.pos.y + 0.18, a.pos.z, 1, {
            r: 1.4,
            g: 0.45,
            b: 1.8,
            speed: 1.1,
            upSpeed: 1.0,
            scale: 0.52,
            life: 0.45,
            gravity: -3.2,
          });
        }
      }
    }

    a.knockVel.multiplyScalar(Math.exp(-6.5 * dt));

    this.enforceHabExclusion(a, ctx.habCenter, habBaseY);
    if (!a.airborne) {
      a.pos.y = heightAt(a.pos.x, a.pos.z);
    }

    const targetYaw = ctx.habInside && gDist < 2.2 ? Math.atan2(ctx.habCenter.x - a.pos.x, ctx.habCenter.z - a.pos.z) : Math.atan2(gdx, gdz);
    a.yaw = lerpAngle(a.yaw, targetYaw, 1 - Math.exp(-9 * dt));

    if (!a.airborne) {
      const s = a.isBoss ? 1.4 : 0.75;
      const fx = Math.sin(a.yaw) * s;
      const fz = Math.cos(a.yaw) * s;
      const lx = Math.cos(a.yaw) * s;
      const lz = -Math.sin(a.yaw) * s;
      const hFwd = heightAt(a.pos.x + fx, a.pos.z + fz);
      const hBack = heightAt(a.pos.x - fx, a.pos.z - fz);
      const hLeft = heightAt(a.pos.x + lx, a.pos.z + lz);
      const hRight = heightAt(a.pos.x - lx, a.pos.z - lz);
      const targetPitch = THREE.MathUtils.clamp(-Math.atan2(hFwd - hBack, 2 * s), -0.65, 0.65);
      const targetRoll = THREE.MathUtils.clamp(Math.atan2(hLeft - hRight, 2 * s), -0.55, 0.55);
      const k = 1 - Math.exp(-10 * dt);
      a.pitch += (targetPitch - a.pitch) * k;
      a.roll += (targetRoll - a.roll) * k;
    } else {
      a.pitch *= Math.exp(-6 * dt);
      a.roll *= Math.exp(-6 * dt);
    }
    a.root.rotation.set(a.pitch, a.yaw, a.roll);

    this.animateLimbs(a, dt, ctx.now, moveMul * (a.airborne ? 0.35 : 1.0), effSpeed / 7.5, false);

    // Rover Ramming Check
    if (ctx.inRover && Math.abs(ctx.roverSpeed) > 2.2 && a.ramCooldown <= 0) {
      const rDist = Math.hypot(a.pos.x - ctx.roverPos.x, a.pos.z - ctx.roverPos.z);
      if (rDist <= 2.3 + a.radius && Math.abs(a.pos.y - ctx.roverPos.y) < 3.0) {
        a.ramCooldown = 0.6;
        callbacks.onRoverRam(a, Math.abs(ctx.roverSpeed));
        return;
      }
    }

    // Grab Attempt Check
    if (!ctx.habInside && !grabAlreadyTriggered && a.grabCooldown <= 0 && a.state === 'chase') {
      const onFootRange = 2.15 + a.radius * 0.45;
      const roverSlow = ctx.inRover && Math.abs(ctx.roverSpeed) < 1.0;
      const canGrab = !ctx.inRover || roverSlow;
      if (canGrab) {
        const grabRange = roverSlow ? 2.7 + a.radius * 0.2 : onFootRange;
        const hDist = Math.hypot(a.pos.x - targetPos.x, a.pos.z - targetPos.z);
        const vDist = Math.abs(a.pos.y - targetPos.y);
        if (hDist <= grabRange && vDist < 2.8) {
          a.grabCooldown = 0.35;
          markGrabTriggered();
          callbacks.onGrabAttempt(a);
        }
      }
    }
  }

  private updateFlyingChase(
    a: AlienRec,
    ctx: AlienUpdateCtx,
    callbacks: AlienCallbacks,
    dt: number,
    effSpeed: number,
    habBaseY: number,
    grabAlreadyTriggered: boolean,
    markGrabTriggered: () => void,
  ): void {
    const targetPos = ctx.inRover ? ctx.roverPos : ctx.playerPos;
    const aimPoint = ctx.inRover ? _v3.set(ctx.roverPos.x, ctx.roverPos.y + 1.2, ctx.roverPos.z) : ctx.playerEye;

    a.attackCooldown -= dt;
    a.diveCooldown -= dt;

    if (a.diveTimer > 0) {
      a.diveTimer -= dt;
      if (ctx.habInside || grabAlreadyTriggered) a.diveTimer = 0;
    } else if (!ctx.habInside && !grabAlreadyTriggered && a.diveCooldown <= 0 && a.grabCooldown <= 0) {
      const d = Math.hypot(a.pos.x - targetPos.x, a.pos.z - targetPos.z);
      if (d < 42 && d > 8) {
        a.diveTimer = a.isBoss ? 3.8 : 3.2;
        a.diveCooldown = a.isBoss ? 10.5 + Math.random() * 3.5 : 7.5 + Math.random() * 4.0;
      }
    }

    let desiredX: number;
    let desiredY: number;
    let desiredZ: number;
    let speedMul = 1.0;

    if (ctx.habInside) {
      a.orbitAngle += a.orbitDir * dt * 0.55;
      const r = a.isBoss ? 18 : 13.5;
      desiredX = ctx.habCenter.x + Math.cos(a.orbitAngle) * r;
      desiredZ = ctx.habCenter.z + Math.sin(a.orbitAngle) * r;
      desiredY = habBaseY + (a.isBoss ? 13 : 8.5) + Math.sin(ctx.now * 1.4 + a.seed) * 1.6;
    } else if (a.diveTimer > 0) {
      desiredX = aimPoint.x;
      desiredY = aimPoint.y + 0.15;
      desiredZ = aimPoint.z;
      speedMul = 1.38;
    } else {
      a.orbitAngle += a.orbitDir * dt * (a.isBoss ? 0.36 : 0.62);
      const orbitR = a.isBoss ? 28 : 17 + (a.seed % 9);
      desiredX = targetPos.x + Math.cos(a.orbitAngle) * orbitR;
      desiredZ = targetPos.z + Math.sin(a.orbitAngle) * orbitR;
      const gAtDesired = heightAt(desiredX, desiredZ);
      const minAlt = a.isBoss ? 8.5 : 4.2;
      const waveAlt = Math.sin(ctx.now * 1.3 + a.seed) * (a.isBoss ? 3.8 : 2.8);
      desiredY = gAtDesired + Math.max(minAlt, a.flightAlt + waveAlt);
    }

    _v1.set(desiredX - a.pos.x, desiredY - a.pos.y, desiredZ - a.pos.z);
    const dLen = _v1.length() || 1;
    _v1.divideScalar(dLen);

    const steerK = 1 - Math.exp(-(a.diveTimer > 0 ? 4.8 : 2.6) * dt);
    a.vel.x += (_v1.x * effSpeed * speedMul - a.vel.x) * steerK;
    a.vel.y += (_v1.y * effSpeed * speedMul - a.vel.y) * steerK;
    a.vel.z += (_v1.z * effSpeed * speedMul - a.vel.z) * steerK;

    a.pos.x += (a.vel.x + a.knockVel.x) * dt;
    a.pos.y += (a.vel.y + a.knockVel.y) * dt;
    a.pos.z += (a.vel.z + a.knockVel.z) * dt;
    a.knockVel.multiplyScalar(Math.exp(-5.0 * dt));

    const gy = heightAt(a.pos.x, a.pos.z);
    const minClear = a.diveTimer > 0 ? 1.2 : a.isBoss ? 6.5 : 3.2;
    if (a.pos.y < gy + minClear) {
      a.pos.y = gy + minClear;
      if (a.vel.y < 0) a.vel.y *= -0.3;
    }

    this.enforceHabExclusion(a, ctx.habCenter, habBaseY);

    const prevYaw = a.yaw;
    const desiredYaw = Math.atan2(a.vel.x, a.vel.z);
    a.yaw = lerpAngle(a.yaw, desiredYaw, 1 - Math.exp(-6.5 * dt));
    const yawRate = angleDiff(a.yaw, prevYaw) / Math.max(dt, 0.001);

    const horizSpd = Math.hypot(a.vel.x, a.vel.z) || 0.1;
    const desiredPitch = THREE.MathUtils.clamp(-Math.atan2(a.vel.y, horizSpd), -0.65, 0.65);
    const desiredRoll = THREE.MathUtils.clamp(-yawRate * 0.45, -0.72, 0.72);
    a.pitch += (desiredPitch - a.pitch) * (1 - Math.exp(-6 * dt));
    a.roll += (desiredRoll - a.roll) * (1 - Math.exp(-6 * dt));
    a.root.rotation.set(a.pitch, a.yaw, a.roll);

    this.animateLimbs(a, dt, ctx.now, a.diveTimer > 0 ? 1.55 : 1.0, 1.0, false);

    if (!ctx.habInside && a.diveTimer <= 0 && a.attackCooldown <= 0) {
      const dist = a.pos.distanceTo(aimPoint);
      if (dist < (a.isBoss ? 85 : 52) && dist > 6) {
        if (a.kind === 'boss_leviathan') {
          a.attackCooldown = 3.8 + Math.random() * 1.2;
          this.fireProjectile(a, aimPoint, 32, a.damage * 0.68, 'violet', -0.11);
          this.fireProjectile(a, aimPoint, 32, a.damage * 0.68, 'violet', 0);
          this.fireProjectile(a, aimPoint, 32, a.damage * 0.68, 'violet', 0.11);
        } else {
          a.attackCooldown = 3.2 + Math.random() * 1.4;
          this.fireProjectile(a, aimPoint, 27, a.damage * 0.78, 'plasma', 0);
        }
      }
    }

    if (!ctx.habInside && !grabAlreadyTriggered && a.grabCooldown <= 0 && a.state === 'chase') {
      const roverSlow = ctx.inRover && Math.abs(ctx.roverSpeed) < 1.0;
      const canGrab = !ctx.inRover || roverSlow;
      if (canGrab) {
        const grabRange = roverSlow ? 2.8 + a.radius * 0.25 : 2.25 + a.radius * 0.45;
        if (a.pos.distanceTo(aimPoint) <= grabRange) {
          a.diveTimer = 0;
          a.grabCooldown = 0.4;
          markGrabTriggered();
          callbacks.onGrabAttempt(a);
        }
      }
    }
  }

  private enforceHabExclusion(a: AlienRec, habCenter: THREE.Vector3, habBaseY: number): void {
    if (a.isFlying && a.pos.y > habBaseY + 7.4) return;
    const dx = a.pos.x - habCenter.x;
    const dz = a.pos.z - habCenter.z;
    const minR = HAB_EXCLUSION_RADIUS + a.radius * 0.45;
    const d = Math.hypot(dx, dz);
    if (d < minR) {
      const nx = d > 0.001 ? dx / d : 1;
      const nz = d > 0.001 ? dz / d : 0;
      a.pos.x = habCenter.x + nx * minR;
      a.pos.z = habCenter.z + nz * minR;
    }
  }

  private applyKnockbackAndFloor(a: AlienRec, dt: number, habCenter: THREE.Vector3, habBaseY: number): void {
    a.pos.x += a.knockVel.x * dt;
    a.pos.z += a.knockVel.z * dt;
    if (a.isFlying) {
      a.pos.y += a.knockVel.y * dt;
      const gy = heightAt(a.pos.x, a.pos.z) + 2.2;
      if (a.pos.y < gy) a.pos.y = gy;
    } else {
      a.vel.y += GRAV_LUNAR * 1.4 * dt;
      a.pos.y += a.vel.y * dt;
      const gy = heightAt(a.pos.x, a.pos.z);
      if (a.pos.y <= gy) {
        a.pos.y = gy;
        a.vel.y = 0;
      }
    }
    a.knockVel.multiplyScalar(Math.exp(-5.5 * dt));
    this.enforceHabExclusion(a, habCenter, habBaseY);
    a.root.position.copy(a.pos);
  }

  private updateCarapaceTint(a: AlienRec, now: number): void {
    if (a.flashTimer > 0) {
      const k = a.flashTimer / 0.13;
      if (a.flashCrit) {
        a.carapaceMat.emissive.setRGB(1.0, 0.85, 0.25);
        a.carapaceMat.emissiveIntensity = 2.6 * k;
      } else {
        a.carapaceMat.emissive.setRGB(0.75, 0.95, 1.0);
        a.carapaceMat.emissiveIntensity = 2.2 * k;
      }
    } else if (a.slowTimer > 0) {
      const pulse = 0.85 + Math.sin(now * 9 + a.seed) * 0.2;
      a.carapaceMat.emissive.setRGB(0.18, 0.72, 1.0);
      a.carapaceMat.emissiveIntensity = 1.15 * pulse;
    } else if (a.state === 'dying') {
      a.carapaceMat.emissive.copy(a.baseEmissive);
      a.carapaceMat.emissiveIntensity = a.baseEmissiveInt * Math.max(0, 1 - a.deathTimer / a.deathDur);
    } else {
      a.carapaceMat.emissive.copy(a.baseEmissive);
      a.carapaceMat.emissiveIntensity = a.baseEmissiveInt;
    }
  }

  private animateLimbs(a: AlienRec, dt: number, now: number, intensity: number, speedScale: number, twitch: boolean): void {
    const rate = (a.isBoss ? 11.5 : 18.0) * Math.max(0.4, speedScale);
    a.gaitPhase += dt * rate * Math.max(0.2, intensity);
    const isGrab = a.state === 'grabbing';

    for (let i = 0; i < a.legs.length; i++) {
      const leg = a.legs[i];
      const tripod = ((leg.index + (leg.side === 1 ? 0 : 1)) % 2) * Math.PI + leg.index * 0.65;
      const ph = a.gaitPhase + tripod;
      const swing = Math.sin(ph);
      const lift = Math.max(0, Math.cos(ph));

      if (twitch) {
        const j = Math.sin(now * 32 + i * 2.1 + a.seed) * 0.32 * intensity;
        leg.hip.rotation.y = leg.baseHipY + j;
        leg.hip.rotation.z = leg.baseHipZ - (0.35 + j) * leg.side;
        leg.knee.rotation.z = leg.baseKneeZ + 0.45 * leg.side;
      } else if (isGrab && (leg.index === 0 || leg.isFrontClaw)) {
        // Reaching clawed limbs menacingly toward both left/right edges of the player's visor!
        const claw = Math.sin(now * 17 + (leg.side === 1 ? 0 : Math.PI) + a.seed);
        leg.hip.rotation.y = (0.72 + claw * 0.25) * leg.side;
        leg.hip.rotation.z = (-0.38 + claw * 0.22) * leg.side;
        leg.knee.rotation.z = (-0.52 - Math.max(0, claw) * 0.35) * leg.side;
      } else if (leg.isFrontClaw) {
        const slashRate = a.state === 'emerging' ? 1.55 : 0.78;
        const s = Math.sin(a.gaitPhase * slashRate + (leg.side === 1 ? 0 : Math.PI));
        leg.hip.rotation.y = leg.baseHipY + s * 0.48 * leg.side * intensity;
        leg.hip.rotation.z = leg.baseHipZ + s * 0.35 * leg.side * intensity;
        leg.knee.rotation.z = leg.baseKneeZ - Math.max(0, s) * 0.42 * leg.side;
      } else if (leg.isHindLeap && a.airborne) {
        leg.hip.rotation.y = leg.baseHipY - 0.55 * leg.side;
        leg.hip.rotation.z = leg.baseHipZ + 0.45 * leg.side;
        leg.knee.rotation.z = leg.baseKneeZ - 0.65 * leg.side;
      } else {
        const ampY = a.isBoss ? 0.32 : 0.46;
        const ampLift = a.isBoss ? 0.34 : 0.48;
        leg.hip.rotation.y = leg.baseHipY + swing * ampY * intensity;
        leg.hip.rotation.z = leg.baseHipZ + lift * ampLift * leg.side * intensity;
        leg.knee.rotation.z = leg.baseKneeZ - lift * 0.4 * leg.side * intensity;
      }
    }

    // Articulated flapping torn-membrane wings
    if (a.wings) {
      const flapFreq = a.kind === 'boss_leviathan' ? 3.8 : 10.5;
      const flap = Math.sin(now * flapFreq * (isGrab ? 1.75 : 1.0) + a.seed);
      const lag = Math.sin(now * flapFreq - 0.75 + a.seed);
      const amp = a.kind === 'boss_leviathan' ? 0.52 : 0.72;
      a.wings.leftInner.rotation.z = flap * amp;
      a.wings.rightInner.rotation.z = -flap * amp;
      if (a.wings.leftOuter && a.wings.rightOuter) {
        a.wings.leftOuter.rotation.z = lag * 0.42;
        a.wings.rightOuter.rotation.z = -lag * 0.42;
      }
    }

    // Dangling barbed feeding tentacles & undulating trailing tails
    for (let i = 0; i < a.tentacles.length; i++) {
      const t = a.tentacles[i];
      if (a.kind === 'boss_leviathan' || a.kind === 'boss_apex') {
        t.rotation.y = Math.sin(now * 5.2 - i * 0.7 + a.seed) * 0.24;
        t.rotation.x = Math.cos(now * 3.8 - i * 0.6 + a.seed) * 0.14;
      } else if (a.kind === 'flyer') {
        const reach = a.diveTimer > 0 || isGrab ? -0.78 : 0.3;
        t.rotation.x = reach + Math.sin(now * 9.5 + i * 1.4 + a.seed) * 0.34;
        t.rotation.z = Math.cos(now * 7.8 + i * 1.7 + a.seed) * 0.24;
      } else {
        t.rotation.y = Math.sin(now * 6.5 + a.seed) * 0.28;
      }
    }

    // 4-Piece split snapping jaws & darting wet crimson tongue!
    const snapFreq = isGrab ? 22 : 11;
    const snapWave = Math.abs(Math.sin(now * snapFreq + a.seed));
    const openAmt = isGrab ? 0.34 + snapWave * 0.48 : snapWave * 0.32;
    for (let i = 0; i < a.jaws.length; i++) {
      const j = a.jaws[i];
      if (j.axis === 'y') j.obj.rotation.y = j.base + j.dir * openAmt;
      else j.obj.rotation.x = j.base + j.dir * openAmt * 0.78;
    }
    if (a.tongue) {
      const dart = isGrab ? 0.75 + Math.sin(now * 18 + a.seed) * 0.45 : 0.55 + Math.sin(now * 9 + a.seed) * 0.25;
      a.tongue.scale.z = Math.max(0.25, dart);
      a.tongue.rotation.x = Math.sin(now * 14 + a.seed) * 0.22;
      a.tongue.rotation.y = Math.cos(now * 11 + a.seed) * 0.22;
    }

    // Twitching barbed feelers
    for (let i = 0; i < a.feelers.length; i++) {
      const f = a.feelers[i];
      f.rotation.x = -0.9 + Math.sin(now * 16 + i * 2.4 + a.seed) * 0.3;
    }

    if (!a.isFlying && !a.airborne && a.state === 'chase' && a.slamWindup <= 0) {
      a.bodyGroup.position.y = Math.abs(Math.sin(a.gaitPhase)) * (a.isBoss ? 0.12 : 0.065) * intensity;
    }

    a.headGroup.rotation.z = Math.sin(now * (isGrab ? 18 : 6.4) + a.seed) * (isGrab ? 0.12 : 0.08);
  }

  // ==========================================================================
  // Combat: Raycast, Damage, Splash, Shove, Grab Pose
  // ==========================================================================

  raycast(raycaster: THREE.Raycaster, maxDist: number, pierce = false): AlienHitResult[] {
    const hits: AlienHitResult[] = [];
    const list = this.aliens as AlienRec[];

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dying') continue;
      if (a.state === 'emerging' && a.emergeT < 0.22) continue;

      _v1.set(a.pos.x, a.pos.y + a.bodyCenterY, a.pos.z);
      const broadR = a.radius * (a.isBoss ? 1.85 : 1.75);
      _sphere.set(_v1, broadR);
      if (!raycaster.ray.intersectSphere(_sphere, _hitPt)) continue;
      const broadDist = raycaster.ray.origin.distanceTo(_hitPt);
      if (broadDist > maxDist + broadR) continue;

      a.root.updateMatrixWorld(true);
      const rawHits = raycaster.intersectObject(a.root, true);
      let chosen: THREE.Intersection | null = null;
      let isWeak = false;

      for (let h = 0; h < rawHits.length; h++) {
        const hit = rawHits[h];
        if (hit.distance > maxDist) break;
        if (!chosen) chosen = hit;
        if (hit.distance - chosen.distance <= 0.45 && isWeakpointObject(hit.object, a.root)) {
          isWeak = true;
          chosen = hit;
          break;
        }
      }

      if (chosen) {
        hits.push({
          alien: a,
          weakpoint: isWeak,
          point: chosen.point.clone(),
          distance: chosen.distance,
        });
        continue;
      }

      // Generous bounding-sphere fallback so fast crawlers feel snappy and fair
      const generousR = a.radius * (a.isBoss ? 1.18 : 1.32);
      _sphere.set(_v1, generousR);
      if (raycaster.ray.intersectSphere(_sphere, _hitPt)) {
        const dist = raycaster.ray.origin.distanceTo(_hitPt);
        if (dist <= maxDist) {
          a.weakpointAnchor.getWorldPosition(_v2);
          const weakR = a.isBoss ? 0.95 : 0.42;
          const weakDistSq = raycaster.ray.distanceSqToPoint(_v2);
          hits.push({
            alien: a,
            weakpoint: weakDistSq <= weakR * weakR,
            point: _hitPt.clone(),
            distance: dist,
          });
        }
      }
    }

    hits.sort((x, y) => x.distance - y.distance);
    if (!pierce && hits.length > 1) {
      hits.length = 1;
    }
    return hits;
  }

  damageAlien(
    alien: Alien,
    amount: number,
    knockDir: THREE.Vector3,
    knockForce: number,
    isCrit: boolean,
    slowSec?: number,
  ): boolean {
    const a = alien as AlienRec;
    if (a.state === 'dying') return false;

    a.hp -= amount;
    a.flashTimer = 0.13;
    a.flashCrit = isCrit;

    if (slowSec && slowSec > 0) {
      a.slowTimer = Math.max(a.slowTimer, slowSec);
    }

    const kbMul = a.isBoss ? 0.25 : 1.0;
    if (knockForce > 0) {
      const kLen = knockDir.length();
      if (kLen > 0.001) {
        a.knockVel.x += (knockDir.x / kLen) * knockForce * kbMul;
        a.knockVel.z += (knockDir.z / kLen) * knockForce * kbMul;
        if (a.isFlying) {
          a.knockVel.y += (knockDir.y / kLen) * knockForce * kbMul * 0.6;
        }
      }
    }

    // Small, wet organic ichor droplets arcing in lunar gravity (no giant squares!)
    const px = a.pos.x;
    const py = a.pos.y + a.bodyCenterY;
    const pz = a.pos.z;
    this.spawnBurst(px, py, pz, isCrit ? 18 : 10, {
      r: isCrit ? a.ichorColor[0] * 1.2 : a.ichorColor[0],
      g: isCrit ? a.ichorColor[1] * 1.2 : a.ichorColor[1],
      b: isCrit ? a.ichorColor[2] * 1.2 : a.ichorColor[2],
      speed: isCrit ? 6.5 : 4.5,
      upSpeed: isCrit ? 4.0 : 2.8,
      scale: isCrit ? 1.05 : 0.78,
      life: 0.72,
      gravity: -3.6,
    });

    if (a.hp <= 0) {
      a.hp = 0;
      a.state = 'dying';
      a.deathTimer = 0;
      a.slamWindup = 0;
      a.diveTimer = 0;
      if (!a.isFlying) {
        a.vel.y = a.isBoss ? 2.2 : 3.2;
      } else {
        a.vel.multiplyScalar(0.5);
      }

      this.spawnBurst(px, py, pz, a.isBoss ? 48 : 24, {
        r: a.ichorColor[0] * 1.15,
        g: a.ichorColor[1] * 1.15,
        b: a.ichorColor[2] * 1.15,
        speed: a.isBoss ? 11.0 : 7.0,
        upSpeed: a.isBoss ? 6.8 : 4.4,
        scale: a.isBoss ? 1.55 : 0.95,
        life: a.isBoss ? 1.2 : 0.88,
        gravity: -3.8,
      });
      this.spawnBurst(px, py, pz, a.isBoss ? 18 : 9, {
        r: 0.22,
        g: 0.14,
        b: 0.16,
        speed: a.isBoss ? 9.0 : 5.8,
        upSpeed: a.isBoss ? 5.8 : 3.6,
        scale: a.isBoss ? 1.35 : 0.8,
        life: 0.92,
        gravity: -4.8,
      });
      return true;
    }

    return false;
  }

  splashDamage(
    center: THREE.Vector3,
    radius: number,
    amount: number,
    slowSec?: number,
  ): { killed: Alien[]; hitCount: number } {
    const killed: Alien[] = [];
    let hitCount = 0;
    const list = this.aliens as AlienRec[];

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dying') continue;

      _v1.set(a.pos.x, a.pos.y + a.bodyCenterY, a.pos.z);
      const dist = _v1.distanceTo(center);
      const reach = radius + a.radius;
      if (dist <= reach) {
        hitCount++;
        const falloff = Math.max(0.35, 1 - (dist / reach) * 0.65);
        _v2.subVectors(_v1, center);
        if (_v2.lengthSq() < 0.001) _v2.set(0, 1, 0);
        const died = this.damageAlien(a, amount * falloff, _v2, 7.2 * falloff, false, slowSec);
        if (died) killed.push(a);
      }
    }

    return { killed, hitCount };
  }

  shoveAway(alien: Alien, awayDir: THREE.Vector3, damage: number, stunSec: number): boolean {
    const a = alien as AlienRec;
    if (a.state === 'dying') return false;

    const dir = awayDir.clone();
    dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
    dir.normalize();

    const pushDist = a.isBoss ? 3.8 : 2.5;
    a.pos.addScaledVector(dir, pushDist);
    if (!a.isFlying) {
      a.pos.y = heightAt(a.pos.x, a.pos.z) + 0.35;
      a.vel.y = a.isBoss ? 2.6 : 4.2;
    } else {
      a.pos.y = Math.max(a.pos.y + 1.4, heightAt(a.pos.x, a.pos.z) + 3.2);
    }
    a.bodyGroup.position.set(0, 0, 0);
    a.bodyGroup.rotation.set(0, 0, 0);
    a.root.up.set(0, 1, 0);
    a.root.position.copy(a.pos);

    a.state = 'stunned';
    a.stunTimer = stunSec;
    a.grabCooldown = stunSec + 1.1;

    const force = a.isBoss ? 18 : 13;
    return this.damageAlien(a, damage, dir, force, false);
  }

  /**
   * Positions the grabbing alien's grotesque head, glaring eyes, and snapping fanged jaws
   * cleanly 1.15m..1.6m in front of the helmet visor (accounting for headFrontZ so it NEVER
   * clips inside the lens or turns into a solid black wall), facing straight at the camera!
   */
  setGrabPose(alien: Alien, camera: THREE.PerspectiveCamera, progress: number, now: number): void {
    const a = alien as AlienRec;
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Exact distance from camera to the alien's FACE/EYES: 1.15m..1.6m (bosses 1.6m..2.05m)
    const faceDist = (a.isBoss ? 1.6 : 1.15) + p * 0.45;
    const rootDist = faceDist + a.headGroup.position.z;

    const shakeX = Math.sin(now * 28 + a.seed) * 0.045 * (1 - p * 0.35);
    const shakeY = Math.cos(now * 24 + a.seed) * 0.035 * (1 - p * 0.35);
    // Place headGroup cleanly at +0.34m above camera center (framing right above the center grab card!)
    const targetHeadY = a.isBoss ? 0.28 : 0.34;
    const verticalOffset = targetHeadY - a.headGroup.position.y;

    a.pos
      .copy(_camPos)
      .addScaledVector(_camFwd, rootDist)
      .addScaledVector(_camUp, verticalOffset + shakeY)
      .addScaledVector(_camRight, shakeX);

    a.root.position.copy(a.pos);
    a.root.up.copy(_camUp);
    // Face directly anti-parallel to camera forward so headGroup sits at exact (0, targetHeadY, faceDist)!
    _v1.copy(a.pos).addScaledVector(_camFwd, -5);
    a.root.lookAt(_v1);

    // Subtle frantic struggle lunge & roll thrash while keeping face & jaws centered and unobstructed
    a.bodyGroup.position.set(0, 0, Math.sin(now * 20) * 0.05);
    a.bodyGroup.rotation.set(0.14 * (1 - p * 0.4), 0, Math.sin(now * 22 + a.seed) * 0.12);
  }

  // ==========================================================================
  // Projectiles, Shockwaves, Disgusting Eruption Mounds & Droplet Pool
  // ==========================================================================

  private fireProjectile(
    a: AlienRec,
    target: THREE.Vector3,
    speed: number,
    dmg: number,
    style: 'acid' | 'plasma' | 'violet',
    yawSpread: number,
  ): void {
    const start = new THREE.Vector3(a.pos.x, a.pos.y + a.bodyCenterY, a.pos.z);
    const dir = target.clone().sub(start);
    const dist = dir.length() || 1;
    dir.divideScalar(dist);

    if (yawSpread !== 0) {
      const ca = Math.cos(yawSpread);
      const sa = Math.sin(yawSpread);
      const nx = dir.x * ca - dir.z * sa;
      const nz = dir.x * sa + dir.z * ca;
      dir.x = nx;
      dir.z = nz;
      dir.normalize();
    }

    const gravity = style === 'acid' ? -3.4 : 0;
    if (gravity < 0) {
      const tFlight = dist / speed;
      dir.y += (-0.5 * gravity * tFlight) / speed;
      dir.normalize();
    }

    const coreMat =
      style === 'acid'
        ? this.assets.mat.projAcid
        : style === 'violet'
          ? this.assets.mat.projViolet
          : this.assets.mat.projPlasma;
    const haloMat =
      style === 'acid'
        ? this.assets.mat.projHaloAcid
        : style === 'violet'
          ? this.assets.mat.projHaloViolet
          : this.assets.mat.projHaloCyan;

    const mesh = new THREE.Mesh(this.assets.geo.projCore, coreMat);
    mesh.position.copy(start);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.shadowLazy = true;
    const scale = a.isBoss ? 1.45 : 1.0;
    mesh.scale.setScalar(scale);

    const halo = new THREE.Mesh(this.assets.geo.projHalo, haloMat);
    halo.castShadow = false;
    halo.userData.shadowLazy = true;
    mesh.add(halo);
    this.group.add(mesh);

    const color: [number, number, number] =
      style === 'acid' ? [0.4, 2.1, 0.4] : style === 'violet' ? [1.8, 0.45, 2.4] : [0.35, 2.0, 2.4];

    this.projectiles.push({
      pos: start,
      vel: dir.multiplyScalar(speed),
      dmg,
      life: 4.5,
      mesh,
      gravity,
      trailTimer: 0,
      color,
    });
  }

  private updateProjectiles(ctx: AlienUpdateCtx, callbacks: AlienCallbacks, dt: number, habBaseY: number): void {
    const hitCenter = ctx.inRover
      ? _v2.set(ctx.roverPos.x, ctx.roverPos.y + 1.1, ctx.roverPos.z)
      : _v2.set(ctx.playerEye.x, ctx.playerEye.y - 0.5, ctx.playerEye.z);
    const hitR = ctx.inRover ? 2.15 : 1.05;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.gravity !== 0) p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += 7 * dt;
      p.mesh.rotation.y += 9 * dt;

      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.05;
        this.spawnBurst(p.pos.x, p.pos.y, p.pos.z, 1, {
          r: p.color[0],
          g: p.color[1],
          b: p.color[2],
          speed: 0.65,
          upSpeed: 0.25,
          scale: 0.55,
          life: 0.25,
          gravity: -0.5,
        });
      }

      let remove = p.life <= 0;

      if (!remove && p.pos.y < habBaseY + 7.0) {
        const hd = Math.hypot(p.pos.x - ctx.habCenter.x, p.pos.z - ctx.habCenter.z);
        if (hd < HAB_EXCLUSION_RADIUS) {
          remove = true;
          this.spawnBurst(p.pos.x, p.pos.y, p.pos.z, 8, {
            r: p.color[0],
            g: p.color[1],
            b: p.color[2],
            speed: 4.0,
            upSpeed: 2.0,
            scale: 0.72,
            life: 0.45,
            gravity: -3.2,
          });
        }
      }

      if (!remove && !ctx.habInside && p.pos.distanceTo(hitCenter) <= hitR) {
        remove = true;
        this.spawnBurst(p.pos.x, p.pos.y, p.pos.z, 12, {
          r: p.color[0],
          g: p.color[1],
          b: p.color[2],
          speed: 5.2,
          upSpeed: 2.4,
          scale: 0.8,
          life: 0.5,
          gravity: -3.0,
        });
        callbacks.onRangedHit(p.dmg, p.pos.clone());
      }

      if (!remove && p.pos.y <= heightAt(p.pos.x, p.pos.z) + 0.12) {
        remove = true;
        this.spawnBurst(p.pos.x, p.pos.y + 0.1, p.pos.z, 8, {
          r: p.color[0],
          g: p.color[1],
          b: p.color[2],
          speed: 3.8,
          upSpeed: 2.8,
          scale: 0.7,
          life: 0.55,
          gravity: -3.8,
        });
      }

      if (remove) {
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private spawnShockwave(
    x: number,
    y: number,
    z: number,
    maxRadius: number,
    speed: number,
    dmg: number,
    colorHex: number,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.assets.geo.shockRing, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.6);
    mesh.castShadow = false;
    mesh.userData.shadowLazy = true;
    this.group.add(mesh);

    this.shockwaves.push({
      mesh,
      mat,
      center: new THREE.Vector3(x, y, z),
      radius: 0.6,
      maxRadius,
      speed,
      dmg,
      hitPlayer: false,
    });
  }

  private updateShockwaves(ctx: AlienUpdateCtx, callbacks: AlienCallbacks, dt: number): void {
    const pPos = ctx.inRover ? ctx.roverPos : ctx.playerPos;
    const playerGroundClear = pPos.y - heightAt(pPos.x, pPos.z);

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += sw.speed * dt;
      sw.mesh.scale.setScalar(sw.radius);
      const t = sw.radius / sw.maxRadius;
      sw.mat.opacity = Math.max(0, (1 - t) * 0.92);

      if (!sw.hitPlayer && !ctx.habInside) {
        const d = Math.hypot(pPos.x - sw.center.x, pPos.z - sw.center.z);
        if (Math.abs(d - sw.radius) < 1.45 && playerGroundClear < 2.15) {
          sw.hitPlayer = true;
          callbacks.onShockwave(sw.dmg, d);
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.group.remove(sw.mesh);
        sw.mat.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  /** Grotesque eruption crater: torn dark regolith rocks + pulsing fleshy slime rim + writhing tendrils! */
  private spawnEruptionMound(x: number, y: number, z: number, scale: number): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.03, z);
    g.scale.setScalar(scale);

    addMesh(this.assets.geo.moundRing, this.assets.mat.moundRegolith, g, {});
    addMesh(this.assets.geo.moundPit, this.assets.mat.moundPit, g, { pos: [0, 0.05, 0] });
    // Fleshy wet slime lining around the inside of the burrow rim
    addMesh(this.assets.geo.mawRing, this.assets.mat.fleshBloody, g, {
      pos: [0, 0.12, 0],
      rot: [Math.PI / 2, 0, 0],
      scale: [3.6, 3.6, 1.4],
    });
    const fissure = addMesh(this.assets.geo.moundFissure, this.assets.mat.moundFissure, g, { pos: [0, 0.09, 0] });

    // 6 Jagged torn moon-rock chunks + 6 writhing fleshy slime tendrils around the hole!
    const tendrils: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.35;
      const r = 0.94 + Math.random() * 0.32;
      addMesh(this.assets.geo.moundRock, this.assets.mat.moundRegolith, g, {
        pos: [Math.cos(a) * r, 0.16 + Math.random() * 0.14, Math.sin(a) * r],
        rot: [Math.random() * 2, Math.random() * 3, Math.random() * 2],
        scale: [0.85 + Math.random() * 0.65, 0.75 + Math.random() * 0.6, 0.85 + Math.random() * 0.65],
      });

      const tg = new THREE.Group();
      tg.position.set(Math.cos(a + 0.3) * 0.76, 0.14, Math.sin(a + 0.3) * 0.76);
      tg.rotation.set(Math.PI + 0.55, a + 0.3, 0);
      addMesh(this.assets.geo.tentacle, this.assets.mat.fleshBloody, tg, { scale: [0.85, 0.82, 0.85] });
      g.add(tg);
      tendrils.push(tg);
    }

    this.group.add(g);
    this.mounds.push({
      group: g,
      fissure,
      tendrils,
      baseY: y + 0.03,
      age: 0,
      maxAge: scale > 1.8 ? 11.0 : 7.5,
      scale,
    });
  }

  private updateMounds(dt: number, now: number): void {
    for (let i = this.mounds.length - 1; i >= 0; i--) {
      const m = this.mounds[i];
      m.age += dt;
      if (m.age < 2.6) {
        m.fissure.visible = true;
        const p = 0.86 + Math.sin(now * 14 + i) * 0.18;
        m.fissure.scale.setScalar(p);
      } else {
        m.fissure.visible = false;
      }

      // Writhing fleshy crater tendrils
      for (let t = 0; t < m.tendrils.length; t++) {
        m.tendrils[t].rotation.x = Math.PI + 0.55 + Math.sin(now * 6.5 + t * 1.3 + i) * 0.32;
      }

      const remain = m.maxAge - m.age;
      if (remain < 1.8) {
        const k = Math.max(0, remain / 1.8);
        m.group.position.y = m.baseY - (1 - k) * 0.55 * m.scale;
        m.group.scale.setScalar(m.scale * (0.25 + 0.75 * k));
      }

      if (m.age >= m.maxAge) {
        this.group.remove(m.group);
        this.mounds.splice(i, 1);
      }
    }
  }

  private spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    opts: {
      r: number;
      g: number;
      b: number;
      speed: number;
      upSpeed: number;
      scale: number;
      life: number;
      gravity: number;
    },
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;

      const ang = Math.random() * Math.PI * 2;
      const spd = opts.speed * (0.35 + Math.random() * 0.75);
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 0.35;
      slot.y = y + (Math.random() - 0.5) * 0.25;
      slot.z = z + (Math.random() - 0.5) * 0.35;
      slot.vx = Math.cos(ang) * spd;
      slot.vy = opts.upSpeed * (0.4 + Math.random() * 0.85);
      slot.vz = Math.sin(ang) * spd;
      slot.scale = opts.scale * (0.65 + Math.random() * 0.65);
      slot.maxLife = opts.life * (0.65 + Math.random() * 0.55);
      slot.life = slot.maxLife;
      slot.gravity = opts.gravity;
      const jitter = 0.85 + Math.random() * 0.3;
      slot.r = opts.r * jitter;
      slot.g = opts.g * jitter;
      slot.b = opts.b * jitter;
    }
    this.particlesDirty = true;
  }

  private updateParticles(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _mat4);
        this.particlesDirty = true;
        continue;
      }

      anyActive = true;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = p.life / p.maxLife;
      const sc = p.scale * (0.3 + 0.7 * t);
      _v1.set(p.x, p.y, p.z);
      _euler.set(p.life * 6, p.life * 4.5, 0);
      _quat.setFromEuler(_euler);
      _scale.set(sc, sc * 1.15, sc * 0.9);
      _mat4.compose(_v1, _quat, _scale);
      this.particleMesh.setMatrixAt(i, _mat4);

      _col.setRGB(p.r * t, p.g * t, p.b * t);
      this.particleMesh.setColorAt(i, _col);
    }

    if (anyActive || this.particlesDirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
      this.particlesDirty = anyActive;
    }
  }
}

// ============================================================================
// Small Math / Hierarchy Helpers
// ============================================================================

function isWeakpointObject(obj: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur && cur !== stopAt) {
    if (cur.userData && cur.userData.weakpoint === true) return true;
    cur = cur.parent;
  }
  return false;
}

function angleDiff(target: number, current: number): number {
  let d = (target - current + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
}

function lerpAngle(current: number, target: number, t: number): number {
  return current + angleDiff(target, current) * t;
}
