/**
 * Procedural Web Audio engine & character voice manager for Lunar Siege mode.
 * Zero external audio assets needed for dynamic SFX & combat intensity synth music.
 * Helmet intercom processing for character voice lines (distinct from NASA Quindar radio).
 */

import { effect } from '@preact/signals';
import { settings } from '../engine/settings';
import { pushComm } from '../game/state';
import { playVoice } from './audio';

export type SiegeSfx =
  | 'dry_fire'
  | 'weapon_switch'
  | 'shell_bounce'
  | 'rail_charge'
  | 'cryo_freeze'
  | 'alien_chitter'
  | 'alien_screech'
  | 'wing_flap'
  | 'boss_stomp'
  | 'boss_shockwave'
  | 'rover_rev'
  | 'roadkill'
  | 'heartbeat'
  | 'upgrade_pick'
  | 'shield_break'
  | 'acid_spit'
  | 'acid_hit'
  | 'intermission_tick';

export type PlayerQuipCategory =
  | 'start'
  | 'kill'
  | 'burrow'
  | 'flyer'
  | 'grab'
  | 'escape'
  | 'low_o2'
  | 'low_pwr'
  | 'refill'
  | 'rover_in'
  | 'roadkill'
  | 'boss'
  | 'boss_kill'
  | 'reload'
  | 'upgrade'
  | 'hurt'
  | 'clear';

export const VOICE_SUBTITLES_EN: Record<string, string> = {
  // Player Character Lines
  'vo.pl_start_1': 'More ugly bugs on the radar? Great. Exactly how I wanted to spend my unpaid lunar overtime.',
  'vo.pl_start_2': "Come on out, you creepy crawlers! I have got a full mag with your names on it!",
  'vo.pl_start_3': "Another swarm? Don't you freaks have anything better to do on a Tuesday?",
  'vo.pl_kill_1': 'Eat lunar dust, you slimy little freak!',
  'vo.pl_kill_2': 'Stay down, idiot!',
  'vo.pl_kill_3': 'How is that taste, ugly?',
  'vo.pl_kill_4': 'One less cockroach in my crater!',
  'vo.pl_kill_5': 'Scratch one ugly bug! Who is next?',
  'vo.pl_burrow_1': 'Ugh, crawling out of the dirt like worms? Disgusting!',
  'vo.pl_burrow_2': 'Surprise surprise, the dirt has teeth. Get back underground, dirtbag!',
  'vo.pl_flyer_1': 'Great, now the bugs have wings! Stop buzzing in my face!',
  'vo.pl_flyer_2': 'Pest control incoming! Pull up, mosquito breath!',
  'vo.pl_grab_1': 'Get your nasty claws off my face, you disgusting freak!',
  'vo.pl_grab_2': 'Hands off the suit, dumbass! Let go!',
  'vo.pl_grab_3': 'Personal space, ugly! Get off me!',
  'vo.pl_escape_1': 'Back off! Eat boot, loser!',
  'vo.pl_escape_2': 'Get off me, you piece of space junk!',
  'vo.pl_low_o2': 'Suit alarm! I am choking on lunar air here! Where is the tank?',
  'vo.pl_low_pwr': 'Battery critical? Of course the cheap government battery is dying now!',
  'vo.pl_refill_1': 'Ah, sweet sweet oxygen. Back in business, you creeps!',
  'vo.pl_refill_2': 'Tanks full, shields humming. Ready for round two, losers!',
  'vo.pl_rover_in': "Lock and load, baby! Let's see how you bugs like two tons of lunar steel!",
  'vo.pl_roadkill_1': 'Beep beep, idiot! Get out of the road!',
  'vo.pl_roadkill_2': 'Speed bump! That is another bug on my windshield!',
  'vo.pl_boss_1': 'What in the cosmos is that giant monstrosity?! Who fed the cockroach radioactive garbage?!',
  'vo.pl_boss_2': 'Look at the size of this ugly brute! You are going down, Goliath!',
  'vo.pl_boss_kill_1': 'Timber! The bigger they are, the harder they splat! Suck on that, you overgrown freak!',
  'vo.pl_boss_kill_2': 'And stay dead, giant! Nobody messes with my moon base!',
  'vo.pl_reload': 'Swapping mags! Hold your horses, bugs!',
  'vo.pl_upgrade': 'Now we are talking! Look at this firepower, babies!',
  'vo.pl_hurt_1': 'Ow! Suit integrity hit! That was expensive, you jerk!',
  'vo.pl_hurt_2': 'Agh! That actually stung! You are gonna pay for that!',
  'vo.pl_clear': 'Wave wiped! That all you got, crater creeps? I am just getting warmed up!',

  // Mission Control & Commander Siege Lines
  'vo.sg_mc_start': 'Mission Control to Survivor. Multiple subterranean bio-signatures detected converging on the outpost. Defend the perimeter!',
  'vo.sg_mc_boss': 'Commander Ortiz here! Massive seismic tremor detected! High-threat alpha predator on approach! Concentrate all fire on that beast!',
  'vo.sg_mc_o2': 'Mission Control warning! Suit life support reserves are in the red! Get to the oxygen station immediately!',
  'vo.sg_mc_upgrade': 'Mission Control: Outpost fabricator has authorized a tactical tech requisition. Select your battlefield upgrade.',
  'vo.sg_mc_rover': 'Commander Ortiz to Survivor. Rover combat authorization is green! Mount up and clear those swarms!',
  'vo.sg_mc_death': 'Mission Control: Outpost vitals flatlined. Life support lost. We are sending an emergency recovery team. Rest easy, astronaut.',

  // Intro Cutscene Subtitles
  'vo.cs_siege_1': 'Outpost Alpha, day thirty-one. The lunar south pole has gone dead quiet. But beneath the frost, something ancient is stirring.',
  'vo.cs_siege_2': 'Seismic tremors across the crater floor. Deep fissures opening in the regolith. They are not rocks. They are waking up.',
  'vo.cs_siege_3': 'Life support and the rover are still operational, but the perimeter fence has collapsed. There is nowhere left to run.',
  'vo.cs_siege_4': 'One astronaut. Four weapons. Infinite waves of lunar horrors. Defend the outpost, or be buried in the dust.',
};

