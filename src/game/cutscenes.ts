import * as THREE from 'three';
import { playNarration, sfx, stopVoices } from '../audio/audio';
import type { Outpost } from '../world/base';
import { statusMaterials } from '../world/base';
import { heightAt, LAYOUT, mulberry32 } from '../world/heightfield';
import { EARTH_DIR, SUN_DIR } from '../world/sky';
import { cinema } from './state';
import { shake } from '../engine/shake';

// In-engine cutscenes: scripted camera moves over the live scene, with narration,
// subtitles and a few animated props (the lander's descent and its dust).

export interface Shot {
  dur: number;
  /** Positions the camera; t runs 0..1 over the shot. */
  cam: (t: number, cam: THREE.PerspectiveCamera) => void;
  sub?: string;
  caption?: string;
  /** Shows the gold "legendary discovery" title (secret finds). */
  gold?: boolean;
  vo?: string;
  start?: () => void;
  update?: (t: number, dt: number) => void;
  /** Optional teardown called when leaving the shot or skipping the cutscene. */
  cleanup?: () => void;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ground = (x: number, z: number, h: number) => v(x, heightAt(x, z) + h, z);

/** A camera move between two positions and two look-at points. */
function move(fromPos: THREE.Vector3, toPos: THREE.Vector3, fromLook: THREE.Vector3, toLook: THREE.Vector3) {
  const p = new THREE.Vector3();
  const l = new THREE.Vector3();
  return (t: number, cam: THREE.PerspectiveCamera) => {
    const k = ease(t);
    cam.position.lerpVectors(fromPos, toPos, k);
    cam.lookAt(l.lerpVectors(fromLook, toLook, k));
    void p;
  };
}

/** A circular move around a point. */
function orbit(center: THREE.Vector3, radius: number, height: number, a0: number, a1: number, lookY = 1.5) {
  const look = center.clone().add(v(0, lookY, 0));
  return (t: number, cam: THREE.PerspectiveCamera) => {
    const a = THREE.MathUtils.lerp(a0, a1, ease(t));
    const x = center.x + Math.cos(a) * radius;
    const z = center.z + Math.sin(a) * radius;
    cam.position.set(x, Math.max(heightAt(x, z) + 1.2, center.y + height), z);
    cam.lookAt(look);
  };
}

let cachedDustTex: THREE.CanvasTexture | null = null;
function dustGrainTexture(): THREE.CanvasTexture {
  if (cachedDustTex) return cachedDustTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 1.5, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(235,230,220,0.85)');
  grad.addColorStop(1, 'rgba(200,195,185,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  cachedDustTex = new THREE.CanvasTexture(c);
  cachedDustTex.needsUpdate = true;
  return cachedDustTex;
}

/**
 * Dust thrown up by the engine. On the Moon there is no air, so each grain flies on a
 * clean ballistic arc and falls back: no billowing cloud like on Earth.
 */
class DustBurst {
  readonly points: THREE.Points;
  private vel: Float32Array;
  private pos: Float32Array;
  private alive = 0;
  private origin = new THREE.Vector3();
  private rand = mulberry32(5);
  private spawned = 0;

  constructor(private count = 1400) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xb8b2a6,
      map: dustGrainTexture(),
      size: 0.3,
      transparent: true,
      alphaTest: 0.05,
      opacity: 0.92,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  reset(origin: THREE.Vector3) {
    this.origin.copy(origin);
    this.alive = 0;
    this.spawned = 0;
    this.points.visible = true;
  }

  /** strength 0..1: how hard the exhaust hits the ground. */
  update(dt: number, strength: number) {
    const toSpawn = Math.min(this.count - this.spawned, Math.floor(strength * 900 * dt));
    for (let i = 0; i < toSpawn; i++) {
      const k = this.spawned++;
      const a = this.rand() * Math.PI * 2;
      const r = 0.5 + this.rand() * 2;
      const sp = 5 + this.rand() * 14;
      this.pos.set([this.origin.x + Math.cos(a) * r, this.origin.y + 0.1, this.origin.z + Math.sin(a) * r], k * 3);
      this.vel.set([Math.cos(a) * sp, 0.6 + this.rand() * 2.6, Math.sin(a) * sp], k * 3);
      this.alive = Math.max(this.alive, k + 1);
    }
    for (let i = 0; i < this.alive; i++) {
      const j = i * 3;
      if (this.pos[j + 1] < -1000) continue;
      this.vel[j + 1] -= 1.62 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < this.origin.y - 0.4 && this.vel[j + 1] < 0) this.pos[j + 1] = -2000; // landed
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  hide() {
    this.points.visible = false;
  }
}

export class CutscenePlayer {
  private shots: Shot[] | null = null;
  private i = 0;
  private t = 0;
  private onDone: () => void = () => {};

  get playing() {
    return this.shots !== null;
  }

  play(shots: Shot[], onDone: () => void) {
    this.shots = shots;
    this.onDone = onDone;
    this.i = -1;
    this.next();
  }

  private next() {
    this.shots?.[this.i]?.cleanup?.();
    this.i++;
    this.t = 0;
    const s = this.shots?.[this.i];
    if (!s) return this.finish();
    cinema.value = { sub: s.sub ?? null, caption: s.caption ?? null, gold: !!s.gold };
    s.start?.();
    if (s.vo) void playNarration(s.vo);
  }

  update(dt: number, cam: THREE.PerspectiveCamera) {
    const s = this.shots?.[this.i];
    if (!s) return;
    this.t += dt;
    const k = Math.min(1, this.t / s.dur);
    s.update?.(k, dt);
    s.cam(k, cam);
    if (k >= 1) this.next();
  }

  skip() {
    if (!this.shots) return;
    stopVoices();
    // Run every remaining shot's start/end state and cleanup so props end up where they belong.
    for (let j = Math.max(this.i, 0); j < this.shots.length; j++) {
      const s = this.shots[j];
      if (j > this.i) s.start?.();
      s.update?.(1, 0);
      s.cleanup?.();
    }
    this.finish();
  }

  private finish() {
    this.shots = null;
    cinema.value = { sub: null, caption: null, gold: false };
    this.onDone();
  }
}

/** Builds the game's cutscenes over the live scene. */
export function buildCutscenes(scene: THREE.Scene, outpost: Outpost, start: { pos: THREE.Vector3; yaw: number }) {
  const L = LAYOUT.lander;
  const B = LAYOUT.base;
  const lander = outpost.lander;
  const restY = lander.position.y;
  const pad = v(L.x, restY, L.z);

  // Descent engine glow (real lunar landers' exhaust is almost invisible, so it is subtle).
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 4, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flame.rotation.x = Math.PI;
  flame.position.y = -1.2;
  flame.visible = false;
  lander.add(flame);
  const dust = new DustBurst();
  scene.add(dust.points);

  const landerAlt = (k: number) => restY + 75 * Math.pow(1 - k, 2.2);

  const intro: Shot[] = [
    {
      dur: 6,
      caption: 'cs.caption.site',
      sub: 'cs.intro_1',
      vo: 'cs_intro_1',
      start: () => {
        lander.position.y = restY + 75;
        flame.visible = true;
      },
      cam: move(v(70, 45, 150), v(55, 30, 125), v(70, 45, 150).addScaledVector(EARTH_DIR, 100), v(L.x, restY + 20, L.z)),
    },
    {
      dur: 10,
      sub: 'cs.intro_2',
      vo: 'cs_intro_2',
      start: () => sfx('powerup'),
      update: (k, dt) => {
        lander.position.y = landerAlt(k);
        flame.scale.setScalar(0.8 + Math.sin(k * 90) * 0.08);
        const alt = lander.position.y - restY;
        // The engine's rumble grows as it comes down (shaken through the ground, not the air: there is none).
        if (alt < 30) shake.rumble((1 - alt / 30) * 0.32);
        if (alt < 14) {
          if (!dust.points.visible) dust.reset(pad);
          dust.update(dt, 1 - alt / 14);
        }
      },
      cam: (k, cam) => {
        cam.position.copy(ground(L.x + 34, L.z + 26, 2.2));
        cam.lookAt(L.x, landerAlt(k) + 1, L.z);
      },
    },
    {
      dur: 7,
      sub: 'cs.intro_3',
      vo: 'cs_intro_3',
      start: () => {
        lander.position.y = restY;
        flame.visible = false;
        sfx('clunk');
        shake.add(0.65); // touchdown
      },
      update: (_k, dt) => dust.update(dt, 0),
      cam: orbit(pad, 16, 3, 0.9, 1.9, 2.5),
    },
    {
      dur: 4.5,
      sub: 'cs.intro_4',
      vo: 'cs_intro_4',
      start: () => {
        const camEnd = start.pos.clone().add(v(0, 1.62, 0));
        const lookEnd = camEnd.clone().add(v(-Math.sin(start.yaw), 0, -Math.cos(start.yaw)));
        intro[3].cam = move(v(L.x + 5, restY + 3.5, L.z + 6), camEnd, v(L.x, restY + 2.5, L.z), lookEnd);
      },
      update: (k, dt) => {
        dust.update(dt, 0);
        if (k >= 1) dust.hide();
      },
      cam: () => {},
    },
  ];

  const hab = outpost.habitatPos;
  const m1End: Shot[] = [
    {
      dur: 9,
      sub: 'cs.m1_end',
      vo: 'cs_m1_end',
      start: () => sfx('airlock'),
      update: (k) => {
        if (k > 0.45) outpost.airlockLight.material = statusMaterials.green;
      },
      cam: orbit(hab, 20, 5, 2.4, 3.6, 2.5),
    },
  ];

  const ls = outpost.lifeSupport.pos;
  const red = () => {
    const l = outpost.lifeSupport.lights;
    l.o2.material = l.water.material = statusMaterials.red;
    l.co2.material = statusMaterials.green;
  };
  const m2Intro: Shot[] = [
    {
      dur: 7,
      sub: 'cs.m2_intro_1',
      vo: 'cs_m2_intro_1',
      start: red,
      cam: move(v(B.x - 12, hab.y + 3.5, B.z + 9), v(B.x + 4, hab.y + 3.5, B.z + 10), v(B.x - 4, hab.y + 3, B.z), v(B.x + 6, hab.y + 3, B.z)),
    },
    {
      dur: 5,
      sub: 'cs.m2_intro_2',
      vo: 'cs_m2_intro_2',
      cam: move(v(ls.x + 2, ls.y + 3, ls.z + 9), v(ls.x + 0.5, ls.y + 2, ls.z + 4.5), v(ls.x, ls.y + 1.2, ls.z), v(ls.x, ls.y + 1.2, ls.z)),
    },
  ];

  const m2End: Shot[] = [
    {
      dur: 10,
      sub: 'cs.m2_end',
      vo: 'cs_m2_end',
      start: () => sfx('powerup'),
      cam: (k, cam) => {
        // Crane up and back from the life support unit to a wide view of the outpost under Earth.
        const e = ease(k);
        cam.position.set(ls.x + 4 + e * 26, ls.y + 2 + e * 20, ls.z + 6 + e * 34);
        const look = new THREE.Vector3(ls.x, ls.y + 1, ls.z).lerp(new THREE.Vector3(B.x, hab.y + 6, B.z - 10), e);
        cam.lookAt(look);
      },
    },
  ];

  const pw = outpost.power;
  const bat = pw.batteryPos;
  const t0 = outpost.arrays[0].pos;
  const t1 = outpost.arrays[1].pos;
  const m3Intro: Shot[] = [
    {
      dur: 8.8,
      sub: 'cs.m3_intro_1',
      vo: 'cs_m3_intro_1',
      // Push in on the battery bank from the south-west, its charge bars glowing red.
      cam: move(
        bat.clone().addScaledVector(pw.batteryFront, 4).add(v(0, 1.6, 6)),
        bat.clone().addScaledVector(pw.batteryFront, 3).add(v(0, 0.3, 1.5)),
        bat.clone(),
        bat.clone().add(v(0, -0.1, 0)),
      ),
    },
    {
      dur: 7.4,
      sub: 'cs.m3_intro_2',
      vo: 'cs_m3_intro_2',
      // A low orbit around a folded solar tower.
      cam: orbit(t0, 9, 1.2, 2.2, 3.1, 4),
    },
  ];

  const m3End: Shot[] = [
    {
      dur: 11,
      sub: 'cs.m3_end',
      vo: 'cs_m3_end',
      start: () => sfx('powerup'),
      cam: (k, cam) => {
        // From under a tower looking up at its panels, crane back to see all three in the sunlight.
        const e = ease(k);
        cam.position.set(t1.x - 4 - e * 26, t1.y + 1.6 + e * 13, t1.z + 5 + e * 22);
        const look = new THREE.Vector3(t1.x, t1.y + 8, t1.z).lerp(new THREE.Vector3((t0.x + t1.x) / 2, t0.y + 5, (t0.z + t1.z) / 2 - 6), e);
        cam.lookAt(look);
      },
    },
  ];

  const h2 = outpost.hab2.center;
  const m4Intro: Shot[] = [
    {
      dur: 7,
      sub: 'cs.m4_intro_1',
      vo: 'cs_m4_intro_1',
      // A slow orbit around the small lander the crew has been sleeping in.
      cam: orbit(pad, 13, 2.5, 4.0, 4.9, 3),
    },
    {
      dur: 8,
      sub: 'cs.m4_intro_2',
      vo: 'cs_m4_intro_2',
      // Low push in over the build pad to the packed module.
      cam: move(v(h2.x - 9, h2.y + 1.6, h2.z + 9), v(h2.x - 4.5, h2.y + 2.2, h2.z + 2.5), v(h2.x, h2.y + 2.4, h2.z - 2.5), v(h2.x, h2.y + 3, h2.z - 3)),
    },
  ];

  const m4End: Shot[] = [
    {
      dur: 11,
      sub: 'cs.m4_end',
      vo: 'cs_m4_end',
      // Around the new module, its windows glowing, rising to see the whole outpost.
      cam: (k, cam) => {
        const e = ease(k);
        const a = 1.2 + e * 1.5;
        const r = 12 + e * 14;
        const x = h2.x + Math.cos(a) * r;
        const z = h2.z + Math.sin(a) * r;
        cam.position.set(x, Math.max(heightAt(x, z) + 1.4, h2.y + 2 + e * 9), z);
        cam.lookAt(h2.x - e * 4, h2.y + 3, h2.z - e * 6);
      },
    },
  ];

  const gh = outpost.greenhouse.center;
  const m5Intro: Shot[] = [
    {
      dur: 7.5,
      sub: 'cs.m5_intro_1',
      vo: 'cs_m5_intro_1',
      // The new habitat at breakfast time, windows lit.
      cam: orbit(h2, 11, 1.5, 0.3, 1.0, 3),
    },
    {
      dur: 7.5,
      sub: 'cs.m5_intro_2',
      vo: 'cs_m5_intro_2',
      // Over the empty greenhouse pad north of the lab.
      cam: move(v(gh.x - 10, gh.y + 5, gh.z + 6), v(gh.x - 6, gh.y + 2.5, gh.z - 2), v(gh.x, gh.y + 1, gh.z + 3), v(gh.x, gh.y + 1.2, gh.z)),
    },
  ];

  const m5End: Shot[] = [
    {
      dur: 11,
      sub: 'cs.m5_end',
      vo: 'cs_m5_end',
      // Along the greenhouse's glowing windows, then up over the outpost.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(gh.x - 5 - e * 10, gh.y + 1.8 + e * 10, gh.z + 4 - e * 2 + e * 16);
        cam.lookAt(gh.x, gh.y + 2.6 - e * 0.5, gh.z - 1 + e * 8);
      },
    },
  ];

  const m6Intro: Shot[] = [
    {
      dur: 7.5,
      sub: 'cs.m6_intro_1',
      vo: 'cs_m6_intro_1',
      // A high, slow pass over the finished outpost.
      cam: move(v(B.x - 30, hab.y + 18, B.z + 30), v(B.x - 10, hab.y + 12, B.z + 34), v(B.x, hab.y + 2, B.z - 4), v(B.x + 4, hab.y + 2, B.z - 6)),
    },
    {
      dur: 8,
      sub: 'cs.m6_intro_2',
      vo: 'cs_m6_intro_2',
      // From the habitat roof, tilt up toward the low Sun.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(B.x - 6, hab.y + 6.5, B.z + 6);
        const look = new THREE.Vector3(B.x, hab.y + 3, B.z).lerp(cam.position.clone().addScaledVector(SUN_DIR, 100), e);
        cam.lookAt(look);
      },
    },
  ];

  const m6End: Shot[] = [
    {
      dur: 11,
      sub: 'cs.m6_end',
      vo: 'cs_m6_end',
      // Around HAB-2, now under its regolith berms, windows glowing.
      cam: orbit(h2, 15, 4, 2.2, 3.6, 2),
    },
  ];

  const rv = outpost.rover;
  const siteC = outpost.science.sites[2].pos;
  const m7Intro: Shot[] = [
    {
      dur: 7.5,
      sub: 'cs.m7_intro_1',
      vo: 'cs_m7_intro_1',
      // Around the parked rover, charged and ready.
      cam: (k, cam) => orbit(rv.position, 7, 1.2, 0.6, 1.6, 1)(k, cam),
    },
    {
      dur: 8.5,
      sub: 'cs.m7_intro_2',
      vo: 'cs_m7_intro_2',
      // Out over the plain toward the deep crater, its floor lost in shadow.
      cam: move(
        v(siteC.x - 60, siteC.y + 22, siteC.z + 60),
        v(siteC.x - 18, siteC.y + 10, siteC.z + 14),
        v(siteC.x - 20, siteC.y - 8, siteC.z - 10),
        v(siteC.x - 60, siteC.y - 14, siteC.z - 4),
      ),
    },
  ];

  const lab = outpost.science.labPortPos;
  const m7End: Shot[] = [
    {
      dur: 11,
      sub: 'cs.m7_end',
      vo: 'cs_m7_end',
      // Rise from the lab's sample port to a view across the plain to the far crater.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(lab.x - 5 - e * 14, lab.y + 1 + e * 14, lab.z + 4 + e * 18);
        cam.lookAt(new THREE.Vector3(lab.x, lab.y + 1, lab.z).lerp(new THREE.Vector3(siteC.x, siteC.y, siteC.z), e * 0.6));
      },
    },
  ];

