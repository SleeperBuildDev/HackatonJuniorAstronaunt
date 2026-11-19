// Lunar Defense 3D Weapons, Rover Twin-Cannon Turret & Pooled Combat VFX.
// Four procedural first-person weapon viewmodels attached to the camera, a
// tracking twin-cannon turret on the lunar rover, juicy viewmodel animation,
// and zero-GC pooled tracers, railgun shock rings, cryo-plasma orbs, explosions,
// and lunar-gravity impact sparks.

import * as THREE from 'three';
import { heightAt } from '../world/heightfield';

export type WeaponId = 'carbine' | 'shotgun' | 'railgun' | 'plasma';

export interface PlasmaOrbHit {
  pos: THREE.Vector3;
  radius: number;
  damage: number;
  slowSec: number;
}

export interface WeaponUpdateCtx {
  moving: boolean;
  sprinting: boolean;
  grounded: boolean;
  lookDX: number;
  lookDY: number;
  aimPitch: number;
  aimYaw: number;
  inRover: boolean;
  stunned: boolean;
  camera: THREE.PerspectiveCamera;
}

interface WeaponVisualSpec {
  color: number;
  tracerRadius: number;
  tracerLife: number;
  recoilZ: number;
  recoilPitch: number;
  flashScale: number;
  muzzleLocal: THREE.Vector3;
}

const WEAPON_SPECS: Record<WeaponId, WeaponVisualSpec> = {
  carbine: {
    color: 0x38f4ff,
    tracerRadius: 0.016,
    tracerLife: 0.085,
    recoilZ: 0.042,
    recoilPitch: 0.055,
    flashScale: 0.95,
    muzzleLocal: new THREE.Vector3(0, 0.032, -0.45),
  },
  shotgun: {
    color: 0xffaa28,
    tracerRadius: 0.015,
    tracerLife: 0.08,
    recoilZ: 0.095,
    recoilPitch: 0.145,
    flashScale: 1.45,
    muzzleLocal: new THREE.Vector3(0, 0.028, -0.43),
  },
  railgun: {
    color: 0xaef8ff,
    tracerRadius: 0.036,
    tracerLife: 0.28,
    recoilZ: 0.11,
    recoilPitch: 0.16,
    flashScale: 1.55,
    muzzleLocal: new THREE.Vector3(0, 0.03, -0.58),
  },
  plasma: {
    color: 0xe048ff,
    tracerRadius: 0.028,
    tracerLife: 0.11,
    recoilZ: 0.075,
    recoilPitch: 0.11,
    flashScale: 1.35,
    muzzleLocal: new THREE.Vector3(0, 0.022, -0.42),
  },
};

const BASE_POS = new THREE.Vector3(0.24, -0.22, -0.46);
const LUNAR_GRAVITY = 1.62 * 2.15; // lunar 1.62 m/s² with subtle punchy downward pull

const MAX_TRACERS = 32;
const MAX_SHOCK_RINGS = 24;
const MAX_ORBS = 12;
const MAX_EXPLOSIONS = 10;
const MAX_SPARKS = 160;

interface TracerSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  life: number;
  baseRadius: number;
  length: number;
}

interface ShockRingSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  life: number;
  maxScale: number;
}

interface OrbSlot {
  group: THREE.Group;
  ring: THREE.Mesh;
  halo: THREE.Mesh;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxLife: number;
  damage: number;
  splashRadius: number;
  slowSec: number;
}

interface ExplosionSlot {
  group: THREE.Group;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  shell: THREE.Mesh;
  shellMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  life: number;
  radius: number;
}

interface SparkSlot {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
}

// Reusable scratch objects (zero per-frame allocations)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _invQuat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

function disableShadowsAndCulling(root: THREE.Object3D, renderOrder = 0, noCull = false) {
  root.traverse((obj) => {
    obj.castShadow = false;
    obj.receiveShadow = false;
    if (noCull) obj.frustumCulled = false;
    if (renderOrder > 0) obj.renderOrder = renderOrder;
  });
}

function makeMat(opts: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(opts);
}

export class WeaponRig {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly roverObj: THREE.Object3D;

  // Shared materials for weapons & turret
  private readonly matWhite: THREE.MeshStandardMaterial;
  private readonly matTitanium: THREE.MeshStandardMaterial;
  private readonly matGunmetal: THREE.MeshStandardMaterial;
  private readonly matDarkGrip: THREE.MeshStandardMaterial;
  private readonly matHazardAmber: THREE.MeshStandardMaterial;
  private readonly matCyanGlow: THREE.MeshStandardMaterial;
  private readonly matIceCyanGlow: THREE.MeshStandardMaterial;
  private readonly matAmberGlow: THREE.MeshStandardMaterial;
  private readonly matMagentaGlow: THREE.MeshStandardMaterial;
  private readonly matCryoFrost: THREE.MeshStandardMaterial;

  // First-person viewmodel hierarchy
  private readonly rigRoot = new THREE.Group();
  private readonly viewmodelPivot = new THREE.Group();
  private readonly weaponModels: Record<WeaponId, THREE.Group>;
  private readonly fpMuzzleFlash = new THREE.Group();
  private readonly fpMuzzleFlashMat: THREE.MeshBasicMaterial;
  private readonly fpMuzzleLight: THREE.PointLight;

  // Animated weapon sub-parts
  private shotgunPump!: THREE.Object3D;
  private railgunCaps: THREE.Mesh[] = [];
  private plasmaCore!: THREE.Mesh;
  private plasmaRingA!: THREE.Mesh;
  private plasmaRingB!: THREE.Mesh;
  private carbineHoloRing!: THREE.Mesh;

  // Rover twin-cannon turret hierarchy
  private readonly turretRoot = new THREE.Group();
  private readonly turretYawPivot = new THREE.Group();
  private readonly turretPitchPivot = new THREE.Group();
  private readonly turretLeftBarrel = new THREE.Group();
  private readonly turretRightBarrel = new THREE.Group();
  private readonly turretLeftMuzzle = new THREE.Object3D();
  private readonly turretRightMuzzle = new THREE.Object3D();
  private readonly turretFlashMesh: THREE.Group;
  private readonly turretFlashMat: THREE.MeshBasicMaterial;
  private readonly turretFlashLight: THREE.PointLight;
  private turretYaw = 0;
  private turretPitch = 0.04;
  private turretLeftRecoil = 0;
  private turretRightRecoil = 0;
  private turretBarrelToggle = false;
  private turretFlashTimer = 0;

  // State & animation
  private active = false;
  private inRover = false;
  private currentWeapon: WeaponId = 'carbine';
  private reloadProgress = 0;
  private switchAnim = 0; // 1 -> 0 raise-up
  private recoilZ = 0;
  private recoilPitch = 0;
  private recoilRoll = 0;
  private pumpAnim = 0;
  private fpFlashTimer = 0;
  private lastFireTime = -10;
  private elapsed = 0;