const CHARACTER_LINES: Record<PlayerQuipCategory, readonly string[]> = {
  start: ['pl_start_1', 'pl_start_2', 'pl_start_3'],
  kill: ['pl_kill_1', 'pl_kill_2', 'pl_kill_3', 'pl_kill_4', 'pl_kill_5'],
  burrow: ['pl_burrow_1', 'pl_burrow_2'],
  flyer: ['pl_flyer_1', 'pl_flyer_2'],
  grab: ['pl_grab_1', 'pl_grab_2', 'pl_grab_3'],
  escape: ['pl_escape_1', 'pl_escape_2'],
  low_o2: ['pl_low_o2'],
  low_pwr: ['pl_low_pwr'],
  refill: ['pl_refill_1', 'pl_refill_2'],
  rover_in: ['pl_rover_in'],
  roadkill: ['pl_roadkill_1', 'pl_roadkill_2'],
  boss: ['pl_boss_1', 'pl_boss_2'],
  boss_kill: ['pl_boss_kill_1', 'pl_boss_kill_2'],
  reload: ['pl_reload'],
  upgrade: ['pl_upgrade'],
  hurt: ['pl_hurt_1', 'pl_hurt_2'],
  clear: ['pl_clear'],
};

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicMasterGain: GainNode | null = null;
let waveMusicGain: GainNode | null = null;
let bossMusicGain: GainNode | null = null;
let helmetIntercomBus: GainNode | null = null;

