// Lunar Defense / Siege Mode shared state, balance constants, weapons and upgrade definitions.

import { signal } from '@preact/signals';

export type WeaponId = 'carbine' | 'shotgun' | 'railgun' | 'plasma';

export interface WeaponDef {
  id: WeaponId;
  key: string;
  nameKey: string;
  descKey: string;
  color: number;
  damage: number;
  fireRate: number;
  magSize: number;
  reloadSec: number;
  pellets: number;
  spread: number;
  range: number;
  knockback: number;
  powerCost: number;
  splashRadius?: number;
  pierce?: boolean;
  slowSec?: number;
  auto: boolean;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'carbine',
    key: '1',
    nameKey: 'sg.w.carbine',
    descKey: 'sg.w.carbine.desc',
    color: 0x5fd4ff,
    damage: 24,
    fireRate: 7.5,
    magSize: 30,
    reloadSec: 1.45,
    pellets: 1,
    spread: 0.018,
    range: 140,
    knockback: 2.5,
    powerCost: 0.06,
    auto: true,
  },
  {
    id: 'shotgun',
    key: '2',
    nameKey: 'sg.w.shotgun',
    descKey: 'sg.w.shotgun.desc',
    color: 0xffb547,
    damage: 16,
    fireRate: 1.45,
    magSize: 8,
    reloadSec: 1.85,
    pellets: 8,
    spread: 0.085,
    range: 55,
    knockback: 11,
    powerCost: 0.12,
    auto: false,
  },
  {
    id: 'railgun',
    key: '3',
    nameKey: 'sg.w.railgun',
    descKey: 'sg.w.railgun.desc',
    color: 0x9cf0ff,
    damage: 95,
    fireRate: 0.85,
    magSize: 6,
    reloadSec: 2.0,
    pellets: 1,
    spread: 0.002,
    range: 220,
    knockback: 14,
    powerCost: 0.45,
    pierce: true,
    auto: false,
  },
  {
    id: 'plasma',
    key: '4',
    nameKey: 'sg.w.plasma',
    descKey: 'sg.w.plasma.desc',
    color: 0xd66bff,
    damage: 58,
    fireRate: 1.7,
    magSize: 12,
    reloadSec: 1.9,
    pellets: 1,
    spread: 0.012,
    range: 120,
    knockback: 9,
    powerCost: 0.25,
    splashRadius: 5.2,
    slowSec: 2.6,
    auto: true,
  },
];

export type UpgradeRarity = 'common' | 'rare' | 'epic';

export interface UpgradeDef {
  id: string;
  icon: string;
  rarity: UpgradeRarity;
  titleKey: string;
  descKey: string;
  maxStacks: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'dmg', icon: '⚔️', rarity: 'common', titleKey: 'sg.up.dmg', descKey: 'sg.up.dmg.desc', maxStacks: 6 },
  { id: 'firerate', icon: '⚡', rarity: 'common', titleKey: 'sg.up.firerate', descKey: 'sg.up.firerate.desc', maxStacks: 5 },
  { id: 'mag', icon: '🔋', rarity: 'common', titleKey: 'sg.up.mag', descKey: 'sg.up.mag.desc', maxStacks: 5 },
  { id: 'multishot', icon: '✨', rarity: 'epic', titleKey: 'sg.up.multishot', descKey: 'sg.up.multishot.desc', maxStacks: 3 },
  { id: 'cryo', icon: '❄️', rarity: 'rare', titleKey: 'sg.up.cryo', descKey: 'sg.up.cryo.desc', maxStacks: 4 },
  { id: 'vamp', icon: '🩸', rarity: 'epic', titleKey: 'sg.up.vamp', descKey: 'sg.up.vamp.desc', maxStacks: 3 },
  { id: 'o2tank', icon: '🫧', rarity: 'common', titleKey: 'sg.up.o2tank', descKey: 'sg.up.o2tank.desc', maxStacks: 5 },
  { id: 'battery', icon: '⚡', rarity: 'common', titleKey: 'sg.up.battery', descKey: 'sg.up.battery.desc', maxStacks: 5 },
  { id: 'exoservo', icon: '🦾', rarity: 'rare', titleKey: 'sg.up.exoservo', descKey: 'sg.up.exoservo.desc', maxStacks: 4 },
  { id: 'rover', icon: '🏎️', rarity: 'rare', titleKey: 'sg.up.rover', descKey: 'sg.up.rover.desc', maxStacks: 4 },
  { id: 'crit', icon: '🎯', rarity: 'rare', titleKey: 'sg.up.crit', descKey: 'sg.up.crit.desc', maxStacks: 5 },
  { id: 'medsurge', icon: '💉', rarity: 'common', titleKey: 'sg.up.medsurge', descKey: 'sg.up.medsurge.desc', maxStacks: 99 },
];