  // Smooth sway / bob state
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobBlend = 0;
  private sprintBlend = 0;
  private stunBlend = 0;
  private airDip = 0;

  // Pooled VFX
  private readonly vfxRoot = new THREE.Group();
  private readonly tracers: TracerSlot[] = [];
  private readonly shockRings: ShockRingSlot[] = [];
  private readonly orbs: OrbSlot[] = [];
  private readonly explosions: ExplosionSlot[] = [];
  private readonly sparks: SparkSlot[] = [];
  private readonly sparkMesh: THREE.InstancedMesh;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, roverObj: THREE.Object3D) {
    this.scene = scene;
    this.camera = camera;
    this.roverObj = roverObj;

    // Materials tuned for lunar lighting + AGX bloom (emissiveIntensity > 1.2 triggers bloom)
    this.matWhite = makeMat({ color: 0xe6ecf5, roughness: 0.36, metalness: 0.22 });
    this.matTitanium = makeMat({ color: 0x262d38, roughness: 0.42, metalness: 0.72 });
    this.matGunmetal = makeMat({ color: 0x3b4452, roughness: 0.48, metalness: 0.65 });
    this.matDarkGrip = makeMat({ color: 0x161a22, roughness: 0.78, metalness: 0.18 });
    this.matHazardAmber = makeMat({ color: 0xf59e0b, roughness: 0.4, metalness: 0.25 });
    this.matCyanGlow = makeMat({
      color: 0x38f4ff,
      emissive: 0x22e8ff,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.1,
    });
    this.matIceCyanGlow = makeMat({
      color: 0xbef9ff,
      emissive: 0x62f2ff,
      emissiveIntensity: 2.7,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.matAmberGlow = makeMat({
      color: 0xffc048,
      emissive: 0xff8c1a,
      emissiveIntensity: 2.2,
      roughness: 0.22,
      metalness: 0.15,
    });
    this.matMagentaGlow = makeMat({
      color: 0xf065ff,
      emissive: 0xd828ff,
      emissiveIntensity: 2.6,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.matCryoFrost = makeMat({
      color: 0x9be9ff,
      emissive: 0x2aa8d8,
      emissiveIntensity: 0.75,
      roughness: 0.32,
      metalness: 0.3,
    });

    // First-person rig attached to camera
    this.rigRoot.position.copy(BASE_POS);
    this.rigRoot.add(this.viewmodelPivot);
    this.rigRoot.visible = false;
    this.camera.add(this.rigRoot);

    // Build all 4 weapon viewmodels
    this.weaponModels = {
      carbine: this.buildCarbine(),
      shotgun: this.buildShotgun(),
      railgun: this.buildRailgun(),
      plasma: this.buildPlasma(),
    };
    for (const id of Object.keys(this.weaponModels) as WeaponId[]) {
      const m = this.weaponModels[id];
      disableShadowsAndCulling(m, 20, true);
      m.visible = id === this.currentWeapon;
      this.viewmodelPivot.add(m);
    }

    // First-person muzzle flash + dynamic light
    this.fpMuzzleFlashMat = new THREE.MeshBasicMaterial({
      color: 0x66f8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.buildFlashStar(this.fpMuzzleFlash, this.fpMuzzleFlashMat, 0.085);
    disableShadowsAndCulling(this.fpMuzzleFlash, 25, true);
    this.fpMuzzleFlash.visible = false;
    this.viewmodelPivot.add(this.fpMuzzleFlash);

    this.fpMuzzleLight = new THREE.PointLight(0x38f4ff, 0, 7, 2);
    this.fpMuzzleLight.castShadow = false;
    this.viewmodelPivot.add(this.fpMuzzleLight);

    // Build rover mounted twin-cannon turret
    this.turretFlashMat = new THREE.MeshBasicMaterial({
      color: 0x66f8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.turretFlashMesh = new THREE.Group();
    this.buildFlashStar(this.turretFlashMesh, this.turretFlashMat, 0.16);
    this.turretFlashMesh.rotation.y = -Math.PI / 2; // align -Z star cone along +X turret barrel
    this.turretFlashMesh.visible = false;

    this.turretFlashLight = new THREE.PointLight(0x38f4ff, 0, 10, 2);
    this.turretFlashLight.castShadow = false;

    this.buildRoverTurret();
    this.turretRoot.visible = false;
    this.roverObj.add(this.turretRoot);

    // World-space VFX root
    this.vfxRoot.name = 'WeaponVFXRoot';
    this.scene.add(this.vfxRoot);

    // Initialize pooled tracers
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38f4ff,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.vfxRoot.add(mesh);
      this.tracers.push({ mesh, mat, active: false, age: 0, life: 0.1, baseRadius: 0.02, length: 1 });
    }

    // Initialize pooled railgun shock rings
    const ringGeo = new THREE.TorusGeometry(0.28, 0.026, 8, 20);
    for (let i = 0; i < MAX_SHOCK_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbef9ff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      this.vfxRoot.add(mesh);
      this.shockRings.push({ mesh, mat, active: false, age: 0, life: 0.32, maxScale: 2.2 });
    }

    // Initialize pooled cryo-plasma orbs
    const orbCoreGeo = new THREE.SphereGeometry(0.16, 12, 10);
    const orbHaloGeo = new THREE.SphereGeometry(0.32, 12, 10);
    const orbRingGeo = new THREE.TorusGeometry(0.27, 0.025, 6, 18);
    const orbCoreMat = new THREE.MeshBasicMaterial({ color: 0xffe6ff, toneMapped: false });
    const orbHaloMat = new THREE.MeshBasicMaterial({
      color: 0xd938ff,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const orbRingMat = new THREE.MeshBasicMaterial({
      color: 0x7ef6ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < MAX_ORBS; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(orbCoreGeo, orbCoreMat);
      const halo = new THREE.Mesh(orbHaloGeo, orbHaloMat);
      const ring = new THREE.Mesh(orbRingGeo, orbRingMat);
      group.add(core, halo, ring);
      disableShadowsAndCulling(group);
      group.visible = false;
      this.vfxRoot.add(group);
      this.orbs.push({
        group,
        ring,
        halo,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxLife: 4.5,
        damage: 0,
        splashRadius: 3,
        slowSec: 0,
      });
    }

    // Initialize pooled explosions
    const expSphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const expRingGeo = new THREE.TorusGeometry(1, 0.08, 8, 28);
    for (let i = 0; i < MAX_EXPLOSIONS; i++) {
      const group = new THREE.Group();
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const shellMat = new THREE.MeshBasicMaterial({
        color: 0xd938ff,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x9ef6ff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const core = new THREE.Mesh(expSphereGeo, coreMat);
      const shell = new THREE.Mesh(expSphereGeo, shellMat);
      const ring = new THREE.Mesh(expRingGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(core, shell, ring);
      disableShadowsAndCulling(group);
      group.visible = false;
      this.vfxRoot.add(group);
      this.explosions.push({
        group,
        core,
        coreMat,
        shell,
        shellMat,
        ring,
        ringMat,
        active: false,
        age: 0,
        life: 0.46,
        radius: 3,
      });
    }

    // Initialize pooled sparks (single InstancedMesh draw call)
    const sparkGeo = new THREE.BoxGeometry(0.032, 0.032, 0.16);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkMesh.castShadow = false;
    this.sparkMesh.receiveShadow = false;
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
    _mat4.makeScale(0, 0, 0);
    _color.setHex(0xffffff);
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkMesh.setMatrixAt(i, _mat4);
      this.sparkMesh.setColorAt(i, _color);
      this.sparks.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        life: 0.4,
        size: 1,
        color: new THREE.Color(0xffffff),
      });
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    this.vfxRoot.add(this.sparkMesh);
  }

  // ---------------------------------------------------------------------------
  // Procedural 3D Weapon Builders
  // ---------------------------------------------------------------------------

  private buildFlashStar(group: THREE.Group, mat: THREE.MeshBasicMaterial, size: number) {
    const planeGeo = new THREE.PlaneGeometry(size * 2.2, size * 0.72);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(planeGeo, mat);
      p.rotation.z = (i * Math.PI) / 3;
      group.add(p);
    }
    const coneGeo = new THREE.ConeGeometry(size * 0.55, size * 2.1, 6, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.position.z = -size * 0.95;
    group.add(cone);
  }

  /** 1. Pulse Carbine: Sleek white-NASA / dark-titanium rifle with twin cyan rails & holo sight. */
  private buildCarbine(): THREE.Group {
    const g = new THREE.Group();

    // Main dark titanium chassis
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.072, 0.38), this.matTitanium);
    lower.position.set(0, 0.0, -0.06);
    g.add(lower);

    // Sleek white-NASA upper shroud
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.044, 0.34), this.matWhite);
    upper.position.set(0, 0.046, -0.09);
    g.add(upper);

    // Sloped rear buttstock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.088, 0.14), this.matWhite);
    stock.position.set(0, -0.005, 0.16);
    g.add(stock);

    // Ergonomic angled grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.11, 0.05), this.matDarkGrip);
    grip.position.set(0, -0.072, 0.055);
    grip.rotation.x = 0.26;
    g.add(grip);

    // Detachable battery magazine block + glowing charge indicator
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.105, 0.075), this.matGunmetal);
    mag.position.set(0, -0.078, -0.095);
    mag.rotation.x = -0.14;
    g.add(mag);

    const magBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.016), this.matCyanGlow);
    magBar.position.set(0, -0.072, -0.095);
    magBar.rotation.x = -0.14;
    g.add(magBar);

    // Barrel core
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.24, 10), this.matGunmetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.032, -0.33);
    g.add(barrel);

    // Twin glowing cyan energy rails along barrel sides
    const railGeo = new THREE.BoxGeometry(0.009, 0.014, 0.28);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, this.matCyanGlow);
      rail.position.set(side * 0.036, 0.038, -0.24);
      g.add(rail);
    }

    // Cooling fins along mid-barrel
    const finGeo = new THREE.BoxGeometry(0.076, 0.01, 0.014);
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(finGeo, this.matTitanium);
      fin.position.set(0, 0.012, -0.21 - i * 0.032);
      g.add(fin);
    }

    // Muzzle shroud
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.042, 0.055), this.matTitanium);
    muzzle.position.set(0, 0.032, -0.43);
    g.add(muzzle);

    // Holographic sight housing + floating cyan sight ring
    const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.016, 0.075), this.matTitanium);
    sightBase.position.set(0, 0.076, -0.04);
    g.add(sightBase);

    const postGeo = new THREE.BoxGeometry(0.007, 0.044, 0.055);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, this.matTitanium);
      post.position.set(side * 0.025, 0.1, -0.04);
      g.add(post);
    }
    const sightTop = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.007, 0.055), this.matWhite);
    sightTop.position.set(0, 0.122, -0.04);
    g.add(sightTop);

    this.carbineHoloRing = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0022, 6, 16), this.matCyanGlow);
    this.carbineHoloRing.position.set(0, 0.101, -0.04);
    g.add(this.carbineHoloRing);

    return g;
  }

  /** 2. Regolith Scattergun: Chunky dual-barrel pump scattergun with amber plasma coils. */
  private buildShotgun(): THREE.Group {
    const g = new THREE.Group();

    // Heavy angular receiver
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.092, 0.28), this.matGunmetal);
    receiver.position.set(0, 0.01, -0.03);
    g.add(receiver);

    // Top NASA-white armor plate + hazard amber side stripes
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.022, 0.24), this.matWhite);
    topPlate.position.set(0, 0.062, -0.04);
    g.add(topPlate);

    const stripeGeo = new THREE.BoxGeometry(0.092, 0.016, 0.14);
    const stripe = new THREE.Mesh(stripeGeo, this.matHazardAmber);
    stripe.position.set(0, 0.028, -0.04);
    g.add(stripe);

    // Chunky stock & grip
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.096, 0.16), this.matTitanium);
    stock.position.set(0, -0.01, 0.16);
    g.add(stock);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.11, 0.055), this.matDarkGrip);
    grip.position.set(0, -0.072, 0.06);
    grip.rotation.x = 0.28;
    g.add(grip);

    // Dual heavy matte-gunmetal barrels
    const barrelGeo = new THREE.CylinderGeometry(0.02, 0.021, 0.32, 10);
    barrelGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(barrelGeo, this.matGunmetal);
      b.position.set(side * 0.024, 0.036, -0.26);
      g.add(b);
    }

    // Hazard-yellow / amber plasma coils wrapped around barrels
    const coilGeo = new THREE.BoxGeometry(0.094, 0.052, 0.018);
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(coilGeo, this.matAmberGlow);
      coil.position.set(0, 0.036, -0.19 - i * 0.042);
      g.add(coil);
    }

    // Bulky ribbed pump forend (slides on recoil)
    const pumpGroup = new THREE.Group();
    const forend = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.056, 0.16), this.matDarkGrip);
    forend.position.set(0, -0.026, -0.25);
    pumpGroup.add(forend);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.012, 0.016), this.matHazardAmber);
      rib.position.set(0, -0.03, -0.19 - i * 0.036);
      pumpGroup.add(rib);
    }
    this.shotgunPump = pumpGroup;
    g.add(pumpGroup);

    // Wide slotted muzzle brake
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.064, 0.062), this.matTitanium);
    brake.position.set(0, 0.034, -0.415);
    g.add(brake);

    // Ghost-ring iron sight
    const ghostRing = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0035, 6, 14), this.matAmberGlow);
    ghostRing.position.set(0, 0.092, -0.02);
    g.add(ghostRing);

    return g;
  }

  /** 3. Arc Railgun: Long twin-rail electromagnetic lance with pulsing ice-cyan capacitors. */
  private buildRailgun(): THREE.Group {
    const g = new THREE.Group();
    this.railgunCaps = [];

    // Heavy rear battery housing
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.088, 0.3), this.matTitanium);
    body.position.set(0, 0.005, 0.01);
    g.add(body);

    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.044, 0.22), this.matWhite);
    cheek.position.set(0, 0.048, 0.03);
    g.add(cheek);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.11, 0.052), this.matDarkGrip);
    grip.position.set(0, -0.076, 0.065);
    grip.rotation.x = 0.24;
    g.add(grip);

    // Split twin magnetic accelerator rails
    const railUpperGeo = new THREE.BoxGeometry(0.018, 0.022, 0.48);
    const railLowerGeo = new THREE.BoxGeometry(0.016, 0.018, 0.46);
    for (const side of [-1, 1]) {
      const rTop = new THREE.Mesh(railUpperGeo, this.matWhite);
      rTop.position.set(side * 0.032, 0.048, -0.34);
      g.add(rTop);

      const rBot = new THREE.Mesh(railLowerGeo, this.matTitanium);
      rBot.position.set(side * 0.032, 0.006, -0.33);
      g.add(rBot);

      // Inner glowing accelerator strips
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.012, 0.44), this.matIceCyanGlow);
      strip.position.set(side * 0.02, 0.028, -0.34);
      g.add(strip);
    }

    // 5 pulsing ice-cyan capacitor cores along the central spine
    const capGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.034, 8);
    capGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const cap = new THREE.Mesh(capGeo, this.matIceCyanGlow.clone());
      cap.position.set(0, 0.028, -0.17 - i * 0.082);
      g.add(cap);
      this.railgunCaps.push(cap);
    }

    // Precision sniper scope assembly
    const scopeMount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.12), this.matTitanium);
    scopeMount.position.set(0, 0.082, -0.05);
    g.add(scopeMount);

    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.22, 12), this.matGunmetal);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.106, -0.07);
    g.add(scopeTube);

    const scopeLens = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 16), this.matIceCyanGlow);
    scopeLens.position.set(0, 0.106, 0.041);
    g.add(scopeLens);

    return g;
  }

  /** 4. Cryo-Plasma Blaster: Heavy industrial launcher with glowing violet orb & triple prongs. */
  private buildPlasma(): THREE.Group {
    const g = new THREE.Group();

    // Industrial curved-feel rear housing
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.095, 0.26), this.matTitanium);
    body.position.set(0, 0.005, 0.02);
    g.add(body);

    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.06, 0.22, 10), this.matWhite);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.set(0, 0.038, -0.03);
    g.add(cowl);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.115, 0.056), this.matDarkGrip);
    grip.position.set(0, -0.078, 0.065);
    grip.rotation.x = 0.25;
    g.add(grip);

    // Side cryo-frost cooling vents
    const ventGeo = new THREE.BoxGeometry(0.018, 0.042, 0.12);
    for (const side of [-1, 1]) {
      const vent = new THREE.Mesh(ventGeo, this.matCryoFrost);
      vent.position.set(side * 0.058, 0.02, -0.06);
      g.add(vent);
    }

    // Glowing violet-magenta containment chamber orb + magnetic rings
    this.plasmaCore = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), this.matMagentaGlow);
    this.plasmaCore.position.set(0, 0.026, -0.22);
    g.add(this.plasmaCore);

    const shellMat = new THREE.MeshBasicMaterial({
      color: 0xd938ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 12), shellMat);
    shell.position.copy(this.plasmaCore.position);
    g.add(shell);

    this.plasmaRingA = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.005, 6, 18), this.matCyanGlow);
    this.plasmaRingA.position.copy(this.plasmaCore.position);
    g.add(this.plasmaRingA);

    this.plasmaRingB = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.005, 6, 18), this.matMagentaGlow);
    this.plasmaRingB.position.copy(this.plasmaCore.position);
    this.plasmaRingB.rotation.x = Math.PI / 2;
    g.add(this.plasmaRingB);

    // Front emitter collar
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.014, 8, 16), this.matGunmetal);
    collar.position.set(0, 0.024, -0.3);
    g.add(collar);

    // Triple emitter prongs arranged radially at 120°
    const prongGeo = new THREE.BoxGeometry(0.018, 0.022, 0.15);
    const tipGeo = new THREE.BoxGeometry(0.012, 0.014, 0.032);
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3 + Math.PI / 6;
      const prongPivot = new THREE.Group();
      prongPivot.position.set(Math.cos(ang) * 0.056, 0.024 + Math.sin(ang) * 0.056, -0.35);
      prongPivot.rotation.z = ang;

      const prong = new THREE.Mesh(prongGeo, this.matWhite);
      const tip = new THREE.Mesh(tipGeo, this.matMagentaGlow);
      tip.position.z = -0.072;
      prongPivot.add(prong, tip);
      g.add(prongPivot);
    }

    return g;
  }

  // ---------------------------------------------------------------------------
  // Rover Mounted Twin-Cannon Turret Builder (+X forward in rover local space)
  // ---------------------------------------------------------------------------

  private buildRoverTurret() {
    // Low-profile forward-right mount so driver retains a wide, unobstructed view
    this.turretRoot.position.set(1.35, 1.28, 0.28);

    // Compact low-profile titanium mounting ring + hazard collar
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.08, 14), this.matTitanium);
    base.position.y = 0.02;
    this.turretRoot.add(base);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 8, 18), this.matHazardAmber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.065;
    this.turretRoot.add(ring);

    // Yaw pivot
    this.turretYawPivot.position.y = 0.08;
    this.turretRoot.add(this.turretYawPivot);

    // Slim sculpted dual-arm titanium cradle (low silhouette, zero boxy obstruction)
    const cradleBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.34), this.matTitanium);
    cradleBase.position.y = 0.03;
    this.turretYawPivot.add(cradleBase);

    const armGeo = new THREE.BoxGeometry(0.14, 0.12, 0.036);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.matGunmetal);
      arm.position.set(0.0, 0.085, side * 0.16);
      this.turretYawPivot.add(arm);
    }

    // Pitch pivot (rotates around +Z so +pitch elevates +X barrels upward)
    this.turretPitchPivot.position.set(0.02, 0.12, 0);
    this.turretYawPivot.add(this.turretPitchPivot);

    // Sleek low-profile sculpted breech housing + optical targeting bar
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.105, 0.26), this.matWhite);
    housing.position.set(0.02, 0, 0);
    this.turretPitchPivot.add(housing);

    const spineTrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.022, 0.06), this.matTitanium);
    spineTrim.position.set(0.04, 0.058, 0);
    this.turretPitchPivot.add(spineTrim);

    // Subtle amber/cyan sight rails along top spine
    const sightRailCyan = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.014), this.matCyanGlow);
    sightRailCyan.position.set(0.08, 0.072, -0.02);
    this.turretPitchPivot.add(sightRailCyan);

    const sightRailAmber = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.012), this.matAmberGlow);
    sightRailAmber.position.set(0.06, 0.072, 0.02);
    this.turretPitchPivot.add(sightRailAmber);

    const sensorEye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.042, 0.085), this.matCyanGlow);
    sensorEye.position.set(0.2, 0.015, 0);
    this.turretPitchPivot.add(sensorEye);

    // Twin tapered glowing plasma barrels extending along +X with cooling rings
    const coolingRingGeo = new THREE.TorusGeometry(0.036, 0.008, 6, 12);
    coolingRingGeo.rotateY(Math.PI / 2);

    const buildBarrel = (zOffset: number, container: THREE.Group, muzzle: THREE.Object3D) => {
      container.position.set(0.18, 0.0, zOffset);

      // Tapered titanium breech shroud
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, 0.26, 10), this.matTitanium);
      sleeve.rotation.z = -Math.PI / 2;
      sleeve.position.x = 0.13;
      container.add(sleeve);

      // Tapered gunmetal plasma barrel
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.032, 0.64, 10), this.matGunmetal);
      tube.rotation.z = -Math.PI / 2;
      tube.position.x = 0.52;
      container.add(tube);

      // Glowing cyan energy rail + lower recoil piston
      const glowRail = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.012, 0.014), this.matCyanGlow);
      glowRail.position.set(0.46, 0.032, 0);
      container.add(glowRail);

      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.36, 8), this.matWhite);
      piston.rotation.z = -Math.PI / 2;
      piston.position.set(0.28, -0.028, 0);
      container.add(piston);

      // Ribbed cooling rings along barrel
      for (let i = 0; i < 4; i++) {
        const cRing = new THREE.Mesh(coolingRingGeo, i === 1 ? this.matAmberGlow : this.matTitanium);
        cRing.position.x = 0.3 + i * 0.11;
        cRing.scale.setScalar(1 - i * 0.07);
        container.add(cRing);
      }

      // Slotted muzzle brake
      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.056, 0.056), this.matTitanium);
      brake.position.x = 0.84;
      container.add(brake);

      muzzle.position.set(0.9, 0, 0);
      container.add(muzzle);
      this.turretPitchPivot.add(container);
    };

    buildBarrel(-0.14, this.turretLeftBarrel, this.turretLeftMuzzle);
    buildBarrel(0.14, this.turretRightBarrel, this.turretRightMuzzle);

    this.turretPitchPivot.add(this.turretFlashMesh);
    this.turretPitchPivot.add(this.turretFlashLight);

    disableShadowsAndCulling(this.turretRoot);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setActive(on: boolean): void {
    this.active = on;
    this.rigRoot.visible = on && !this.inRover;
    this.turretRoot.visible = on;
    if (!on) {
      this.fpMuzzleFlash.visible = false;
      this.fpMuzzleLight.intensity = 0;
      this.turretFlashMesh.visible = false;
      this.turretFlashLight.intensity = 0;
    }
  }

  setWeapon(id: WeaponId): void {
    if (this.currentWeapon === id) return;
    this.currentWeapon = id;
    for (const key of Object.keys(this.weaponModels) as WeaponId[]) {
      this.weaponModels[key].visible = key === id;
    }
    this.switchAnim = 1;
    this.reloadProgress = 0;
  }

  setInRover(inRover: boolean): void {
    this.inRover = inRover;
    this.rigRoot.visible = this.active && !inRover;
    this.turretRoot.visible = this.active;
  }

  setReloading(progress: number): void {
    this.reloadProgress = THREE.MathUtils.clamp(progress, 0, 1);
  }

  triggerFire(id: WeaponId, origin: THREE.Vector3, endPoint: THREE.Vector3, isHit: boolean): void {
    const spec = WEAPON_SPECS[id];
    this.lastFireTime = this.elapsed;

    // Determine visual muzzle world origin (handheld gun muzzle or alternating rover turret barrel)
    const visualOrigin = _v1.copy(origin);
    if (this.active) {
      if (this.inRover) {
        this.turretBarrelToggle = !this.turretBarrelToggle;
        const barrelMuzzle = this.turretBarrelToggle ? this.turretLeftMuzzle : this.turretRightMuzzle;
        barrelMuzzle.getWorldPosition(visualOrigin);

        if (this.turretBarrelToggle) this.turretLeftRecoil = 0.16;
        else this.turretRightRecoil = 0.16;

        this.turretFlashMat.color.setHex(spec.color);
        this.turretFlashMesh.position.set(1.1, 0, this.turretBarrelToggle ? -0.14 : 0.14);
        this.turretFlashMesh.scale.setScalar(spec.flashScale * 0.9);
        this.turretFlashMesh.rotation.x = Math.random() * Math.PI * 2;
        this.turretFlashMesh.visible = true;

        this.turretFlashLight.color.setHex(spec.color);
        this.turretFlashLight.position.copy(this.turretFlashMesh.position);
        this.turretFlashLight.intensity = 5.5;
        this.turretFlashTimer = 0.065;
      } else {
        // Handheld recoil + muzzle flash
        this.recoilZ = Math.min(0.16, this.recoilZ + spec.recoilZ);
        this.recoilPitch = Math.min(0.26, this.recoilPitch + spec.recoilPitch);
        this.recoilRoll = (Math.random() - 0.5) * 0.06;
        if (id === 'shotgun') this.pumpAnim = 1;

        this.fpMuzzleFlashMat.color.setHex(spec.color);
        this.fpMuzzleFlash.position.copy(spec.muzzleLocal);
        this.fpMuzzleFlash.scale.setScalar(spec.flashScale);
        this.fpMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
        this.fpMuzzleFlash.visible = true;

        this.fpMuzzleLight.color.setHex(spec.color);
        this.fpMuzzleLight.position.copy(spec.muzzleLocal);
        this.fpMuzzleLight.intensity = 4.2;
        this.fpFlashTimer = 0.06;

        // World position of the handheld muzzle
        this.viewmodelPivot.updateMatrixWorld();
        visualOrigin.copy(spec.muzzleLocal).applyMatrix4(this.viewmodelPivot.matrixWorld);
      }
    }

    // Spawn glowing tracer beam from visual muzzle to endPoint
    this.spawnTracer(visualOrigin, endPoint, spec.color, spec.tracerRadius, spec.tracerLife);

    // Railgun concentric shock rings along the piercing beam
    if (id === 'railgun') {
      this.spawnRailgunRings(visualOrigin, endPoint);
    }

    // Crisp impact sparks if hit
    if (isHit) {
      this.spawnHitSparks(endPoint, spec.color, id === 'shotgun' ? 5 : id === 'railgun' ? 16 : 9);
    }
  }

  spawnPlasmaOrb(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    damage: number,
    splashRadius: number,
    slowSec: number,
  ): void {
    // Trigger visual recoil/flash if caller didn't already call triggerFire on this frame
    if (this.active && this.elapsed - this.lastFireTime > 0.03) {
      const spec = WEAPON_SPECS.plasma;
      if (this.inRover) {
        this.turretBarrelToggle = !this.turretBarrelToggle;
        if (this.turretBarrelToggle) this.turretLeftRecoil = 0.16;
        else this.turretRightRecoil = 0.16;
        this.turretFlashMat.color.setHex(spec.color);
        this.turretFlashMesh.position.set(1.1, 0, this.turretBarrelToggle ? -0.14 : 0.14);
        this.turretFlashMesh.scale.setScalar(spec.flashScale);
        this.turretFlashMesh.visible = true;
        this.turretFlashLight.color.setHex(spec.color);
        this.turretFlashLight.intensity = 5.0;
        this.turretFlashTimer = 0.065;
      } else {
        this.recoilZ = Math.min(0.14, this.recoilZ + spec.recoilZ);
        this.recoilPitch = Math.min(0.22, this.recoilPitch + spec.recoilPitch);
        this.fpMuzzleFlashMat.color.setHex(spec.color);
        this.fpMuzzleFlash.position.copy(spec.muzzleLocal);
        this.fpMuzzleFlash.scale.setScalar(spec.flashScale);
        this.fpMuzzleFlash.visible = true;
        this.fpMuzzleLight.color.setHex(spec.color);
        this.fpMuzzleLight.intensity = 4.2;
        this.fpFlashTimer = 0.06;
      }
    }

    // Find an inactive orb slot (or recycle oldest)
    let slot = this.orbs.find((o) => !o.active);
    if (!slot) {
      slot = this.orbs.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.orbs[0]);
    }
    slot.active = true;
    slot.age = 0;
    slot.maxLife = 4.5;
    slot.pos.copy(origin);
    slot.vel.copy(dir).normalize().multiplyScalar(speed);
    slot.damage = damage;
    slot.splashRadius = splashRadius;
    slot.slowSec = slowSec;
    slot.group.position.copy(origin);
    slot.group.visible = true;
  }

  triggerExplosion(pos: THREE.Vector3, radius: number, color = 0xd938ff): void {
    let slot = this.explosions.find((e) => !e.active);
    if (!slot) {
      slot = this.explosions.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.explosions[0]);
    }
    slot.active = true;
    slot.age = 0;
    slot.life = 0.48;
    slot.radius = Math.max(0.8, radius);
    slot.group.position.copy(pos);
    slot.group.visible = true;
    slot.shellMat.color.setHex(color);
    slot.ringMat.color.setHex(color).lerp(_color.setHex(0xffffff), 0.35);
    slot.core.scale.setScalar(0.15);
    slot.shell.scale.setScalar(0.2);
    slot.ring.scale.setScalar(0.2);

    this.spawnHitSparks(pos, color, 26);
  }

  spawnHitSparks(pos: THREE.Vector3, color: number, count = 10): void {
    let spawned = 0;
    for (let i = 0; i < MAX_SPARKS && spawned < count; i++) {
      const s = this.sparks[i];
      if (s.active) continue;
      s.active = true;
      s.age = 0;
      s.life = 0.26 + Math.random() * 0.32;
      s.size = 0.65 + Math.random() * 0.85;
      s.pos.copy(pos);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.72;
      const spd = 2.6 + Math.random() * 6.8;
      s.vel.set(
        Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd * 0.85 + 1.1,
        Math.sin(phi) * Math.sin(theta) * spd,
      );
      s.color.setHex(color);
      // Slight hot-white variation on ~30% of sparks
      if (Math.random() < 0.3) s.color.lerp(_color.setHex(0xffffff), 0.55);
      spawned++;
    }
  }

  clear(): void {
    for (const t of this.tracers) {
      t.active = false;
      t.mesh.visible = false;
    }
    for (const r of this.shockRings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const o of this.orbs) {
      o.active = false;
      o.group.visible = false;
    }
    for (const e of this.explosions) {
      e.active = false;
      e.group.visible = false;
    }
    for (const s of this.sparks) {
      s.active = false;
    }
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;

    this.fpMuzzleFlash.visible = false;
    this.fpMuzzleLight.intensity = 0;
    this.fpFlashTimer = 0;
    this.turretFlashMesh.visible = false;
    this.turretFlashLight.intensity = 0;
    this.turretFlashTimer = 0;
    this.recoilZ = 0;
    this.recoilPitch = 0;
    this.recoilRoll = 0;
    this.reloadProgress = 0;
  }

  // ---------------------------------------------------------------------------
  // Per-Frame Update
  // ---------------------------------------------------------------------------

  update(
    dt: number,
    ctx: WeaponUpdateCtx,
    checkOrbHit: (pos: THREE.Vector3, radius: number) => boolean,
    onOrbExplode: (hit: PlasmaOrbHit) => void,
  ): void {
    const safeDt = Math.min(dt, 0.05);
    this.elapsed += safeDt;

    if (this.inRover !== ctx.inRover) {
      this.setInRover(ctx.inRover);
    }

    if (this.active) {
      if (!ctx.inRover) {
        this.updateViewmodel(safeDt, ctx);
      }
      this.updateRoverTurret(safeDt, ctx);
    }

    this.updateTracers(safeDt);
    this.updateShockRings(safeDt);
    this.updateOrbs(safeDt, checkOrbHit, onOrbExplode);
    this.updateExplosions(safeDt);
    this.updateSparks(safeDt);
  }

  // ---------------------------------------------------------------------------
  // Internal Animation & VFX Updaters
  // ---------------------------------------------------------------------------

  private updateViewmodel(dt: number, ctx: WeaponUpdateCtx) {
    const damp = (cur: number, target: number, lambda: number) =>
      cur + (target - cur) * (1 - Math.exp(-lambda * dt));

    // Smooth mouse-look lag sway
    const targetSwayX = THREE.MathUtils.clamp(-ctx.lookDX * 0.0014, -0.045, 0.045);
    const targetSwayY = THREE.MathUtils.clamp(ctx.lookDY * 0.0012, -0.035, 0.035);
    this.swayX = damp(this.swayX, targetSwayX, 11);
    this.swayY = damp(this.swayY, targetSwayY, 11);

    // Lunar stride walking / sprinting bob
    const moveTarget = ctx.moving && ctx.grounded ? 1 : 0;
    this.bobBlend = damp(this.bobBlend, moveTarget, 8);
    this.sprintBlend = damp(this.sprintBlend, ctx.moving && ctx.sprinting && ctx.grounded ? 1 : 0, 7);
    this.airDip = damp(this.airDip, ctx.grounded ? 0 : -0.026, 6);
    this.stunBlend = damp(this.stunBlend, ctx.stunned ? 1 : 0, 14);

    const strideRate = ctx.sprinting ? 8.2 : 5.4;
    this.bobPhase += dt * strideRate * (0.25 + 0.75 * this.bobBlend);

    const breathX = Math.cos(this.elapsed * 1.45) * 0.0028;
    const breathY = Math.sin(this.elapsed * 2.1) * 0.0036;
    const bobAmp = 0.011 + 0.01 * this.sprintBlend;
    const bobX = Math.cos(this.bobPhase) * bobAmp * this.bobBlend;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * -bobAmp * 1.15 * this.bobBlend;

    // Recoil spring decay
    this.recoilZ = damp(this.recoilZ, 0, 18);
    this.recoilPitch = damp(this.recoilPitch, 0, 16);
    this.recoilRoll = damp(this.recoilRoll, 0, 14);
    this.switchAnim = Math.max(0, this.switchAnim - dt * 4.5);
    this.pumpAnim = Math.max(0, this.pumpAnim - dt * 5.2);

    // Reload tilt-down & mechanical cycle
    let reloadDipY = 0;
    let reloadPitch = 0;
    let reloadRoll = 0;
    if (this.reloadProgress > 0 && this.reloadProgress < 1) {
      const env = Math.sin(this.reloadProgress * Math.PI); // 0 -> 1 -> 0
      const cycle = Math.sin(this.reloadProgress * Math.PI * 3) * 0.014 * env;
      reloadDipY = -0.095 * env + cycle;
      reloadPitch = -0.52 * env;
      reloadRoll = 0.56 * env;
    }

    // Weapon switch raise-up curve
    const switchCurve = this.switchAnim * this.switchAnim;
    const switchDipY = -0.22 * switchCurve;
    const switchPitch = -0.45 * switchCurve;

    // Stunned (alien grab) dramatic lower + panic shake
    const stunShakeX = this.stunBlend * Math.sin(this.elapsed * 47) * 0.018;
    const stunShakeY = this.stunBlend * Math.cos(this.elapsed * 53) * 0.015;
    const stunDipY = -0.17 * this.stunBlend;
    const stunPitch = -0.62 * this.stunBlend;
    const stunRoll = 0.32 * this.stunBlend;

    // Sprint cant inward
    const sprintCantX = -0.032 * this.sprintBlend;
    const sprintCantYaw = 0.24 * this.sprintBlend;
    const sprintCantPitch = -0.1 * this.sprintBlend;

    this.viewmodelPivot.position.set(
      this.swayX + breathX + bobX + sprintCantX + stunShakeX,
      this.swayY + breathY + bobY + this.airDip + reloadDipY + switchDipY + stunDipY + stunShakeY,
      this.recoilZ,
    );
    this.viewmodelPivot.rotation.set(
      this.recoilPitch + this.swayY * 1.8 + reloadPitch + switchPitch + sprintCantPitch + stunPitch,
      -this.swayX * 2.1 + sprintCantYaw,
      this.recoilRoll - this.swayX * 1.4 + reloadRoll + stunRoll,
    );

    // Per-weapon live ambient animations
    if (this.currentWeapon === 'shotgun') {
      const pumpSlide = Math.sin(this.pumpAnim * Math.PI) * 0.055;
      this.shotgunPump.position.z = pumpSlide;
    } else if (this.currentWeapon === 'railgun') {
      for (let i = 0; i < this.railgunCaps.length; i++) {
        const m = this.railgunCaps[i].material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 1.9 + 1.15 * Math.sin(this.elapsed * 6.5 - i * 0.85);
      }
    } else if (this.currentWeapon === 'plasma') {
      const pulse = 1 + 0.09 * Math.sin(this.elapsed * 7.5);
      this.plasmaCore.scale.setScalar(pulse);
      this.plasmaRingA.rotation.x += dt * 2.4;
      this.plasmaRingA.rotation.y += dt * 1.8;
      this.plasmaRingB.rotation.y -= dt * 2.1;
      this.plasmaRingB.rotation.z += dt * 1.5;
    } else if (this.currentWeapon === 'carbine') {
      const shimmer = 1 + 0.04 * Math.sin(this.elapsed * 9);
      this.carbineHoloRing.scale.setScalar(shimmer);
    }

    // Muzzle flash decay
    if (this.fpFlashTimer > 0) {
      this.fpFlashTimer = Math.max(0, this.fpFlashTimer - dt);
      const k = this.fpFlashTimer / 0.06;
      this.fpMuzzleLight.intensity = 4.2 * k;
      this.fpMuzzleFlashMat.opacity = k;
      if (this.fpFlashTimer <= 0) {
        this.fpMuzzleFlash.visible = false;
        this.fpMuzzleLight.intensity = 0;
      }
    }
  }

  private updateRoverTurret(dt: number, ctx: WeaponUpdateCtx) {
    let targetYaw = 0;
    let targetPitch = 0.04;

    if (ctx.inRover) {
      // Transform camera world forward direction into rover local space (+X forward, +Y up)
      ctx.camera.getWorldDirection(_dir);
      this.roverObj.getWorldQuaternion(_invQuat).invert();
      _dir.applyQuaternion(_invQuat);

      targetYaw = Math.atan2(-_dir.z, _dir.x);
      const horiz = Math.hypot(_dir.x, _dir.z);
      targetPitch = THREE.MathUtils.clamp(Math.atan2(_dir.y, horiz), -0.35, 0.85);
    }

    // Smooth angular tracking with shortest-angle wrap for yaw
    let yawDiff = targetYaw - this.turretYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const rate = 1 - Math.exp(-14 * dt);
    this.turretYaw += yawDiff * rate;
    this.turretPitch += (targetPitch - this.turretPitch) * rate;

    this.turretYawPivot.rotation.y = this.turretYaw;
    this.turretPitchPivot.rotation.z = this.turretPitch;

    // Twin barrel recoil recovery
    const recDecay = Math.exp(-16 * dt);
    this.turretLeftRecoil *= recDecay;
    this.turretRightRecoil *= recDecay;
    this.turretLeftBarrel.position.x = 0.18 - this.turretLeftRecoil;
    this.turretRightBarrel.position.x = 0.18 - this.turretRightRecoil;

    // Turret muzzle flash decay
    if (this.turretFlashTimer > 0) {
      this.turretFlashTimer = Math.max(0, this.turretFlashTimer - dt);
      const k = this.turretFlashTimer / 0.065;
      this.turretFlashLight.intensity = 5.5 * k;
      this.turretFlashMat.opacity = k;
      if (this.turretFlashTimer <= 0) {
        this.turretFlashMesh.visible = false;
        this.turretFlashLight.intensity = 0;
      }
    }
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3, color: number, radius: number, life: number) {
    let slot = this.tracers.find((t) => !t.active);
    if (!slot) {
      slot = this.tracers.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.tracers[0]);
    }
    _v2.subVectors(end, start);
    const len = _v2.length();
    if (len < 0.05) return;

    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.baseRadius = radius;
    slot.length = len;
    slot.mat.color.setHex(color);
    slot.mat.opacity = 1;

    // Place cylinder midpoint between start & end, oriented along segment
    slot.mesh.position.addVectors(start, end).multiplyScalar(0.5);
    _dir.copy(_v2).divideScalar(len);
    slot.mesh.quaternion.setFromUnitVectors(_up, _dir);
    slot.mesh.scale.set(radius, len, radius);
    slot.mesh.visible = true;
  }

  private spawnRailgunRings(start: THREE.Vector3, end: THREE.Vector3) {
    _v2.subVectors(end, start);
    const len = _v2.length();
    if (len < 2) return;
    _dir.copy(_v2).divideScalar(len);
    _quat.setFromUnitVectors(_v3.set(0, 0, 1), _dir);

    const ringCount = Math.min(6, Math.max(2, Math.floor(len / 7)));
    for (let i = 0; i < ringCount; i++) {
      let slot = this.shockRings.find((r) => !r.active);
      if (!slot) {
        slot = this.shockRings.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.shockRings[0]);
      }
      const dist = 2.2 + (i + 1) * (Math.min(len - 2.5, 42) / (ringCount + 1));
      slot.active = true;
      slot.age = 0;
      slot.life = 0.28 + i * 0.03;
      slot.maxScale = 1.6 + i * 0.22;
      slot.mesh.position.copy(start).addScaledVector(_dir, dist);
      slot.mesh.quaternion.copy(_quat);
      slot.mesh.scale.setScalar(0.35);
      slot.mat.opacity = 0.92;
      slot.mesh.visible = true;
    }
  }

  private updateTracers(dt: number) {
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const k = 1 - t.age / t.life;
      t.mat.opacity = k * k;
      const r = t.baseRadius * (0.45 + 0.55 * k);
      t.mesh.scale.set(r, t.length, r);
    }
  }

  private updateShockRings(dt: number) {
    for (let i = 0; i < MAX_SHOCK_RINGS; i++) {
      const r = this.shockRings[i];
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const u = r.age / r.life;
      const s = 0.35 + (r.maxScale - 0.35) * (1 - (1 - u) * (1 - u));
      r.mesh.scale.setScalar(s);
      r.mat.opacity = (1 - u) * 0.88;
    }
  }

  private updateOrbs(
    dt: number,
    checkOrbHit: (pos: THREE.Vector3, radius: number) => boolean,
    onOrbExplode: (hit: PlasmaOrbHit) => void,
  ) {
    for (let i = 0; i < MAX_ORBS; i++) {
      const o = this.orbs[i];
      if (!o.active) continue;
      o.age += dt;
      o.pos.addScaledVector(o.vel, dt);
      o.group.position.copy(o.pos);

      // Pulsing halo & spinning containment ring
      o.ring.rotation.x += dt * 7.5;
      o.ring.rotation.y += dt * 5.2;
      const pulse = 1 + 0.16 * Math.sin(o.age * 22);
      o.halo.scale.setScalar(pulse);

      const terrainY = heightAt(o.pos.x, o.pos.z);
      const hitTerrain = o.pos.y <= terrainY + 0.25;
      const hitEnemy = checkOrbHit(o.pos, 0.55);
      const expired = o.age >= o.maxLife;

      if (hitTerrain || hitEnemy || expired) {
        if (hitTerrain) o.pos.y = Math.max(o.pos.y, terrainY + 0.22);
        o.active = false;
        o.group.visible = false;
        this.triggerExplosion(o.pos, o.splashRadius, 0xd938ff);
        onOrbExplode({
          pos: o.pos.clone(),
          radius: o.splashRadius,
          damage: o.damage,
          slowSec: o.slowSec,
        });
      }
    }
  }

  private updateExplosions(dt: number) {
    for (let i = 0; i < MAX_EXPLOSIONS; i++) {
      const e = this.explosions[i];
      if (!e.active) continue;
      e.age += dt;
      if (e.age >= e.life) {
        e.active = false;
        e.group.visible = false;
        continue;
      }
      const u = e.age / e.life;
      const easeOut = 1 - Math.pow(1 - u, 3);
      const fade = 1 - u;

      e.core.scale.setScalar(e.radius * 0.45 * (0.25 + 0.75 * easeOut));
      e.coreMat.opacity = Math.max(0, 1 - u * 1.9);

      e.shell.scale.setScalar(e.radius * 0.92 * easeOut);
      e.shellMat.opacity = fade * fade * 0.65;

      e.ring.scale.setScalar(e.radius * 1.15 * easeOut);
      e.ringMat.opacity = fade * 0.9;
    }
  }

  private updateSparks(dt: number) {
    let activeCount = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        continue;
      }

      // Lunar gravity arc + gentle terrain bounce
      s.vel.y -= LUNAR_GRAVITY * dt;
      s.pos.addScaledVector(s.vel, dt);
      const groundY = heightAt(s.pos.x, s.pos.z) + 0.03;
      if (s.pos.y < groundY) {
        s.pos.y = groundY;
        s.vel.y = Math.abs(s.vel.y) * 0.35;
        s.vel.x *= 0.72;
        s.vel.z *= 0.72;
      }

      const k = 1 - s.age / s.life;
      const spd = s.vel.length();
      if (spd > 0.05) {
        _dir.copy(s.vel).divideScalar(spd);
        _quat.setFromUnitVectors(_v3.set(0, 0, 1), _dir);
      } else {
        _quat.identity();
      }
      const thick = s.size * k;
      const stretch = s.size * k * (0.7 + Math.min(2.4, spd * 0.32));
      _scale.set(thick, thick, stretch);
      _mat4.compose(s.pos, _quat, _scale);

      this.sparkMesh.setMatrixAt(activeCount, _mat4);
      this.sparkMesh.setColorAt(activeCount, s.color);
      activeCount++;
    }

    this.sparkMesh.count = activeCount;
    this.sparkMesh.visible = activeCount > 0;
    if (activeCount > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    }
  }
}