let currentQuipSource: AudioBufferSourceNode | null = null;
let lastQuipTime = 0;
const lastPlayedPerCat = new Map<PlayerQuipCategory, string>();
const voBufferCache = new Map<string, Promise<AudioBuffer>>();

// Procedural music state
let currentIntensity: 0 | 1 | 2 = 0;
let musicInterval: number | null = null;
let stepCounter = 0;
let nextNoteTime = 0;

// Shared noise buffer for SFX
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== c.sampleRate) {
    const len = c.sampleRate * 2;
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

function ensureAudio(): AudioContext | null {
  if (!ctx || ctx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();

    masterGain = ctx.createGain();
    masterGain.gain.value = settings.value.volume;
    masterGain.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(masterGain);

    // Music routing
    musicMasterGain = ctx.createGain();
    musicMasterGain.gain.value = 1.0;
    musicMasterGain.connect(masterGain);

    waveMusicGain = ctx.createGain();
    waveMusicGain.gain.value = 0.0;
    waveMusicGain.connect(musicMasterGain);

    bossMusicGain = ctx.createGain();
    bossMusicGain.gain.value = 0.0;
    bossMusicGain.connect(musicMasterGain);

    // Helmet intercom chain for Player Character VO
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    hp.Q.value = 0.7;

    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 2800;
    peak.gain.value = 4.5;
    peak.Q.value = 1.2;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7200;
    lp.Q.value = 0.7;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

    const helmetOut = ctx.createGain();
    helmetOut.gain.value = 1.15;

    helmetIntercomBus = ctx.createGain();
    helmetIntercomBus.connect(hp);
    hp.connect(peak);
    peak.connect(lp);
    lp.connect(comp);
    comp.connect(helmetOut);
    helmetOut.connect(masterGain);
  }

  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  return ctx;
}

// Track settings volume changes reactively
effect(() => {
  const vol = settings.value.volume;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
  }
});

/**
 * Initializes and resumes Siege Audio Context.
 */
export function startSiegeAudio(): void {
  const c = ensureAudio();
  if (c && c.state === 'suspended') {
    void c.resume();
  }
}

/**
 * Cleanly stops Siege audio and procedural intensity synth loops.
 */
export function stopSiegeAudio(): void {
  setSiegeIntensity(0);
  if (currentQuipSource) {
    try {
      currentQuipSource.stop();
    } catch {
      // already stopped
    }
    currentQuipSource = null;
  }
}

// --- Procedural Dark Sci-Fi Music Engine ---

const BASS_PULSE = [
  73.42, 73.42, 87.31, 73.42,
  110.0, 73.42, 130.81, 110.0,
  73.42, 73.42, 98.0, 73.42,
  87.31, 73.42, 82.41, 65.41,
];

