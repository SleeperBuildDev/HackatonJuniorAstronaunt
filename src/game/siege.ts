import * as THREE from 'three';
import { setExertion, sfx, stopVoices, type Sfx } from '../audio/audio';
import {
  playCharacterLine,
  playSiegeMc,
  setSiegeIntensity,
  siegeSfx,
  startSiegeAudio,
  stopSiegeAudio,
} from '../audio/siegeAudio';
import { shake } from '../engine/shake';
import type { Input } from '../player/input';
import type { Player } from '../player/player';
import type { Rover } from '../player/rover';
import type { Outpost } from '../world/base';
import { heightAt, LAYOUT } from '../world/heightfield';
import { AlienManager, type Alien, type AlienKind } from './aliens';
import type { GuideTarget } from './mission';
import {
  computeStats,
  resetSiegeState,
  saveSiegeRecord,
  siege,
  UPGRADES,
  WEAPONS,
  type BossHud,
  type ComputedStats,
  type RadarBlip,
  type SiegeSnapshot,
  type WeaponDef,
} from './siegeState';
import { habInside, suit } from './state';
import { WeaponRig, type PlasmaOrbHit } from './weapons';

// Endless Lunar Siege combat loop: wave director, 4 sci-fi weapons (on foot + rover turret),
// alien grab/stun escape, survival O2/Power/Station recharge pressure, upgrades, and radar.

export interface SiegeDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: Player;
  rover: Rover;
  outpost: Outpost;
  input: Input;
  flash: (msg: string, secs?: number) => void;
  onRequestUnlock: () => void;
  onRequestLock: () => void;
  onGameOver: () => void;
}

const MAX_ACTIVE_ALIENS = 20;
const RADAR_RANGE = 75;
const BOSS_ROTATION: readonly AlienKind[] = ['boss_broodmother', 'boss_leviathan', 'boss_apex'];
const WEAPON_SFX: Record<WeaponDef['id'], Sfx> = {
  carbine: 'gun_carbine',
  shotgun: 'gun_shotgun',
  railgun: 'gun_rail',
  plasma: 'gun_plasma',
};

const SCORE_BY_KIND: Record<AlienKind, number> = {
  stalker: 100,
  burrower: 140,
  flyer: 160,
  spitter: 175,
  boss_broodmother: 1200,
  boss_leviathan: 1400,
  boss_apex: 1500,
};