export interface RadarBlip {
  x: number;
  z: number;
  kind: 'crawler' | 'burrower' | 'flyer' | 'boss' | 'o2' | 'hab' | 'power' | 'rover';
}

export interface GrabState {
  active: boolean;
  alienNameKey: string;
  taps: number;
  requiredTaps: number;
  biteTimer: number;
  biteDuration: number;
  lastTapAt: number;
}

export interface BossHud {
  nameKey: string;
  subtitleKey: string;
  hp: number;
  maxHp: number;
  tier: number;
}

export interface SiegeSnapshot {
  wave: number;
  phase: 'intermission' | 'fighting' | 'upgrade' | 'gameover';
  intermission: number;
  enemiesLeft: number;
  waveTotal: number;
  kills: number;
  bossesKilled: number;
  score: number;
  timeSec: number;
  bestWave: number;
  bestScore: number;
  newRecord: boolean;
  weaponIndex: number;
  ammo: number[];
  maxAmmo: number[];
  reloading: number;
  roverTurret: boolean;
  grab: GrabState;
  boss: BossHud | null;
  upgradeChoices: string[];
  upgrades: Record<string, number>;
  hitMarker: { kind: 'hit' | 'crit' | 'kill'; ttl: number } | null;
  damageFlash: number;
  killFeed: { id: number; textKey: string; vars?: Record<string, string | number> }[];
  radar: RadarBlip[];
  stationAlert: null | 'o2' | 'power' | 'health';
  maxHealth: number;
  o2Leak: number;
}

const STORAGE_KEY = 'ja-siege-best-v1';

export function createInitialSiege(): SiegeSnapshot {
  let bestWave = 1;
  let bestScore = 0;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.bestWave === 'number') bestWave = parsed.bestWave;
      if (typeof parsed.bestScore === 'number') bestScore = parsed.bestScore;
    }
  } catch {
    // safely ignore corrupted storage
  }

  return {
    wave: 1,
    phase: 'intermission',
    intermission: 10,
    enemiesLeft: 0,
    waveTotal: 0,
    kills: 0,
    bossesKilled: 0,
    score: 0,
    timeSec: 0,
    bestWave,
    bestScore,
    newRecord: false,
    weaponIndex: 0,
    ammo: WEAPONS.map((w) => w.magSize),
    maxAmmo: WEAPONS.map((w) => w.magSize),
    reloading: 0,
    roverTurret: false,
    grab: {
      active: false,
      alienNameKey: '',
      taps: 0,
      requiredTaps: 5,
      biteTimer: 0,
      biteDuration: 1.5,
      lastTapAt: 0,
    },
    boss: null,
    upgradeChoices: [],
    upgrades: {},
    hitMarker: null,
    damageFlash: 0,
    killFeed: [],
    radar: [],
    stationAlert: null,
    maxHealth: 100,
    o2Leak: 0,
  };
}

export const siege = signal<SiegeSnapshot>(createInitialSiege());

export function resetSiegeState(): void {
  siege.value = createInitialSiege();
}

export function saveSiegeRecord(wave: number, score: number): boolean {
  let isNew = false;
  let curBestWave = siege.value.bestWave;
  let curBestScore = siege.value.bestScore;

  if (wave > curBestWave) {
    curBestWave = wave;
    isNew = true;
  }
  if (score > curBestScore) {
    curBestScore = score;
    isNew = true;
  }

  if (isNew) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ bestWave: curBestWave, bestScore: curBestScore }));
      }
    } catch {
      // ignore
    }
    siege.value = {
      ...siege.value,
      bestWave: curBestWave,
      bestScore: curBestScore,
      newRecord: true,
    };
  }
  return isNew;
}