function scheduleMusicStep(c: AudioContext, time: number, step: number): void {
  if (!waveMusicGain || !bossMusicGain) return;

  // Level 1: Wave combat pulsing arpeggio bass
  if (currentIntensity >= 1) {
    const freq = BASS_PULSE[step % BASS_PULSE.length];
    const osc = c.createOscillator();
    osc.type = step % 4 === 0 ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = step % 4 === 0 ? 550 : 380;
    filter.frequency.setValueAtTime(cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(140, time + 0.14);

    const g = c.createGain();
    const gainVal = step % 4 === 0 ? 0.35 : 0.22;
    g.gain.setValueAtTime(gainVal, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    osc.connect(filter).connect(g).connect(waveMusicGain);
    osc.start(time);
    osc.stop(time + 0.18);

    // Background sub-drone on 1st beat of bar
    if (step % 16 === 0) {
      const drone = c.createOscillator();
      drone.type = 'sawtooth';
      drone.frequency.setValueAtTime(36.71, time); // D1

      const droneF = c.createBiquadFilter();
      droneF.type = 'lowpass';
      droneF.frequency.setValueAtTime(160, time);
      droneF.frequency.linearRampToValueAtTime(260, time + 1.2);
      droneF.frequency.linearRampToValueAtTime(160, time + 2.4);

      const droneG = c.createGain();
      droneG.gain.setValueAtTime(0.28, time);
      droneG.gain.exponentialRampToValueAtTime(0.001, time + 2.4);

      drone.connect(droneF).connect(droneG).connect(waveMusicGain);
      drone.start(time);
      drone.stop(time + 2.5);
    }
  }

  // Level 2: Boss battle aggressive driving rhythm & acid aggression
  if (currentIntensity === 2) {
    // Pounding kick drum on quarters
    if (step % 4 === 0) {
      const kick = c.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(130, time);
      kick.frequency.exponentialRampToValueAtTime(36, time + 0.15);

      const kickG = c.createGain();
      kickG.gain.setValueAtTime(0.65, time);
      kickG.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

      kick.connect(kickG).connect(bossMusicGain);
      kick.start(time);
      kick.stop(time + 0.22);
    }

    // Industrial metallic hat on offbeats
    if (step % 2 === 1) {
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(6500, time);

      const hg = c.createGain();
      hg.gain.setValueAtTime(0.12, time);
      hg.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

      src.connect(hp).connect(hg).connect(bossMusicGain);
      src.start(time);
      src.stop(time + 0.06);
    }

    // Aggressive syncopated synth sting
    if (step % 8 === 2 || step % 8 === 6) {
      const lead = c.createOscillator();
      lead.type = 'sawtooth';
      const leadFreq = step % 8 === 2 ? 293.66 : 329.63; // D4 or E4
      lead.frequency.setValueAtTime(leadFreq, time);

      const lf = c.createBiquadFilter();
      lf.type = 'lowpass';
      lf.frequency.setValueAtTime(1800, time);
      lf.Q.value = 6;
      lf.frequency.exponentialRampToValueAtTime(320, time + 0.14);

      const lg = c.createGain();
      lg.gain.setValueAtTime(0.24, time);
      lg.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

      lead.connect(lf).connect(lg).connect(bossMusicGain);
      lead.start(time);
      lead.stop(time + 0.16);
    }
  }
}

function tickMusic(): void {
  const c = ensureAudio();
  if (!c || currentIntensity === 0) return;

  const stepDuration = 0.125; // 120 BPM 16th notes
  const lookahead = 0.25;

  while (nextNoteTime < c.currentTime + lookahead) {
    scheduleMusicStep(c, nextNoteTime, stepCounter);
    stepCounter++;
    nextNoteTime += stepDuration;
  }
}

/**
 * Sets combat music intensity level:
 * 0 = off, 1 = wave combat pulse, 2 = boss battle pounding aggression.
 */
export function setSiegeIntensity(level: 0 | 1 | 2): void {
  const c = ensureAudio();
  if (!c) return;

  currentIntensity = level;

  if (level > 0 && musicInterval === null) {
    nextNoteTime = c.currentTime + 0.05;
    stepCounter = 0;
    musicInterval = window.setInterval(tickMusic, 50);
  } else if (level === 0 && musicInterval !== null) {
    window.clearInterval(musicInterval);
    musicInterval = null;
  }

  // Smooth gain transitions without clicks
  if (waveMusicGain && bossMusicGain) {
    const now = c.currentTime;
    if (level === 0) {
      waveMusicGain.gain.setTargetAtTime(0, now, 0.35);
      bossMusicGain.gain.setTargetAtTime(0, now, 0.35);
    } else if (level === 1) {
      waveMusicGain.gain.setTargetAtTime(0.18, now, 0.35);
      bossMusicGain.gain.setTargetAtTime(0, now, 0.35);
    } else if (level === 2) {
      waveMusicGain.gain.setTargetAtTime(0.12, now, 0.35);
      bossMusicGain.gain.setTargetAtTime(0.26, now, 0.35);
    }
  }
}

// --- Rich Web Audio Sound Effects ---

export function siegeSfx(name: SiegeSfx, strength = 1): void {
  const c = ensureAudio();
  if (!c || !sfxGain) return;
  const now = c.currentTime;
  const gain = Math.max(0.1, Math.min(2.5, strength));

  switch (name) {
    case 'dry_fire': {
      // Crisp metallic empty click + dull thud
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1900, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

      const g = c.createGain();
      g.gain.setValueAtTime(0.18 * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(g).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.045);
      break;
    }

    case 'weapon_switch': {
      // Mechanical slide, click & cocking lock
      const click1 = c.createOscillator();
      click1.type = 'sawtooth';
      click1.frequency.setValueAtTime(1400, now);
      click1.frequency.exponentialRampToValueAtTime(450, now + 0.025);

      const g1 = c.createGain();
      g1.gain.setValueAtTime(0.12 * gain, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      click1.connect(g1).connect(sfxGain);
      click1.start(now);
      click1.stop(now + 0.035);

      const click2 = c.createOscillator();
      click2.type = 'triangle';
      click2.frequency.setValueAtTime(2200, now + 0.04);
      click2.frequency.exponentialRampToValueAtTime(800, now + 0.08);

      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.14 * gain, now + 0.04);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      click2.connect(g2).connect(sfxGain);
      click2.start(now + 0.04);
      click2.stop(now + 0.095);
      break;
    }

    case 'shell_bounce': {
      // High brass shell casing ping and ricochet rattle
      const bell = c.createOscillator();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(3200, now);

      const bg = c.createGain();
      bg.gain.setValueAtTime(0.08 * gain, now);
      bg.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      bell.connect(bg).connect(sfxGain);
      bell.start(now);
      bell.stop(now + 0.065);

      const bounce = c.createOscillator();
      bounce.type = 'sine';
      bounce.frequency.setValueAtTime(2700, now + 0.055);

      const b2g = c.createGain();
      b2g.gain.setValueAtTime(0.05 * gain, now + 0.055);
      b2g.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

      bounce.connect(b2g).connect(sfxGain);
      bounce.start(now + 0.055);
      bounce.stop(now + 0.1);
      break;
    }

    case 'rail_charge': {
      // Rising high-voltage magnetic capacitor charge
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(2600, now + 0.38);

      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3.5;
      filter.frequency.setValueAtTime(280, now);
      filter.frequency.exponentialRampToValueAtTime(2800, now + 0.38);

      const g = c.createGain();
      g.gain.setValueAtTime(0.02 * gain, now);
      g.gain.linearRampToValueAtTime(0.16 * gain, now + 0.34);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(filter).connect(g).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.42);
      break;
    }

    case 'cryo_freeze': {
      // Glassy frost burst + freezing shatter
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(3200, now);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.16 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      src.connect(hp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.3);

      // Ice crystal resonance
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2400, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.22);

      const og = c.createGain();
      og.gain.setValueAtTime(0.12 * gain, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(og).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.26);
      break;
    }

    case 'alien_chitter': {
      // Rapid insectoid mandible clicks
      const clicks = 4;
      for (let i = 0; i < clicks; i++) {
        const t = now + i * 0.025;
        const osc = c.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2800 + Math.random() * 800, t);
        osc.frequency.exponentialRampToValueAtTime(700, t + 0.015);

        const g = c.createGain();
        g.gain.setValueAtTime(0.12 * gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.018);

        osc.connect(g).connect(sfxGain);
        osc.start(t);
        osc.stop(t + 0.02);
      }
      break;
    }

    case 'alien_screech': {
      // Piercing hostile alien scream
      const osc1 = c.createOscillator();
      const osc2 = c.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'square';

      osc1.frequency.setValueAtTime(940, now);
      osc1.frequency.exponentialRampToValueAtTime(420, now + 0.32);
      osc2.frequency.setValueAtTime(975, now);
      osc2.frequency.exponentialRampToValueAtTime(440, now + 0.32);

      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.Q.value = 2.0;

      const g = c.createGain();
      g.gain.setValueAtTime(0.16 * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(g).connect(sfxGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.36);
      osc2.stop(now + 0.36);
      break;
    }

    case 'wing_flap': {
      // Leathery wing flutter whoosh
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(320, now);
      lp.frequency.exponentialRampToValueAtTime(120, now + 0.16);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.18 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      src.connect(lp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.2);

      // Low air displacement thrum
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(80, now);
      sub.frequency.exponentialRampToValueAtTime(40, now + 0.14);

      const sg = c.createGain();
      sg.gain.setValueAtTime(0.15 * gain, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      sub.connect(sg).connect(sfxGain);
      sub.start(now);
      sub.stop(now + 0.16);
      break;
    }

    case 'boss_stomp': {
      // Sub-bass tectonic footfall impact
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(95, now);
      sub.frequency.exponentialRampToValueAtTime(26, now + 0.45);

      const sg = c.createGain();
      sg.gain.setValueAtTime(0.42 * gain, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

      sub.connect(sg).connect(sfxGain);
      sub.start(now);
      sub.stop(now + 0.5);

      // Regolith crunch
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(260, now);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.24 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      src.connect(lp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.34);
      break;
    }

    case 'boss_shockwave': {
      // Expansive radiating seismic rumble
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(54, now);
      osc.frequency.linearRampToValueAtTime(32, now + 0.7);

      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, now);
      filter.frequency.linearRampToValueAtTime(45, now + 0.7);

      const g = c.createGain();
      g.gain.setValueAtTime(0.3 * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

      osc.connect(filter).connect(g).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.8);
      break;
    }

    case 'rover_rev': {
      // High-torque electric motor whine
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.38);

      const g = c.createGain();
      g.gain.setValueAtTime(0.16 * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc.connect(g).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.44);
      break;
    }

    case 'roadkill': {
      // Crunchy biological collision & vehicular impact
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, now);
      sub.frequency.exponentialRampToValueAtTime(32, now + 0.22);

      const sg = c.createGain();
      sg.gain.setValueAtTime(0.35 * gain, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      sub.connect(sg).connect(sfxGain);
      sub.start(now);
      sub.stop(now + 0.25);

      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const lp = c.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.setValueAtTime(580, now);
      lp.frequency.exponentialRampToValueAtTime(180, now + 0.2);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.28 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      src.connect(lp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.24);
      break;
    }

    case 'heartbeat': {
      // Visceral low lub-dub thump
      const sub1 = c.createOscillator();
      sub1.type = 'sine';
      sub1.frequency.setValueAtTime(52, now);
      sub1.frequency.exponentialRampToValueAtTime(36, now + 0.11);

      const g1 = c.createGain();
      g1.gain.setValueAtTime(0.28 * gain, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      sub1.connect(g1).connect(sfxGain);
      sub1.start(now);
      sub1.stop(now + 0.13);

      const sub2 = c.createOscillator();
      sub2.type = 'sine';
      sub2.frequency.setValueAtTime(46, now + 0.14);
      sub2.frequency.exponentialRampToValueAtTime(32, now + 0.24);

      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.2 * gain, now + 0.14);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      sub2.connect(g2).connect(sfxGain);
      sub2.start(now + 0.14);
      sub2.stop(now + 0.26);
      break;
    }

    case 'upgrade_pick': {
      // Uplifting holographic chime arpeggio
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.055;
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        const g = c.createGain();
        g.gain.setValueAtTime(0.14 * gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

        osc.connect(g).connect(sfxGain!);
        osc.start(t);
        osc.stop(t + 0.3);
      });
      break;
    }

    case 'shield_break': {
      // Electric discharge crackle + pop
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(3500, now);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.2 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      src.connect(hp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.18);

      const sweep = c.createOscillator();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(2600, now);
      sweep.frequency.exponentialRampToValueAtTime(140, now + 0.14);

      const sg = c.createGain();
      sg.gain.setValueAtTime(0.18 * gain, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      sweep.connect(sg).connect(sfxGain);
      sweep.start(now);
      sweep.stop(now + 0.16);
      break;
    }

    case 'acid_spit': {
      // Caustic bio-projectile hiss
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3.0;
      bp.frequency.setValueAtTime(1600, now);
      bp.frequency.exponentialRampToValueAtTime(450, now + 0.18);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.18 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      src.connect(bp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.22);
      break;
    }

    case 'acid_hit': {
      // Corrosive suit sizzle & bubbling
      const noise = getNoiseBuffer(c);
      const src = c.createBufferSource();
      src.buffer = noise;

      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(2200, now);

      const ng = c.createGain();
      ng.gain.setValueAtTime(0.15 * gain, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      src.connect(hp).connect(ng).connect(sfxGain);
      src.start(now);
      src.stop(now + 0.38);
      break;
    }

    case 'intermission_tick': {
      // Tactical countdown beep
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, now);

      const g = c.createGain();
      g.gain.setValueAtTime(0.12 * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(g).connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.045);
      break;
    }
  }
}