function wrapAngle(a: number) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export class SiegeManager {
  readonly aliens: AlienManager;
  readonly weapons: WeaponRig;
  active = false;
  started = false;

  private spawnQueue: AlienKind[] = [];
  private spawnTimer = 0;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private reloadDuration = 0;
  private grabber: Alien | null = null;
  private grabImmunity = 0;
  private habStayTimer = 0;
  private noPowerWarnCooldown = 0;
  private lowO2AlarmCooldown = 0;
  private radarAcc = 0;
  private feedId = 1;
  private feedEntries: { id: number; textKey: string; vars?: Record<string, string | number>; ttl: number }[] = [];
  private bossTierByWave = 1;
  private prevCamYaw = 0;
  private prevCamPitch = 0;
  private camInit = false;
  private wasInRover = false;
  private mcRoverVoiced = false;
  private mcO2Voiced = false;
  private lowO2Voiced = false;
  private lowPwrVoiced = false;
  private burrowVoiced = false;
  private flyerVoiced = false;
  private delayedStartQuip = 0;
  private ambientTimer = 2.5;
  private heartbeatTimer = 0;

  // Scratch vectors to avoid per-frame allocations.
  private readonly raycaster = new THREE.Raycaster();
  private readonly camFwd = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpEnd = new THREE.Vector3();
  private readonly tmpCenter = new THREE.Vector3();
  private readonly tmpKnock = new THREE.Vector3();
  private readonly roverMuzzleLocal = new THREE.Vector3(1.55, 1.55, 0.1);

  constructor(private readonly deps: SiegeDeps) {
    this.aliens = new AlienManager(deps.scene);
    this.weapons = new WeaponRig(deps.scene, deps.camera, deps.rover.obj);
    this.weapons.setActive(false);
  }

  isGrabbed(): boolean {
    return this.active && siege.value.grab.active;
  }

  /** Resets Siege state & world entities and equips the weapon rig (waiting for start()). */
  reset(): void {
    this.active = true;
    this.started = false;
    this.spawnQueue.length = 0;
    this.spawnTimer = 0;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.grabber = null;
    this.grabImmunity = 0;
    this.habStayTimer = 0;
    this.noPowerWarnCooldown = 0;
    this.lowO2AlarmCooldown = 0;
    this.radarAcc = 1;
    this.feedEntries = [];
    this.camInit = false;
    this.wasInRover = false;
    this.mcRoverVoiced = false;
    this.mcO2Voiced = false;
    this.lowO2Voiced = false;
    this.lowPwrVoiced = false;
    this.burrowVoiced = false;
    this.flyerVoiced = false;
    this.delayedStartQuip = 0;
    this.ambientTimer = 2.5;
    this.heartbeatTimer = 0;

    this.aliens.clear();
    this.weapons.clear();
    this.weapons.setActive(false);
    this.weapons.setWeapon(WEAPONS[0].id);
    this.weapons.setInRover(false);
    this.weapons.setReloading(0);

    this.deps.player.stunned = false;
    this.deps.player.speedMul = 1;
    this.deps.rover.speedMul = 1;
    this.deps.rover.freeLook = true;

    resetSiegeState();
    suit.value = { o2: 100, power: 100, health: 100, tempIn: 21, tempOut: -48, dose: 0, light: false };
  }

  /** Launches Wave 1 immediately when the player deploys from briefing. */
  start(): void {
    if (!this.active) this.reset();
    if (this.started) return;
    this.started = true;
    startSiegeAudio();
    this.weapons.setActive(true);
    this.startWave(1);
  }

  /** Cleanly exits Siege mode and restores Story defaults. */
  stop(): void {
    this.active = false;
    this.started = false;
    this.spawnQueue.length = 0;
    this.grabber = null;
    this.feedEntries = [];
    this.aliens.clear();
    this.weapons.clear();
    this.weapons.setActive(false);
    this.deps.player.stunned = false;
    this.deps.player.speedMul = 1;
    this.deps.rover.speedMul = 1;
    this.deps.rover.freeLook = false;
    setSiegeIntensity(0);
    stopSiegeAudio();
    stopVoices();
    setExertion(0.2);
  }

  /** Recharge at outdoor O2 station, outdoor PDU Power station, or inside HAB-1. */
  rechargeStation(kind: 'o2' | 'power' | 'hab-suit' | 'hab-med'): void {
    const snap = siege.value;
    const s = { ...suit.value };
    let o2Leak = snap.o2Leak;

    if (kind === 'o2') {
      s.o2 = 100;
      o2Leak = 0;
      sfx('refill');
      this.deps.flash('sg.i.o2full', 2.4);
      this.pushFeed('sg.i.o2full');
    } else if (kind === 'power') {
      s.power = 100;
      this.deps.rover.battery = 100;
      sfx('powerup');
      this.deps.flash('sg.i.powerfull', 2.4);
      this.pushFeed('sg.i.powerfull');
    } else if (kind === 'hab-suit') {
      s.o2 = 100;
      s.power = 100;
      s.health = snap.maxHealth;
      o2Leak = 0;
      sfx('powerup');
      this.deps.flash('sg.i.suitfull', 2.6);
      this.pushFeed('sg.i.suitfull');
    } else if (kind === 'hab-med') {
      s.health = snap.maxHealth;
      o2Leak = 0;
      sfx('refill');
      this.deps.flash('sg.i.healed', 2.4);
      this.pushFeed('sg.i.healed');
    }

    suit.value = s;
    playCharacterLine('refill');
    siege.value = { ...snap, o2Leak, stationAlert: this.computeStationAlert(s, snap.maxHealth) };
  }

  /** Applies the chosen post-wave upgrade and begins the intermission countdown. */
  pickUpgrade(id: string): void {
    const snap = siege.value;
    if (!this.active || snap.phase !== 'upgrade') return;
    if (!snap.upgradeChoices.includes(id)) return;

    const upgrades = { ...snap.upgrades, [id]: (snap.upgrades[id] ?? 0) + 1 };
    const stats = computeStats(upgrades);
    const maxAmmo = WEAPONS.map((w) => Math.max(1, Math.round(w.magSize * stats.magMul)));
    const ammo = [...snap.ammo];
    const s = { ...suit.value };
    let o2Leak = snap.o2Leak;

    if (id === 'o2tank') {
      s.o2 = Math.min(100, s.o2 + 75);
      o2Leak = 0;
    } else if (id === 'battery') {
      s.health = Math.min(stats.maxHealth, s.health + 55);
      s.power = Math.min(100, s.power + 45);
    } else if (id === 'medsurge') {
      s.health = stats.maxHealth;
      s.o2 = 100;
      s.power = 100;
      this.deps.rover.battery = 100;
      o2Leak = 0;
    } else if (id === 'mag') {
      for (let i = 0; i < ammo.length; i++) ammo[i] = maxAmmo[i];
    } else if (id === 'rover') {
      this.deps.rover.battery = 100;
    }

    // Clamp ammo to new maxAmmo if needed
    for (let i = 0; i < ammo.length; i++) ammo[i] = Math.min(ammo[i], maxAmmo[i]);

    suit.value = s;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.weapons.setReloading(0);

    siege.value = {
      ...snap,
      phase: 'intermission',
      intermission: 6,
      upgrades,
      upgradeChoices: [],
      ammo,
      maxAmmo,
      reloading: 0,
      maxHealth: stats.maxHealth,
      o2Leak,
      stationAlert: this.computeStationAlert(s, stats.maxHealth),
    };

    sfx('powerup');
    siegeSfx('upgrade_pick', 1);
    playCharacterLine('upgrade');
    this.deps.onRequestLock();
  }

  /** Dynamic 3D beam + HUD waypoint target for Siege mode. */
  guideTarget(): GuideTarget | null {
    if (!this.active || !this.started) return null;
    const snap = siege.value;
    if (snap.phase === 'gameover' || snap.phase === 'upgrade') return null;

    const s = suit.value;
    if (s.o2 < 32) {
      return { pos: this.deps.outpost.o2StationPos.clone().add(new THREE.Vector3(0, 1.5, 0)), label: 'sg.wp.o2' };
    }
    if (s.health < snap.maxHealth * 0.35) {
      return { pos: this.deps.outpost.airlockPos.clone().add(new THREE.Vector3(0, 1.5, 0)), label: 'sg.wp.hab' };
    }
    if (s.power < 25) {
      return { pos: this.deps.outpost.power.terminalPos.clone().add(new THREE.Vector3(0, 1.4, 0)), label: 'sg.wp.power' };
    }

    const boss = this.aliens.activeBoss();
    if (boss) {
      return { pos: boss.pos.clone().add(new THREE.Vector3(0, boss.isFlying ? 0 : 2.8, 0)), label: 'sg.wp.boss' };
    }

    if (snap.phase === 'fighting' && this.aliens.aliveCount() > 0 && this.aliens.aliveCount() <= 4) {
      const ref = this.deps.rover.driving ? this.deps.rover.obj.position : this.deps.player.feet;
      let best: Alien | null = null;
      let bestD = Infinity;
      for (const a of this.aliens.aliens) {
        if (a.state === 'dying') continue;
        const d = a.pos.distanceToSquared(ref);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) {
        return { pos: best.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), label: 'sg.wp.alien' };
      }
    }

    return null;
  }

  /** Main per-frame update called from main.ts when gameMode === 'siege'. */
  update(dt: number, now: number, playing: boolean, inMoves: boolean): void {
    if (!this.active || !this.started) return;

    const { camera, player, rover, input, outpost } = this.deps;
    const snap = siege.value;

    // Track camera angular deltas for weapon viewmodel sway (without consuming input.takeLook).
    this.camEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    let lookDX = 0;
    let lookDY = 0;
    if (this.camInit && dt > 1e-4) {
      lookDX = THREE.MathUtils.clamp(-wrapAngle(this.camEuler.y - this.prevCamYaw) * 18, -2.5, 2.5);
      lookDY = THREE.MathUtils.clamp(-(this.camEuler.x - this.prevCamPitch) * 18, -2.5, 2.5);
    }
    this.prevCamYaw = this.camEuler.y;
    this.prevCamPitch = this.camEuler.x;
    this.camInit = true;

    this.weapons.setInRover(rover.driving);

    if (snap.phase === 'gameover') {
      player.stunned = false;
      this.weapons.update(
        dt,
        {
          moving: false,
          sprinting: false,
          grounded: true,
          lookDX: 0,
          lookDY: 0,
          aimPitch: this.camEuler.x,
          aimYaw: this.camEuler.y,
          inRover: rover.driving,
          stunned: true,
          camera,
        },
        () => false,
        () => {},
      );
      return;
    }

    // Pause combat while choosing an upgrade or paused in menu/panel.
    if (snap.phase === 'upgrade' || !playing) {
      if (snap.damageFlash > 0 || snap.hitMarker) {
        const nextHit = snap.hitMarker ? (snap.hitMarker.ttl - dt > 0 ? { ...snap.hitMarker, ttl: snap.hitMarker.ttl - dt } : null) : null;
        siege.value = { ...snap, damageFlash: Math.max(0, snap.damageFlash - dt * 2.2), hitMarker: nextHit };
      }
      this.weapons.update(
        dt,
        {
          moving: false,
          sprinting: false,
          grounded: true,
          lookDX: 0,
          lookDY: 0,
          aimPitch: this.camEuler.x,
          aimYaw: this.camEuler.y,
          inRover: rover.driving,
          stunned: snap.grab.active,
          camera,
        },
        () => false,
        () => {},
      );
      return;
    }

    const stats = computeStats(snap.upgrades);
    player.speedMul = stats.moveSpeedMul;
    rover.speedMul = stats.roverSpeedMul;
    rover.freeLook = true;

    this.grabImmunity = Math.max(0, this.grabImmunity - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.noPowerWarnCooldown = Math.max(0, this.noPowerWarnCooldown - dt);
    this.lowO2AlarmCooldown = Math.max(0, this.lowO2AlarmCooldown - dt);

    // Delayed character taunt on Wave 1 so Mission Control finishes first
    if (this.delayedStartQuip > 0) {
      this.delayedStartQuip -= dt;
      if (this.delayedStartQuip <= 0) playCharacterLine('start');
    }

    // Rover entry voice & engine rev
    if (rover.driving && !this.wasInRover) {
      siegeSfx('rover_rev', 1);
      if (!this.mcRoverVoiced) {
        this.mcRoverVoiced = true;
        playSiegeMc('sg_mc_rover');
      } else {
        playCharacterLine('rover_in');
      }
    }
    this.wasInRover = rover.driving;

    // 1. Wave & Intermission progression
    if (snap.phase === 'intermission') {
      const nextInter = Math.max(0, snap.intermission - dt);
      if (nextInter > 0 && Math.ceil(nextInter) !== Math.ceil(snap.intermission)) {
        siegeSfx('intermission_tick', 0.7);
      }
      const skip = input.pressed('KeyG');
      if (skip || nextInter <= 0) {
        this.startWave(snap.wave + 1);
      } else {
        siege.value = { ...siege.value, intermission: nextInter, timeSec: snap.timeSec + dt };
      }
    } else if (snap.phase === 'fighting') {
      // Drain staggered spawn queue while keeping simultaneous alien count smooth for UHD 770.
      this.spawnTimer -= dt;
      while (this.spawnQueue.length > 0 && this.aliens.aliveCount() < MAX_ACTIVE_ALIENS && this.spawnTimer <= 0) {
        const kind = this.spawnQueue.shift()!;
        this.spawnOne(kind);
        const w = siege.value.wave;
        this.spawnTimer = Math.max(0.28, 0.72 - Math.min(0.4, w * 0.025)) + Math.random() * 0.25;
      }
    }

    // 2. Grab & Stun rapid key-mash escape
    this.updateGrab(dt, now, stats);

    // 3. Weapons: switching, reloading, shooting (works both on foot & while driving rover!)
    this.updateWeaponsInput(dt, stats, inMoves);

    // 4. Update Aliens & combat callbacks
    const playerPos = rover.driving ? rover.obj.position : player.feet;
    this.aliens.update(
      {
        dt,
        now,
        playerPos,
        playerEye: camera.position,
        camera,
        inRover: rover.driving,
        roverPos: rover.obj.position,
        roverSpeed: rover.speed,
        habInside: habInside.value,
        habCenter: outpost.habitatPos,
        grabbedAlienId: this.grabber ? this.grabber.id : null,
      },
      {
        onGrabAttempt: (a) => this.tryStartGrab(a, stats, now, inMoves),
        onRangedHit: (dmg) => {
          if (habInside.value || inMoves) return;
          siegeSfx('acid_hit', 0.9);
          this.applyPlayerDamage(dmg, dmg >= 14 ? 0.2 : 0, 0, 0.65, 0.35);
        },
        onBossSpawnMinion: (kind, x, z) => {
          if (this.aliens.aliveCount() >= MAX_ACTIVE_ALIENS + 4) return;
          this.aliens.spawn(kind, x, z, this.waveScale(), 1);
          siege.value = { ...siege.value, waveTotal: siege.value.waveTotal + 1 };
        },
        onRoverRam: (a, impactSpeed) => {
          const ramDmg = impactSpeed * 12 * stats.roverRamMul;
          const dir = rover.forward.clone();
          if (rover.speed < 0) dir.negate();
          dir.y = 0.35;
          dir.normalize();
          const killed = this.aliens.damageAlien(a, ramDmg, dir, 10 * stats.roverRamMul, false);
          sfx('hit');
          siegeSfx('roadkill', Math.min(1, impactSpeed / 5));
          shake.add(0.28);
          this.setHitMarker(killed ? 'kill' : 'hit');
          if (killed) {
            playCharacterLine('roadkill', true);
            this.handleAlienKilled(a, stats);
          }
        },
        onShockwave: (dmg, dist) => {
          if (habInside.value || inMoves) return;
          const falloff = Math.max(0.35, 1 - dist / 18);
          siegeSfx('boss_shockwave', 1);
          this.applyPlayerDamage(Math.round(dmg * falloff), 0.15, 0, 0.72, 0.55);
        },
      },
    );

    // 5. Update 3D Weapons Viewmodel, Turret, Tracers & Flying Plasma Orbs
    this.weapons.update(
      dt,
      {
        moving: rover.driving ? Math.abs(rover.speed) > 0.3 : player.moving,
        sprinting: !rover.driving && player.sprinting,
        grounded: rover.driving ? true : player.grounded,
        lookDX,
        lookDY,
        aimPitch: this.camEuler.x,
        aimYaw: this.camEuler.y,
        inRover: rover.driving,
        stunned: siege.value.grab.active,
        camera,
      },
      (pos, radius) => this.checkPlasmaOrbHit(pos, radius),
      (hit) => this.handlePlasmaExplode(hit, stats),
    );

    // 6. Combat Suit Simulation (O2, Power, Rover Battery, HAB-1 Refuge)
    this.updateSuitSurvival(dt, stats);

    // 6b. Ambient combat foley (alien chitters, wing flaps, boss stomps, low-HP heartbeat)
    this.updateAmbientAudio(dt);

    // 7. Check wave clear after alien & plasma updates
    const cur = siege.value;
    if (cur.phase === 'fighting') {
      const remaining = this.spawnQueue.length + this.aliens.aliveCount();
      if (remaining === 0) {
        this.completeWave();
        return;
      }
    }

    // 8. Decay HUD VFX, Kill Feed, Boss Bar, and throttled Motion Tracker Radar (~15 Hz)
    this.updateHudSnapshot(dt);
  }

  private waveScale(wave = siege.value.wave): number {
    return 1 + (wave - 1) * 0.18 + Math.max(0, wave - 9) * 0.08;
  }

  private buildWaveQueue(wave: number): AlienKind[] {
    const q: AlienKind[] = [];
    if (wave === 1) {
      for (let i = 0; i < 7; i++) q.push('stalker');
      for (let i = 0; i < 2; i++) q.push('burrower');
      return this.interleave(q);
    }
    if (wave === 2) {
      for (let i = 0; i < 6; i++) q.push('stalker');
      for (let i = 0; i < 4; i++) q.push('burrower');
      for (let i = 0; i < 3; i++) q.push('flyer');
      return this.interleave(q);
    }
    if (wave % 3 === 0) {
      const bossIdx = (wave / 3 - 1) % 3;
      const tier = Math.floor((wave / 3 - 1) / 3) + 1;
      this.bossTierByWave = tier;
      const bossKind = BOSS_ROTATION[bossIdx];
      q.push(bossKind);
      const escortCount = 5 + Math.min(18, wave + tier * 2);
      for (let i = 0; i < escortCount; i++) {
        const r = i % 4;
        if (r === 0) q.push('stalker');
        else if (r === 1) q.push('burrower');
        else if (r === 2) q.push('flyer');
        else q.push(wave >= 6 ? 'spitter' : 'stalker');
      }
      // Keep boss first so it spawns immediately!
      const [boss, ...escorts] = q;
      return [boss, ...this.interleave(escorts)];
    }

    // Wave 4+ endless scaling mix
    const total = Math.min(48, 8 + wave * 3);
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      if (r < 0.34) q.push('stalker');
      else if (r < 0.58) q.push('burrower');
      else if (r < 0.8) q.push('flyer');
      else q.push('spitter');
    }
    // Guarantee at least 2 burrowers and 2 flyers in every wave 4+
    if (!q.includes('burrower')) q[0] = 'burrower';
    if (!q.includes('flyer')) q[1] = 'flyer';
    return q;
  }

  private interleave(arr: AlienKind[]): AlienKind[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private startWave(wave: number): void {
    const queue = this.buildWaveQueue(wave);
    this.spawnQueue = queue;
    this.spawnTimer = 0;
    this.habStayTimer = 0;

    const isBoss = wave % 3 === 0;
    const total = queue.length;

    // Spawn an exciting opening burst immediately so combat starts right away!
    const initialBurst = isBoss ? Math.min(4, queue.length) : Math.min(5, queue.length);
    for (let i = 0; i < initialBurst; i++) {
      const next = this.spawnQueue.shift();
      if (next) this.spawnOne(next);
    }
    this.spawnTimer = 0.8;

    if (isBoss) {
      sfx('boss_roar');
      shake.add(0.42);
      this.pushFeed('sg.bossIncoming');
      setSiegeIntensity(2);
      if (wave === 3) playSiegeMc('sg_mc_boss');
      playCharacterLine('boss', true);
    } else {
      setSiegeIntensity(1);
      if (wave === 1) {
        playSiegeMc('sg_mc_start');
        this.delayedStartQuip = 4.2;
      } else {
        playCharacterLine('start');
      }
    }

    const snap = siege.value;
    siege.value = {
      ...snap,
      wave,
      phase: 'fighting',
      intermission: 0,
      enemiesLeft: total,
      waveTotal: total,
      boss: this.buildBossHud(),
    };
  }

  private pickSpawnPos(kind: AlienKind): { x: number; z: number } {
    const { player, rover, outpost, camera } = this.deps;
    const ref = rover.driving ? rover.obj.position : player.feet;
    const hab = outpost.habitatPos;
    camera.getWorldDirection(this.camFwd);
    const lookAngle = Math.atan2(this.camFwd.x, this.camFwd.z);

    let minR = 26;
    let maxR = 48;
    let biasFront = 0.4;
    if (kind === 'burrower') {
      minR = 11;
      maxR = 25;
      biasFront = 0.72;
    } else if (kind === 'flyer') {
      minR = 32;
      maxR = 56;
      biasFront = 0.5;
    } else if (kind.startsWith('boss_')) {
      minR = 34;
      maxR = 46;
      biasFront = 0.9;
    }

    for (let tries = 0; tries < 20; tries++) {
      const ang = Math.random() < biasFront ? lookAngle + (Math.random() - 0.5) * 1.65 : Math.random() * Math.PI * 2;
      const dist = minR + Math.random() * (maxR - minR);
      const x = ref.x + Math.sin(ang) * dist;
      const z = ref.z + Math.cos(ang) * dist;
      // Keep inside play boundary and outside HAB-1/outpost core buildings
      if (Math.hypot(x, z) > LAYOUT.playRadius - 25) continue;
      if (Math.hypot(x - hab.x, z - hab.z) < 12.5) continue;
      if (Math.hypot(x - (hab.x + 6.4), z - (hab.z - 6.9)) < 9) continue; // LAB-1
      return { x, z };
    }
    return { x: ref.x - 24, z: ref.z + 24 };
  }

  private spawnOne(kind: AlienKind): Alien {
    const { x, z } = this.pickSpawnPos(kind);
    const tier = kind.startsWith('boss_') ? this.bossTierByWave : 1;
    const a = this.aliens.spawn(kind, x, z, this.waveScale(), tier);
    if (kind === 'burrower' || kind === 'boss_broodmother') {
      sfx('burrow');
      siegeSfx('alien_chitter', 0.8);
      if (kind === 'burrower' && (!this.burrowVoiced || Math.random() < 0.16)) {
        this.burrowVoiced = true;
        playCharacterLine('burrow');
      }
    } else if (kind === 'flyer') {
      siegeSfx('alien_screech', 0.75);
      if (!this.flyerVoiced || Math.random() < 0.16) {
        this.flyerVoiced = true;
        playCharacterLine('flyer');
      }
    } else if (kind === 'spitter') {
      siegeSfx('acid_spit', 0.7);
    }
    return a;
  }

  private completeWave(): void {
    const snap = siege.value;
    const waveBonus = 250 + snap.wave * 150 + (snap.wave % 3 === 0 ? 500 : 0);
    const score = snap.score + waveBonus;
    const newRecord = saveSiegeRecord(snap.wave, score) || snap.newRecord;
    const bestWave = Math.max(snap.bestWave, snap.wave);
    const bestScore = Math.max(snap.bestScore, score);

    sfx('wave_clear');
    setSiegeIntensity(1);
    if (snap.wave === 1) playSiegeMc('sg_mc_upgrade');
    else playCharacterLine('clear');
    this.pushFeed('sg.waveClear', { wave: snap.wave });
    this.releaseGrab(false);

    const choices = this.rollUpgrades(snap.upgrades, snap.maxHealth);

    siege.value = {
      ...snap,
      phase: 'upgrade',
      enemiesLeft: 0,
      score,
      bestWave,
      bestScore,
      newRecord,
      boss: null,
      upgradeChoices: choices,
      killFeed: this.activeFeedList(),
    };

    this.deps.onRequestUnlock();
  }

  private rollUpgrades(owned: Record<string, number>, maxHealth: number): string[] {
    const pool = UPGRADES.filter((u) => (owned[u.id] ?? 0) < u.maxStacks);
    const chosen: string[] = [];

    // Prioritize medsurge if HP < 55% or O2 < 45%
    const s = suit.value;
    if (s.health < maxHealth * 0.55 || s.o2 < 45) {
      const med = pool.find((u) => u.id === 'medsurge');
      if (med) chosen.push(med.id);
    }

    const candidates = pool.filter((u) => !chosen.includes(u.id));
    // Weighted shuffle: common 1.0, rare 0.8, epic 0.55
    while (chosen.length < 3 && candidates.length > 0) {
      const weights = candidates.map((u) => (u.rarity === 'common' ? 1.0 : u.rarity === 'rare' ? 0.8 : 0.55));
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum;
      let idx = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      chosen.push(candidates[idx].id);
      candidates.splice(idx, 1);
    }
    return chosen;
  }

  private tryStartGrab(a: Alien, stats: ComputedStats, now: number, inMoves: boolean): void {
    const snap = siege.value;
    if (snap.grab.active || this.grabImmunity > 0 || inMoves || habInside.value) return;
    if (a.state === 'dying') return;

    this.grabber = a;
    a.state = 'grabbing';
    this.deps.player.stunned = true;
    if (this.deps.rover.driving) this.deps.rover.speed *= 0.25;

    const reqTaps = Math.max(3, Math.round(a.grabTaps / stats.breakFreeMul));
    sfx('alien_grab');
    siegeSfx('alien_screech', 1);
    playCharacterLine('grab', true);
    shake.add(0.45);

    siege.value = {
      ...snap,
      grab: {
        active: true,
        alienNameKey: a.nameKey,
        taps: 0,
        requiredTaps: reqTaps,
        biteTimer: 2.5,
        biteDuration: 2.5,
        lastTapAt: now,
      },
    };
  }

  private releaseGrab(withImmunity: boolean): void {
    this.grabber = null;
    this.deps.player.stunned = false;
    if (withImmunity) this.grabImmunity = 2.6;
    const snap = siege.value;
    if (snap.grab.active) {
      siege.value = {
        ...snap,
        grab: { ...snap.grab, active: false, taps: 0 },
      };
    }
  }

  private updateGrab(dt: number, now: number, stats: ComputedStats): void {
    const snap = siege.value;
    if (!snap.grab.active) return;

    const g = this.grabber;
    if (!g || g.state === 'dying' || !this.aliens.aliens.includes(g)) {
      this.releaseGrab(true);
      return;
    }

    this.deps.player.stunned = true;
    if (this.deps.rover.driving) {
      this.deps.rover.speed *= Math.max(0, 1 - dt * 8);
    }

    let { taps, biteTimer, lastTapAt } = snap.grab;
    const { requiredTaps } = snap.grab;

    if (this.deps.input.pressed('Space') || this.deps.input.pressed('KeyE')) {
      taps += 1;
      lastTapAt = now;
      sfx('shove');
      shake.add(0.18);
    }

    const progress = Math.min(1, taps / Math.max(1, requiredTaps));
    this.aliens.setGrabPose(g, this.deps.camera, progress, now);

    if (taps >= requiredTaps) {
      this.deps.camera.getWorldDirection(this.camFwd);
      const killed = this.aliens.shoveAway(g, this.camFwd, stats.shoveDmg, 1.8);
      sfx('breakfree');
      playCharacterLine('escape', true);
      shake.add(0.3);
      this.releaseGrab(true);
      this.deps.flash('sg.grab.escaped', 2.2);
      if (killed) this.handleAlienKilled(g, stats);
      return;
    }

    biteTimer -= dt;
    if (biteTimer <= 0) {
      this.applyPlayerDamage(g.damage, 0.8, 6, 0.9, 0.65);
      biteTimer = 1.7;
    }

    if (siege.value.phase !== 'gameover') {
      siege.value = {
        ...siege.value,
        grab: { ...siege.value.grab, taps, biteTimer, lastTapAt },
      };
    }
  }

  private updateWeaponsInput(dt: number, stats: ComputedStats, inMoves: boolean): void {
    const { input } = this.deps;
    const snap = siege.value;
    let weaponIndex = snap.weaponIndex;

    // Switch via Digit1..Digit4
    const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const;
    for (let i = 0; i < keys.length; i++) {
      if (input.pressed(keys[i])) weaponIndex = i;
    }
    // Switch via mouse wheel
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const dir = wheel > 0 ? 1 : -1;
      weaponIndex = (weaponIndex + dir + WEAPONS.length) % WEAPONS.length;
    }

    if (weaponIndex !== snap.weaponIndex) {
      this.selectWeapon(weaponIndex);
    }

    const cur = siege.value;
    const idx = cur.weaponIndex;
    const w = WEAPONS[idx];

    // Reload progress
    if (this.reloadDuration > 0) {
      this.reloadTimer += dt;
      const frac = Math.min(1, this.reloadTimer / this.reloadDuration);
      this.weapons.setReloading(frac);
      if (frac >= 1) {
        this.reloadTimer = 0;
        this.reloadDuration = 0;
        this.weapons.setReloading(0);
        const ammo = [...cur.ammo];
        ammo[idx] = cur.maxAmmo[idx];
        siege.value = { ...siege.value, ammo, reloading: 0 };
      } else {
        siege.value = { ...siege.value, reloading: frac };
      }
      return;
    }

    // Manual reload
    if (input.pressed('KeyR') && cur.ammo[idx] < cur.maxAmmo[idx]) {
      this.startReload(w, stats);
      return;
    }

    // Firing (works both on foot AND in Rover turret!)
    if (cur.grab.active || inMoves || habInside.value) return;
    const trigger = input.mouseDown(0) || input.mousePressed(0);
    if (!trigger) return;

    if (cur.ammo[idx] <= 0) {
      this.startReload(w, stats);
      return;
    }

    if (this.fireCooldown <= 0) {
      this.fireWeapon(stats);
    }
  }

  private selectWeapon(index: number): void {
    const clamped = ((index % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.weapons.setReloading(0);
    this.weapons.setWeapon(WEAPONS[clamped].id);
    sfx('click');
    siegeSfx('weapon_switch', 0.9);
    siege.value = { ...siege.value, weaponIndex: clamped, reloading: 0 };
  }

  private startReload(w: WeaponDef, stats: ComputedStats): void {
    this.reloadDuration = Math.max(0.45, w.reloadSec / stats.reloadMul);
    this.reloadTimer = 0;
    this.weapons.setReloading(0.01);
    sfx('reload');
    if (Math.random() < 0.35) playCharacterLine('reload');
    siege.value = { ...siege.value, reloading: 0.01 };
  }

  private computeMuzzleOrigin(out: THREE.Vector3): THREE.Vector3 {
    const { camera, rover } = this.deps;
    if (rover.driving) {
      return out.copy(this.roverMuzzleLocal).applyMatrix4(rover.obj.matrixWorld);
    }
    camera.getWorldDirection(this.camFwd);
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    return out
      .copy(camera.position)
      .addScaledVector(this.camRight, 0.22)
      .addScaledVector(this.camUp, -0.15)
      .addScaledVector(this.camFwd, 0.62);
  }

  private fireWeapon(stats: ComputedStats): void {
    const { camera, rover } = this.deps;
    const snap = siege.value;
    const idx = snap.weaponIndex;
    const w = WEAPONS[idx];

    const s = { ...suit.value };
    const lowPower = s.power <= 0.01;
    const powerUse = w.powerCost * stats.powerDrainMul;
    s.power = Math.max(0, s.power - powerUse);
    if (lowPower && this.noPowerWarnCooldown <= 0) {
      this.noPowerWarnCooldown = 4;
      this.deps.flash('sg.w.noPower', 2.4);
    }
    suit.value = s;

    const ammo = [...snap.ammo];
    ammo[idx] = Math.max(0, ammo[idx] - 1);
    siege.value = { ...snap, ammo };

    const roverBoost = rover.driving ? stats.roverFireMul : 1;
    const powerMul = lowPower ? 0.65 : 1;
    const rate = Math.max(0.2, w.fireRate * stats.fireRateMul * roverBoost * powerMul);
    this.fireCooldown = 1 / rate;

    sfx(WEAPON_SFX[w.id]);
    if (lowPower) siegeSfx('dry_fire', 0.65);
    if (w.id === 'shotgun') siegeSfx('shell_bounce', 0.85);
    if (w.id === 'railgun') siegeSfx('rail_charge', 0.9);
    shake.add(w.id === 'railgun' ? 0.24 : w.id === 'shotgun' ? 0.2 : w.id === 'plasma' ? 0.14 : 0.07);

    const origin = this.computeMuzzleOrigin(this.tmpOrigin);
    camera.getWorldDirection(this.camFwd);
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

    if (w.id === 'plasma') {
      // Aim toward exact crosshair target so orbs land dead center.
      this.raycaster.set(camera.position, this.camFwd);
      const aimHits = this.aliens.raycast(this.raycaster, w.range, false);
      if (aimHits.length > 0) {
        this.tmpEnd.copy(aimHits[0].point);
      } else {
        this.tmpEnd.copy(camera.position).addScaledVector(this.camFwd, 65);
      }
      this.tmpDir.copy(this.tmpEnd).sub(origin).normalize();

      const dmg = w.damage * stats.damageMul;
      const splash = w.splashRadius ?? 5.2;
      const slowSec = (w.slowSec ?? 2.6) + stats.cryoSlow;
      const orbCount = 1 + stats.extraProjectiles;
      for (let i = 0; i < orbCount; i++) {
        const spreadIdx = i - (orbCount - 1) / 2;
        const dir = this.tmpDir.clone();
        if (spreadIdx !== 0) {
          dir.addScaledVector(this.camRight, spreadIdx * 0.055).normalize();
        }
        this.weapons.spawnPlasmaOrb(origin.clone(), dir, 48, dmg, splash, slowSec);
      }
      this.weapons.triggerFire(w.id, origin, this.tmpEnd, false);
      if (ammo[idx] <= 0) this.startReload(w, stats);
      return;
    }

    // Hitscan guns: Carbine, Shotgun, Railgun
    const totalPellets = w.id === 'shotgun' ? w.pellets + 4 * stats.extraProjectiles : w.pellets + stats.extraProjectiles;
    let bestHitKind: null | 'hit' | 'crit' | 'kill' = null;
    let anyCrit = false;
    let anyHit = false;
    let anyCryo = false;

    for (let p = 0; p < totalPellets; p++) {
      const spread = w.spread * (p === 0 && totalPellets === 1 ? 0.45 : 1);
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      this.tmpDir
        .copy(this.camFwd)
        .addScaledVector(this.camRight, sx)
        .addScaledVector(this.camUp, sy)
        .normalize();

      this.raycaster.set(camera.position, this.tmpDir);
      const hits = this.aliens.raycast(this.raycaster, w.range, !!w.pierce);

      if (hits.length > 0) {
        anyHit = true;
        let lastPoint = hits[hits.length - 1].point;
        for (const h of hits) {
          const critRoll = Math.random() < stats.critChance;
          const isCrit = h.weakpoint || critRoll;
          const mult = h.weakpoint && critRoll ? stats.critMul * 1.6 : isCrit ? stats.critMul : 1;
          const dmg = w.damage * stats.damageMul * mult;
          this.tmpKnock.copy(this.tmpDir);
          const slow = stats.cryoSlow > 0 ? stats.cryoSlow : w.slowSec;
          const killed = this.aliens.damageAlien(h.alien, dmg, this.tmpKnock, w.knockback, isCrit, slow);
          this.weapons.spawnHitSparks(h.point, isCrit ? 0xffd166 : w.color, isCrit ? 8 : 4);
          if (isCrit) anyCrit = true;
          if (killed) {
            bestHitKind = 'kill';
            this.handleAlienKilled(h.alien, stats);
          } else if (isCrit && bestHitKind !== 'kill') {
            bestHitKind = 'crit';
          } else if (!bestHitKind) {
            bestHitKind = 'hit';
          }
          // Cryo-Arc Rounds: frost-arc AoE splash around every gun hit
          if (stats.cryoSplashDmg > 0) {
            anyCryo = true;
            this.weapons.spawnHitSparks(h.point, 0x7ceeff, 5);
            const splashRes = this.aliens.splashDamage(h.point, 3.8, stats.cryoSplashDmg, stats.cryoSlow);
            for (const sk of splashRes.killed) {
              bestHitKind = 'kill';
              this.handleAlienKilled(sk, stats);
            }
          }
          lastPoint = h.point;
        }
        // Railgun pierces through the last hit target
        if (w.pierce) {
          this.tmpEnd.copy(camera.position).addScaledVector(this.tmpDir, Math.min(w.range, hits[hits.length - 1].distance + 18));
        } else {
          this.tmpEnd.copy(lastPoint);
        }
        this.weapons.triggerFire(w.id, origin, this.tmpEnd, true);
      } else {
        // Miss: check rough lunar ground intersection so tracers don't shoot underground
        this.tmpEnd.copy(camera.position).addScaledVector(this.tmpDir, Math.min(w.range, 90));
        const gy = heightAt(this.tmpEnd.x, this.tmpEnd.z);
        if (this.tmpEnd.y < gy) this.tmpEnd.y = gy + 0.05;
        this.weapons.triggerFire(w.id, origin, this.tmpEnd, false);
      }
    }

    if (anyHit) {
      sfx(anyCrit ? 'crit' : 'hit');
      if (anyCryo) siegeSfx('cryo_freeze', 0.75);
      if (bestHitKind) this.setHitMarker(bestHitKind);
    }

    if (ammo[idx] <= 0) this.startReload(w, stats);
  }

  private checkPlasmaOrbHit(pos: THREE.Vector3, radius: number): boolean {
    for (const a of this.aliens.aliens) {
      if (a.state === 'dying') continue;
      this.tmpCenter.set(a.pos.x, a.pos.y + (a.isFlying ? 0 : a.radius * 0.7), a.pos.z);
      const hitR = a.radius + radius + 0.35;
      if (this.tmpCenter.distanceToSquared(pos) <= hitR * hitR) return true;
    }
    return false;
  }

  private handlePlasmaExplode(hit: PlasmaOrbHit, stats: ComputedStats): void {
    sfx('plasma_boom');
    shake.add(0.24);
    const res = this.aliens.splashDamage(hit.pos, hit.radius, hit.damage, hit.slowSec);
    if (res.hitCount > 0) {
      sfx('hit');
      this.setHitMarker(res.killed.length > 0 ? 'kill' : 'hit');
    }
    for (const a of res.killed) {
      this.handleAlienKilled(a, stats);
    }
  }

  private handleAlienKilled(a: Alien, stats: ComputedStats): void {
    if (this.grabber && this.grabber.id === a.id) {
      this.releaseGrab(true);
    }
    sfx('alien_die');

    const snap = siege.value;
    const pts = Math.round((SCORE_BY_KIND[a.kind] ?? 100) * (1 + (snap.wave - 1) * 0.1));
    const kills = snap.kills + 1;
    const bossesKilled = snap.bossesKilled + (a.isBoss ? 1 : 0);
    const score = snap.score + pts;

    if (a.isBoss) {
      shake.add(0.5);
      sfx('wave_clear');
      setSiegeIntensity(1);
      playCharacterLine('boss_kill', true);
      this.pushFeed('sg.bossSlain');
    } else if (Math.random() < 0.22) {
      playCharacterLine('kill');
    }

    // Vampiric suit upgrade: restore HP & O2 per kill
    if (stats.vampHp > 0 || stats.vampO2 > 0) {
      const s = { ...suit.value };
      s.health = Math.min(snap.maxHealth, s.health + stats.vampHp * (a.isBoss ? 3 : 1));
      s.o2 = Math.min(100, s.o2 + stats.vampO2 * (a.isBoss ? 3 : 1));
      suit.value = s;
    }

    siege.value = {
      ...siege.value,
      kills,
      bossesKilled,
      score,
      killFeed: this.activeFeedList(),
    };
  }

  private applyPlayerDamage(hpDmg: number, addLeak: number, o2Loss: number, flashAmt: number, shakeAmt: number): void {
    const snap = siege.value;
    if (snap.phase === 'gameover') return;
    const stats = computeStats(snap.upgrades);
    const dmgScale = this.deps.rover.driving ? 1 - stats.roverShield : 1;
    const finalDmg = Math.max(1, hpDmg * dmgScale);
    const s = { ...suit.value };
    s.health = Math.max(0, s.health - finalDmg);
    if (o2Loss > 0) s.o2 = Math.max(0, s.o2 - o2Loss * dmgScale);
    suit.value = s;

    const o2Leak = Math.min(3.2, snap.o2Leak + addLeak * dmgScale);
    sfx('hurt');
    if (finalDmg >= 12) {
      siegeSfx('shield_break', 0.8);
      if (Math.random() < 0.35) playCharacterLine('hurt');
    }
    shake.add(shakeAmt);

    siege.value = {
      ...snap,
      o2Leak,
      damageFlash: Math.max(snap.damageFlash, flashAmt),
      stationAlert: this.computeStationAlert(s, snap.maxHealth),
    };

    if (s.health <= 0) {
      this.triggerGameOver();
    }
  }

  private updateSuitSurvival(dt: number, stats: ComputedStats): void {
    const snap = siege.value;
    if (snap.phase === 'gameover') return;

    const { player, rover, outpost } = this.deps;
    const s = { ...suit.value };
    let o2Leak = snap.o2Leak;
    const inside = habInside.value;

    if (inside) {
      s.o2 = Math.min(100, s.o2 + 14 * dt);
      s.power = Math.min(100, s.power + 5 * dt);
      o2Leak = Math.max(0, o2Leak - 2.5 * dt);
      s.tempOut = 21;
      if (snap.phase === 'fighting') {
        this.habStayTimer += dt;
        if (this.habStayTimer >= 12) {
          this.habStayTimer = 0;
          this.deps.flash('sg.w.habReturn', 3.5);
        }
      }
    } else {
      this.habStayTimer = 0;
      const exertion = rover.driving ? 0.85 : player.sprinting ? 1.55 : player.moving ? 1.1 : 0.78;
      const o2Drain = (0.78 * exertion * stats.o2DrainMul + o2Leak) * dt;
      s.o2 = Math.max(0, s.o2 - o2Drain);
      o2Leak = Math.max(0, o2Leak - 0.08 * dt);
      s.tempOut = -48 + Math.sin(performance.now() / 9000) * 3;
    }

    // Suit power passive drain + helmet lamp
    const powerDrain = (0.28 + (s.light ? 0.45 : 0)) * stats.powerDrainMul * dt;
    s.power = Math.max(0, s.power - powerDrain);
    if (s.power <= 0) s.light = false;

    // Passive suit health regen from Fusion Suit Core upgrade when not grabbed
    if (stats.hpRegen > 0 && !snap.grab.active && s.health > 0 && s.health < snap.maxHealth) {
      s.health = Math.min(snap.maxHealth, s.health + stats.hpRegen * dt);
    }

    // Rover battery perk (+6%/s * stacks) + proximity recharge near PDU/outpost
    const roverLevel = snap.upgrades.rover ?? 0;
    if (roverLevel > 0) {
      rover.battery = Math.min(100, rover.battery + 6 * roverLevel * dt);
    }
    if (!rover.driving && rover.obj.position.distanceTo(outpost.power.pos) < 16) {
      rover.battery = Math.min(100, rover.battery + 8 * dt);
    }

    // Low O2 & Power character / MC voice alerts
    if (s.o2 < 30 && !inside) {
      if (!this.lowO2Voiced) {
        this.lowO2Voiced = true;
        if (!this.mcO2Voiced) {
          this.mcO2Voiced = true;
          playSiegeMc('sg_mc_o2');
        } else {
          playCharacterLine('low_o2');
        }
      }
    } else if (s.o2 > 55) {
      this.lowO2Voiced = false;
    }
    if (s.power < 22) {
      if (!this.lowPwrVoiced) {
        this.lowPwrVoiced = true;
        playCharacterLine('low_pwr');
      }
    } else if (s.power > 50) {
      this.lowPwrVoiced = false;
    }

    // Asphyxiation when O2 reaches 0
    if (s.o2 <= 0 && !inside) {
      s.health = Math.max(0, s.health - 6 * dt);
      if (this.lowO2AlarmCooldown <= 0) {
        this.lowO2AlarmCooldown = 2.5;
        this.deps.flash('w.o2depleted', 1.8);
        sfx('alarm');
      }
    } else if (s.o2 < 20 && !inside && this.lowO2AlarmCooldown <= 0) {
      this.lowO2AlarmCooldown = 6;
      sfx('alarm');
    }

    suit.value = s;
    setExertion(!rover.driving && player.sprinting ? 1 : s.o2 < 25 || snap.grab.active ? 0.85 : 0.25);

    if (s.health <= 0) {
      this.triggerGameOver();
      return;
    }

    siege.value = {
      ...siege.value,
      o2Leak,
      stationAlert: this.computeStationAlert(s, snap.maxHealth),
    };
  }

  private updateAmbientAudio(dt: number): void {
    const snap = siege.value;
    if (snap.phase === 'gameover') return;

    const s = suit.value;
    const critical = s.health < snap.maxHealth * 0.35 || s.o2 < 25 || snap.grab.active;
    if (critical) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        siegeSfx('heartbeat', snap.grab.active ? 1 : 0.75);
        this.heartbeatTimer = snap.grab.active ? 0.62 : 0.95;
      }
    } else {
      this.heartbeatTimer = 0;
    }

    if (snap.phase !== 'fighting' || habInside.value) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 2.1 + Math.random() * 1.9;

    const ref = this.deps.rover.driving ? this.deps.rover.obj.position : this.deps.player.feet;
    let nearestGround = Infinity;
    let nearestFlyer = Infinity;
    let nearestBoss = Infinity;
    for (const a of this.aliens.aliens) {
      if (a.state === 'dying') continue;
      const d = a.pos.distanceTo(ref);
      if (a.isBoss && !a.isFlying && d < nearestBoss) nearestBoss = d;
      else if (a.isFlying && d < nearestFlyer) nearestFlyer = d;
      else if (!a.isFlying && d < nearestGround) nearestGround = d;
    }

    if (nearestBoss < 36) {
      siegeSfx('boss_stomp', Math.max(0.25, 1 - nearestBoss / 36));
    } else if (nearestFlyer < 30 && Math.random() < 0.55) {
      siegeSfx('wing_flap', Math.max(0.2, 1 - nearestFlyer / 30));
    } else if (nearestGround < 24) {
      siegeSfx('alien_chitter', Math.max(0.2, 1 - nearestGround / 24));
    }
  }

  private computeStationAlert(s: { o2: number; power: number; health: number }, maxHealth: number): null | 'o2' | 'power' | 'health' {
    if (s.o2 < 35) return 'o2';
    if (s.health < maxHealth * 0.4) return 'health';
    if (s.power < 28) return 'power';
    return null;
  }

  private triggerGameOver(): void {
    const snap = siege.value;
    if (snap.phase === 'gameover') return;
    this.releaseGrab(false);
    setSiegeIntensity(0);
    playSiegeMc('sg_mc_death');
    const newRecord = saveSiegeRecord(snap.wave, snap.score) || snap.newRecord;
    const bestWave = Math.max(snap.bestWave, snap.wave);
    const bestScore = Math.max(snap.bestScore, snap.score);
    siege.value = {
      ...snap,
      phase: 'gameover',
      bestWave,
      bestScore,
      newRecord,
      damageFlash: 1,
    };
    this.deps.onGameOver();
  }

  private setHitMarker(kind: 'hit' | 'crit' | 'kill'): void {
    const cur = siege.value.hitMarker;
    // Never downgrade a kill marker in the same frame
    if (cur && cur.kind === 'kill' && cur.ttl > 0.08 && kind !== 'kill') return;
    siege.value = {
      ...siege.value,
      hitMarker: { kind, ttl: kind === 'kill' ? 0.24 : 0.16 },
    };
  }

  private pushFeed(textKey: string, vars?: Record<string, string | number>): void {
    this.feedEntries.push({ id: this.feedId++, textKey, vars, ttl: 4.5 });
    if (this.feedEntries.length > 4) this.feedEntries.shift();
  }

  private activeFeedList(): SiegeSnapshot['killFeed'] {
    return this.feedEntries.map(({ id, textKey, vars }) => ({ id, textKey, vars }));
  }

  private buildBossHud(): BossHud | null {
    const boss = this.aliens.activeBoss();
    if (!boss) return null;
    return {
      nameKey: boss.nameKey,
      subtitleKey: `${boss.nameKey}.sub`,
      hp: Math.max(0, Math.ceil(boss.hp)),
      maxHp: Math.ceil(boss.maxHp),
      tier: this.bossTierByWave,
    };
  }

  private computeRadar(): RadarBlip[] {
    const { camera, player, rover, outpost } = this.deps;
    const ref = rover.driving ? rover.obj.position : player.feet;
    camera.getWorldDirection(this.camFwd);
    let fx = this.camFwd.x;
    let fz = this.camFwd.z;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const rx = -fz;
    const rz = fx;

    const blips: RadarBlip[] = [];
    const project = (tx: number, tz: number, clampEdge: boolean): { x: number; z: number } | null => {
      const dx = tx - ref.x;
      const dz = tz - ref.z;
      const fwdDist = dx * fx + dz * fz;
      const rightDist = dx * rx + dz * rz;
      let bx = rightDist / RADAR_RANGE;
      let bz = -fwdDist / RADAR_RANGE;
      const mag = Math.hypot(bx, bz);
      if (mag > 1) {
        if (!clampEdge) return null;
        bx = (bx / mag) * 0.94;
        bz = (bz / mag) * 0.94;
      }
      return { x: +bx.toFixed(3), z: +bz.toFixed(3) };
    };

    const addStation = (p: THREE.Vector3, kind: RadarBlip['kind']) => {
      const pt = project(p.x, p.z, true);
      if (pt) blips.push({ x: pt.x, z: pt.z, kind });
    };
    addStation(outpost.o2StationPos, 'o2');
    addStation(outpost.airlockPos, 'hab');
    addStation(outpost.power.terminalPos, 'power');
    if (!rover.driving) addStation(rover.obj.position, 'rover');

    for (const a of this.aliens.aliens) {
      if (a.state === 'dying') continue;
      const kind: RadarBlip['kind'] = a.isBoss
        ? 'boss'
        : a.kind === 'burrower'
          ? 'burrower'
          : a.isFlying
            ? 'flyer'
            : 'crawler';
      const pt = project(a.pos.x, a.pos.z, a.isBoss);
      if (pt) blips.push({ x: pt.x, z: pt.z, kind });
    }
    return blips;
  }

  private updateHudSnapshot(dt: number): void {
    const snap = siege.value;
    if (snap.phase === 'gameover') return;

    // Update feed TTLs
    let feedChanged = false;
    for (let i = this.feedEntries.length - 1; i >= 0; i--) {
      this.feedEntries[i].ttl -= dt;
      if (this.feedEntries[i].ttl <= 0) {
        this.feedEntries.splice(i, 1);
        feedChanged = true;
      }
    }

    const nextHit = snap.hitMarker ? (snap.hitMarker.ttl - dt > 0 ? { ...snap.hitMarker, ttl: snap.hitMarker.ttl - dt } : null) : null;
    const damageFlash = Math.max(0, snap.damageFlash - dt * 2.2);
    const enemiesLeft = snap.phase === 'fighting' ? this.spawnQueue.length + this.aliens.aliveCount() : 0;
    const boss = this.buildBossHud();

    this.radarAcc += dt;
    let radar = snap.radar;
    if (this.radarAcc >= 1 / 15) {
      this.radarAcc = 0;
      radar = this.computeRadar();
    }

    siege.value = {
      ...snap,
      timeSec: snap.timeSec + dt,
      enemiesLeft,
      roverTurret: this.deps.rover.driving,
      hitMarker: nextHit,
      damageFlash,
      boss,
      radar,
      killFeed: feedChanged ? this.activeFeedList() : snap.killFeed,
    };
  }

  /** Exposed on window.__qa.siege when ?qa=1 for automated verification & screenshots. */
  qaHelpers() {
    return {
      state: () => siege.value,
      stats: () => computeStats(siege.value.upgrades),
      aliens: () =>
        this.aliens.aliens.map((a) => ({
          id: a.id,
          kind: a.kind,
          isBoss: a.isBoss,
          isFlying: a.isFlying,
          state: a.state,
          hp: Math.round(a.hp),
          maxHp: Math.round(a.maxHp),
          x: +a.pos.x.toFixed(1),
          y: +a.pos.y.toFixed(1),
          z: +a.pos.z.toFixed(1),
        })),
      spawn: (kind: AlienKind, dist = 16) => {
        const { camera, player, rover } = this.deps;
        const ref = rover.driving ? rover.obj.position : player.feet;
        camera.getWorldDirection(this.camFwd);
        const fx = this.camFwd.x;
        const fz = this.camFwd.z;
        const len = Math.hypot(fx, fz) || 1;
        const x = ref.x + (fx / len) * dist;
        const z = ref.z + (fz / len) * dist;
        const a = this.aliens.spawn(kind, x, z, this.waveScale(), this.bossTierByWave);
        siege.value = {
          ...siege.value,
          waveTotal: siege.value.waveTotal + 1,
          enemiesLeft: this.spawnQueue.length + this.aliens.aliveCount(),
          boss: this.buildBossHud(),
        };
        return a.id;
      },
      spawnWave: (waveNum: number) => {
        this.aliens.clear();
        this.spawnQueue.length = 0;
        this.releaseGrab(false);
        this.startWave(waveNum);
      },
      selectWeapon: (index: number) => this.selectWeapon(index),
      fire: () => {
        this.fireCooldown = 0;
        this.fireWeapon(computeStats(siege.value.upgrades));
      },
      triggerGrab: () => {
        this.grabImmunity = 0;
        let target = this.aliens.aliens.find((a) => a.state !== 'dying') ?? null;
        if (!target) {
          const ref = this.deps.rover.driving ? this.deps.rover.obj.position : this.deps.player.feet;
          target = this.aliens.spawn('stalker', ref.x + 2, ref.z + 2, 1, 1);
        }
        this.tryStartGrab(target, computeStats(siege.value.upgrades), performance.now() / 1000, false);
        return siege.value.grab.active;
      },
      escapeTap: () => {
        const snap = siege.value;
        if (!snap.grab.active || !this.grabber) return;
        const taps = snap.grab.taps + 1;
        const stats = computeStats(snap.upgrades);
        sfx('shove');
        if (taps >= snap.grab.requiredTaps) {
          this.deps.camera.getWorldDirection(this.camFwd);
          const killed = this.aliens.shoveAway(this.grabber, this.camFwd, 28 * stats.breakFreeMul, 1.8);
          sfx('breakfree');
          this.releaseGrab(true);
          if (killed) this.handleAlienKilled(this.grabber!, stats);
        } else {
          siege.value = { ...snap, grab: { ...snap.grab, taps, lastTapAt: performance.now() / 1000 } };
        }
      },
      clearWave: () => {
        this.spawnQueue.length = 0;
        this.releaseGrab(false);
        this.aliens.clear();
        this.completeWave();
      },
      pickUpgrade: (id?: string) => {
        const pick = id ?? siege.value.upgradeChoices[0];
        if (pick) this.pickUpgrade(pick);
      },
      recharge: (kind: 'o2' | 'power' | 'hab-suit' | 'hab-med') => this.rechargeStation(kind),
      setSuit: (patch: Partial<{ o2: number; power: number; health: number }>) => {
        suit.value = { ...suit.value, ...patch };
      },
      triggerGameOver: () => this.triggerGameOver(),
    };
  }
}