export interface ComputedStats {
  damageMul: number;
  fireRateMul: number;
  magMul: number;
  reloadMul: number;
  extraProjectiles: number;
  cryoSlow: number;
  cryoSplashDmg: number;
  vampHp: number;
  vampO2: number;
  o2DrainMul: number;
  powerDrainMul: number;
  maxHealth: number;
  hpRegen: number;
  moveSpeedMul: number;
  breakFreeMul: number;
  shoveDmg: number;
  roverSpeedMul: number;
  roverRamMul: number;
  roverFireMul: number;
  roverShield: number;
  critChance: number;
  critMul: number;
}

export function computeStats(upgrades: Record<string, number>): ComputedStats {
  const get = (id: string) => upgrades[id] ?? 0;
  const dmg = get('dmg');
  const firerate = get('firerate');
  const mag = get('mag');
  const multishot = get('multishot');
  const cryo = get('cryo');
  const vamp = get('vamp');
  const o2tank = get('o2tank');
  const battery = get('battery');
  const exoservo = get('exoservo');
  const rover = get('rover');
  const crit = get('crit');
  const medsurge = get('medsurge');

  return {
    damageMul: 1 + dmg * 0.30 + medsurge * 0.15,
    fireRateMul: 1 + firerate * 0.25,
    magMul: 1 + mag * 0.45,
    reloadMul: 1 + mag * 0.35 + firerate * 0.15,
    extraProjectiles: multishot,
    cryoSlow: cryo > 0 ? 1.8 + cryo * 1.2 : 0,
    cryoSplashDmg: cryo * 22,
    vampHp: vamp * 10,
    vampO2: vamp * 6,
    o2DrainMul: Math.pow(0.68, o2tank),
    powerDrainMul: Math.pow(0.62, battery),
    maxHealth: 100 + battery * 35 + medsurge * 20,
    hpRegen: battery * 1.8,
    moveSpeedMul: 1 + exoservo * 0.20,
    breakFreeMul: 1 + exoservo * 0.55,
    shoveDmg: 30 + exoservo * 55,
    roverSpeedMul: 1 + rover * 0.30,
    roverRamMul: 1 + rover * 1.0,
    roverFireMul: 1 + rover * 0.35,
    roverShield: Math.min(0.75, rover * 0.35),
    critChance: Math.min(0.95, 0.10 + crit * 0.30),
    critMul: 2.0 + crit * 0.35,
  };
}

export function upgradeEffectTag(id: string, stacks = 1): string {
  const s = Math.max(1, stacks);
  switch (id) {
    case 'dmg':
      return `+${s * 30}% DMG`;
    case 'firerate':
      return `+${s * 25}% RPM`;
    case 'mag':
      return `+${s * 45}% Mag · +${s * 35}% Reload`;
    case 'multishot':
      return `+${s} Projectiles`;
    case 'cryo':
      return `Frost Splash +${s * 22} AoE`;
    case 'vamp':
      return `+${s * 10} HP & +${s * 6}% O₂ / Kill`;
    case 'o2tank':
      return `-${Math.round((1 - Math.pow(0.68, s)) * 100)}% O₂ Drain · +75 O₂`;
    case 'battery':
      return `+${s * 35} HP · +${(s * 1.8).toFixed(1)} HP/s Regen`;
    case 'exoservo':
      return `+${s * 20}% Speed · ${30 + s * 55} Shove`;
    case 'rover':
      return `+${s * 30}% Speed · +${s * 100}% Ram`;
    case 'crit':
      return `${Math.min(95, 10 + s * 30)}% Crit (${(2.0 + s * 0.35).toFixed(1)}x)`;
    case 'medsurge':
      return `Full Restore · +${s * 20} HP · +${s * 15}% DMG`;
    default:
      return '';
  }
}