// --- Voice Lines & Subtitles ---

async function loadVoBuffer(c: AudioContext, id: string): Promise<AudioBuffer> {
  let p = voBufferCache.get(id);
  if (!p) {
    p = fetch(`./assets/audio/vo/${id}.mp3`)
      .then((r) => {
        if (!r.ok) throw new Error(`VO fetch ${id} returned ${r.status}`);
        return r.arrayBuffer();
      })
      .then((ab) => c.decodeAudioData(ab));
    voBufferCache.set(id, p);
  }
  return p;
}

/**
 * Plays a Player Character voice line (`pl_*`) with helmet-intercom filtering and subtitle.
 * Smart cooldown is ~3.2s normal, 0s if `force` (grab/escape/boss).
 */
export function playCharacterLine(cat: PlayerQuipCategory, force = false): void {
  const pool = CHARACTER_LINES[cat];
  if (!pool || pool.length === 0) return;

  const now = performance.now();
  if (!force && now - lastQuipTime < 3200) {
    return;
  }

  // Non-repeating selection
  let id = pool[0];
  if (pool.length > 1) {
    const last = lastPlayedPerCat.get(cat);
    const candidates = pool.filter((k) => k !== last);
    id = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
  }
  lastPlayedPerCat.set(cat, id);
  lastQuipTime = now;

  // Push comm subtitle
  pushComm('sg.you', 'vo.' + id);

  const c = ensureAudio();
  if (!c || !helmetIntercomBus) return;

  void (async () => {
    try {
      const buffer = await loadVoBuffer(c, id);
      if (!helmetIntercomBus) return;

      if (force && currentQuipSource) {
        try {
          currentQuipSource.stop();
        } catch {
          // ignore
        }
      }

      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(helmetIntercomBus);
      src.start();
      currentQuipSource = src;
      src.onended = () => {
        if (currentQuipSource === src) currentQuipSource = null;
      };
    } catch {
      // Ignore VO loading/decoding failure in headless or muted environments
    }
  })();
}

/**
 * Plays a Mission Control or Commander Ortiz Siege line with Quindar tones and comm subtitle.
 */
export function playSiegeMc(id: 'sg_mc_start' | 'sg_mc_boss' | 'sg_mc_o2' | 'sg_mc_upgrade' | 'sg_mc_rover' | 'sg_mc_death'): void {
  const from = id === 'sg_mc_rover' || id === 'sg_mc_boss' ? 'sg.cmdr' : 'mc';
  pushComm(from, 'vo.' + id);
  void playVoice(id, true);
}