  const tower = outpost.arrays[1].pos;
  const pump = outpost.emergency.pumpPos;
  const m8Intro: Shot[] = [
    {
      dur: 8,
      sub: 'cs.m8_intro_1',
      vo: 'cs_m8_intro_1',
      // A calm, slow pass over the busy outpost.
      cam: orbit(hab, 34, 13, 2.4, 1.6, 2),
    },
    {
      dur: 8.5,
      sub: 'cs.m8_intro_2',
      vo: 'cs_m8_intro_2',
      // Low under the solar towers, looking up at the panels against the black sky.
      cam: move(v(tower.x - 14, tower.y + 1.8, tower.z + 12), v(tower.x - 6, tower.y + 1.4, tower.z + 6), v(tower.x, tower.y + 4, tower.z), v(tower.x, tower.y + 9, tower.z)),
    },
  ];

  const m8End: Shot[] = [
    {
      dur: 11.5,
      sub: 'cs.m8_end',
      vo: 'cs_m8_end',
      // From the repaired cooling pumps, rise to see the whole outpost working again.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(pump.x - 4 + e * 6, pump.y + 0.6 + e * 18, pump.z + 5 + e * 22);
        cam.lookAt(new THREE.Vector3(pump.x, pump.y, pump.z).lerp(new THREE.Vector3(hab.x, hab.y + 2, hab.z), e));
      },
    },
  ];

  const m9Intro: Shot[] = [
    {
      dur: 8.5,
      sub: 'cs.m9_intro_1',
      vo: 'cs_m9_intro_1',
      // A wide, high circle over the whole finished outpost.
      cam: orbit(hab, 46, 20, 0.8, 2.0, 1),
    },
    {
      dur: 8.5,
      sub: 'cs.m9_intro_2',
      vo: 'cs_m9_intro_2',
      // From behind the habitat, tilt up from the modules to Earth low on the horizon.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(hab.x + 9 - EARTH_DIR.x * 14, hab.y + 3 + e * 2, hab.z + 4 - EARTH_DIR.z * 14);
        const toEarth = cam.position.clone().addScaledVector(EARTH_DIR, 200);
        cam.lookAt(new THREE.Vector3(hab.x, hab.y + 2, hab.z).lerp(toEarth, e));
      },
    },
  ];

  const m9End: Shot[] = [
    {
      dur: 13,
      sub: 'cs.m9_end',
      vo: 'cs_m9_end',
      // A slow rise over the living outpost, ending on Earth above the horizon.
      cam: (k, cam) => {
        const e = ease(k);
        cam.position.set(hab.x - 20 + e * 6, hab.y + 4 + e * 26, hab.z + 26 + e * 10);
        const toEarth = cam.position.clone().addScaledVector(EARTH_DIR, 300);
        cam.lookAt(new THREE.Vector3(hab.x, hab.y + 1, hab.z).lerp(toEarth, Math.max(0, e - 0.35) / 0.65));
      },
    },
  ];

  // ---------- Lunar Siege Intro Cutscene ----------
  const fissurePos = ground(B.x - 24, B.z + 22, 0);
  const siegeDust = new DustBurst(900);
  scene.add(siegeDust.points);

  const siegeEruption = new THREE.Group();
  siegeEruption.position.copy(fissurePos);
  siegeEruption.visible = false;

  // Dark jagged glowing seismic fissure pit on the regolith
  const pitMesh = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 11),
    new THREE.MeshBasicMaterial({ color: 0x050308 }),
  );
  pitMesh.rotation.x = -Math.PI / 2;
  pitMesh.position.y = 0.04;
  pitMesh.scale.set(1.45, 0.72, 1);
  siegeEruption.add(pitMesh);

  const fissureMat = new THREE.MeshBasicMaterial({
    color: 0xff2a55,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const fissureCore = new THREE.Mesh(new THREE.RingGeometry(0.45, 2.35, 9), fissureMat);
  fissureCore.rotation.x = -Math.PI / 2;
  fissureCore.position.y = 0.07;
  fissureCore.scale.set(1.5, 0.62, 1);
  siegeEruption.add(fissureCore);

  // Radiating glowing seismic fracture veins
  const crackGeo = new THREE.PlaneGeometry(0.16, 3.2);
  for (let i = 0; i < 6; i++) {
    const crack = new THREE.Mesh(crackGeo, fissureMat);
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = (i / 6) * Math.PI * 2 + (i % 2) * 0.25;
    crack.position.set(Math.cos(crack.rotation.z) * 1.4, 0.06, Math.sin(crack.rotation.z) * 0.9);
    siegeEruption.add(crack);
  }

  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.92, metalness: 0.1 });
  const rimGeo = new THREE.DodecahedronGeometry(0.55, 0);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const shard = new THREE.Mesh(rimGeo, rimMat);
    shard.position.set(Math.cos(ang) * 3.1, 0.18, Math.sin(ang) * 1.75);
    shard.scale.set(1.1 + (i % 3) * 0.35, 0.5 + (i % 2) * 0.45, 0.9);
    shard.rotation.set(i * 0.7, ang, i * 0.4);
    shard.castShadow = false;
    siegeEruption.add(shard);
  }

  const fissureLight = new THREE.PointLight(0xff3355, 10, 20, 1.8);
  fissureLight.position.set(0, 1.4, 0);
  fissureLight.castShadow = false;
  siegeEruption.add(fissureLight);

  // Detailed grotesque emerging alien silhouettes: clusters of uneven glowing eyes, snapping bone mandibles, articulated spider limbs
  const alienCarapaceMat = new THREE.MeshStandardMaterial({ color: 0x160f1d, roughness: 0.48, metalness: 0.35 });
  const alienBoneMat = new THREE.MeshStandardMaterial({ color: 0x9b8f7a, roughness: 0.55, metalness: 0.12 });
  const eyeCrimsonMat = new THREE.MeshStandardMaterial({
    color: 0xff2844,
    emissive: 0xff1a36,
    emissiveIntensity: 3.8,
    roughness: 0.15,
  });
  const eyeAcidMat = new THREE.MeshStandardMaterial({
    color: 0x7eff38,
    emissive: 0x58ff1a,
    emissiveIntensity: 3.6,
    roughness: 0.15,
  });
  const eyeGeo = new THREE.SphereGeometry(0.065, 8, 6);
  const femurGeo = new THREE.CylinderGeometry(0.075, 0.05, 1.05, 6);
  const tibiaGeo = new THREE.ConeGeometry(0.06, 1.25, 5);
  const mandibleGeo = new THREE.ConeGeometry(0.07, 0.58, 5);
  const spineGeo = new THREE.ConeGeometry(0.055, 0.44, 5);

  const silhouettes: {
    group: THREE.Group;
    leftJaw: THREE.Object3D;
    rightJaw: THREE.Object3D;
    legs: THREE.Object3D[];
    maxY: number;
    phase: number;
  }[] = [];
  const emergers = [
    { x: -1.6, z: 0.35, h: 1.55, acid: false, yaw: 0.45, scale: 0.95 },
    { x: 0.0, z: -0.15, h: 2.45, acid: false, yaw: 0.12, scale: 1.32 },
    { x: 1.65, z: 0.45, h: 1.65, acid: true, yaw: -0.5, scale: 1.0 },
    { x: -0.8, z: -0.95, h: 1.4, acid: true, yaw: 0.28, scale: 0.88 },
    { x: 0.95, z: -0.85, h: 1.5, acid: false, yaw: -0.32, scale: 0.92 },
  ];
  const eyeOffsets: [number, number, number, number][] = [
    [-0.14, 0.12, 0.36, 1.25],
    [0.16, 0.1, 0.35, 1.15],
    [-0.25, 0.02, 0.3, 0.78],
    [0.24, 0.04, 0.31, 0.85],
    [-0.05, 0.22, 0.33, 0.72],
    [0.08, 0.2, 0.34, 0.68],
  ];

  for (let i = 0; i < emergers.length; i++) {
    const e = emergers[i];
    const g = new THREE.Group();

    // Armored jagged cranium + dorsal bone spines
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), alienCarapaceMat);
    head.scale.set(1.15, 0.88, 1.35);
    g.add(head);

    for (let s = 0; s < 4; s++) {
      const sp = new THREE.Mesh(spineGeo, alienBoneMat);
      sp.position.set((s % 2 === 0 ? -1 : 1) * 0.12, 0.32 - s * 0.03, -0.05 - s * 0.14);
      sp.rotation.x = -0.45 - s * 0.12;
      g.add(sp);
    }

    // Uneven cluster of 6 glowing eyes
    const eMat = e.acid ? eyeAcidMat : eyeCrimsonMat;
    for (const [ex, ey, ez, es] of eyeOffsets) {
      const eye = new THREE.Mesh(eyeGeo, eMat);
      eye.position.set(ex, ey, ez);
      eye.scale.setScalar(es);
      g.add(eye);
    }

    // Snapping bone mandibles (animated in update)
    const leftJaw = new THREE.Group();
    leftJaw.position.set(-0.18, -0.1, 0.36);
    const lFang = new THREE.Mesh(mandibleGeo, alienBoneMat);
    lFang.rotation.set(Math.PI * 0.58, 0, -0.35);
    lFang.position.set(-0.08, -0.05, 0.2);
    leftJaw.add(lFang);
    g.add(leftJaw);

    const rightJaw = new THREE.Group();
    rightJaw.position.set(0.18, -0.1, 0.36);
    const rFang = new THREE.Mesh(mandibleGeo, alienBoneMat);
    rFang.rotation.set(Math.PI * 0.58, 0, 0.35);
    rFang.position.set(0.08, -0.05, 0.2);
    rightJaw.add(rFang);
    g.add(rightJaw);

    // 4 articulated clawed spider limbs reaching out of the fissure
    const legs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      for (let pair = 0; pair < 2; pair++) {
        const legPivot = new THREE.Group();
        legPivot.position.set(side * 0.32, -0.08 - pair * 0.16, 0.08 - pair * 0.22);
        const femur = new THREE.Mesh(femurGeo, alienCarapaceMat);
        femur.position.set(side * 0.34, 0.36, 0.12);
        femur.rotation.set(0.35, 0, -side * 0.72);
        const tibia = new THREE.Mesh(tibiaGeo, alienBoneMat);
        tibia.position.set(side * 0.76, 0.12, 0.34);
        tibia.rotation.set(0.75, 0, -side * 2.55);
        legPivot.add(femur, tibia);
        g.add(legPivot);
        legs.push(legPivot);
      }
    }

    g.scale.setScalar(e.scale);
    g.position.set(e.x, -1.5, e.z);
    g.rotation.y = e.yaw;
    g.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    siegeEruption.add(g);
    silhouettes.push({ group: g, leftJaw, rightJaw, legs, maxY: e.h, phase: i * 1.35 });
  }
  scene.add(siegeEruption);

  let siegeRoared = false;
  let siegeLocked = false;
  const hideSiegeEruption = () => {
    siegeEruption.visible = false;
    siegeDust.hide();
  };

  const o2Pos = outpost.o2StationPos;
  const airlockPos = outpost.airlockPos;

  const siegeIntro: Shot[] = [
    {
      dur: 4.5,
      caption: 'cs.caption.siege',
      sub: 'cs.siege_1',
      vo: 'cs_siege_1',
      start: () => {
        hideSiegeEruption();
        sfx('klaxon');
      },
      update: (k) => {
        shake.rumble(0.08 + k * 0.28);
      },
      cam: move(
        v(B.x - 28, hab.y + 4.2, B.z + 24),
        v(B.x + 14, hab.y + 6.5, B.z + 28),
        v(B.x - 2, hab.y + 2.8, B.z),
        v(B.x + 2, hab.y + 2.4, B.z - 2),
      ),
    },
    {
      dur: 5.0,
      sub: 'cs.siege_2',
      vo: 'cs_siege_2',
      start: () => {
        siegeRoared = false;
        siegeEruption.visible = true;
        siegeDust.reset(fissurePos);
        sfx('burrow');
        shake.add(0.55);
      },
      update: (k, dt) => {
        if (k > 0.35 && !siegeRoared) {
          siegeRoared = true;
          sfx('boss_roar');
          shake.add(0.48);
        }
        siegeDust.update(dt, k < 0.72 ? 1 - k * 0.45 : 0);
        const rise = ease(Math.min(1, Math.max(0, (k - 0.08) / 0.6)));
        for (const s of silhouettes) {
          s.group.position.y = -1.4 + (s.maxY + 1.4) * rise + Math.sin(k * 24 + s.phase) * 0.08 * rise;
          s.group.rotation.z = Math.sin(k * 18 + s.phase) * 0.14 * rise;
          const snap = 0.18 + Math.abs(Math.sin(k * 26 + s.phase)) * 0.55;
          s.leftJaw.rotation.y = -snap;
          s.rightJaw.rotation.y = snap;
          for (let li = 0; li < s.legs.length; li++) {
            s.legs[li].rotation.x = Math.sin(k * 20 + s.phase + li * 1.4) * 0.28 * rise;
          }
        }
        fissureLight.intensity = 7 + Math.sin(k * 38) * 3.8;
        fissureMat.opacity = 0.65 + 0.3 * Math.sin(k * 28);
        shake.rumble(0.24 * (1 - k * 0.5));
        if (k >= 1) hideSiegeEruption();
      },
      cleanup: hideSiegeEruption,
      cam: orbit(fissurePos, 11, 2.4, 0.4, 1.55, 1.2),
    },
    {
      dur: 4.5,
      sub: 'cs.siege_3',
      vo: 'cs_siege_3',
      start: () => {
        sfx('powerup');
        const rvPos = rv.position.clone();
        siegeIntro[2].cam = move(
          v(o2Pos.x + 7, o2Pos.y + 3.2, o2Pos.z + 8),
          v(rvPos.x - 5.5, rvPos.y + 2.8, rvPos.z + 6.5),
          v((o2Pos.x + airlockPos.x) * 0.5, hab.y + 1.8, (o2Pos.z + airlockPos.z) * 0.5),
          v(rvPos.x, rvPos.y + 1.2, rvPos.z),
        );
      },
      cam: () => {},
    },
    {
      dur: 4.0,
      sub: 'cs.siege_4',
      vo: 'cs_siege_4',
      start: () => {
        siegeLocked = false;
        sfx('reload');
        const camEnd = start.pos.clone().add(v(0, 1.62, 0));
        const fwd = v(-Math.sin(start.yaw), 0, -Math.cos(start.yaw));
        const camStart = camEnd.clone().addScaledVector(fwd, -10).add(v(3.5, 2.6, 0));
        const lookStart = camEnd.clone().addScaledVector(fwd, 12);
        const lookEnd = camEnd.clone().addScaledVector(fwd, 20);
        siegeIntro[3].cam = move(camStart, camEnd, lookStart, lookEnd);
      },
      update: (k) => {
        if (k > 0.62 && !siegeLocked) {
          siegeLocked = true;
          sfx('gun_rail');
        }
      },
      cam: () => {},
    },
  ];

  return {
    intro,
    m1End,
    m2Intro,
    m2End,
    m3Intro,
    m3End,
    m4Intro,
    m4End,
    m5Intro,
    m5End,
    m6Intro,
    m6End,
    m7Intro,
    m7End,
    m8Intro,
    m8End,
    m9Intro,
    m9End,
    siegeIntro,
  };
}
