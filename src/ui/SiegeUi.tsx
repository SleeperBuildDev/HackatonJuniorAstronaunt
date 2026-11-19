// Lunar Siege: Alien Swarm UI components (Briefing, Combat HUD, Upgrade Picker, Game Over).
import { useEffect } from 'preact/hooks';
import { siege, upgradeEffectTag, UPGRADES, WEAPONS } from '../game/siegeState';
import { num, t } from '../i18n';

const SIEGE_CONTROLS: [string, string][] = [
  ['W A S D', 'ctrl.walk'],
  ['Space', 'sg.ctrl.escape'],
  ['LMB', 'sg.ctrl.fire'],
  ['1-4 / Wheel', 'sg.ctrl.weapons'],
  ['R', 'sg.ctrl.reload'],
  ['E', 'sg.ctrl.rover'],
  ['F', 'ctrl.light'],
  ['G', 'sg.ctrl.nextwave'],
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const fmtTime = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
const hexColor = (c?: number) => (c != null ? '#' + c.toString(16).padStart(6, '0') : '#5fd4ff');

export function SiegeBriefing({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div class="menu briefing sg-briefing">
      <div class="menu-inner wide">
        <small class="sg-kicker">{t('sg.brief.kicker')}</small>
        <h2>☣ {t('sg.brief.title')}</h2>
        <p>{t('sg.brief.text')}</p>
        <div class="controls-grid sg-controls-grid">
          {SIEGE_CONTROLS.map(([k, v]) => (
            <div class="ctrl" key={v}>
              <span class="keys">
                {k.split(' ').map((p) => (
                  <kbd key={p}>{p}</kbd>
                ))}
              </span>
              <span>{t(v)}</span>
            </div>
          ))}
        </div>
        <button class="btn sg-deploy-btn" onClick={onDeploy}>
          ☣ {t('sg.brief.deploy')}
        </button>
        <p class="note">{t('briefing.note')}</p>
      </div>
    </div>
  );
}

function MotionRadar() {
  const blips = siege.value.radar;
  return (
    <div class="sg-radar" aria-hidden="true">
      <svg viewBox="0 0 150 150" width="150" height="150">
        <defs>
          <radialGradient id="sgRadarBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(8, 34, 42, 0.85)" />
            <stop offset="100%" stop-color="rgba(4, 14, 22, 0.92)" />
          </radialGradient>
          <linearGradient id="sgSweepGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="rgba(95, 212, 255, 0)" />
            <stop offset="100%" stop-color="rgba(95, 212, 255, 0.42)" />
          </linearGradient>
        </defs>
        <circle cx="75" cy="75" r="71" fill="url(#sgRadarBg)" stroke="rgba(95, 212, 255, 0.45)" stroke-width="1.5" />
        <circle cx="75" cy="75" r="50" fill="none" stroke="rgba(95, 212, 255, 0.16)" stroke-dasharray="3 3" />
        <circle cx="75" cy="75" r="26" fill="none" stroke="rgba(95, 212, 255, 0.16)" />
        <line x1="75" y1="6" x2="75" y2="144" stroke="rgba(95, 212, 255, 0.12)" />
        <line x1="6" y1="75" x2="144" y2="75" stroke="rgba(95, 212, 255, 0.12)" />
        <g class="sg-radar-sweep">
          <path d="M75 75 L75 6 A69 69 0 0 1 118 21 Z" fill="url(#sgSweepGrad)" />
          <line x1="75" y1="75" x2="75" y2="6" stroke="rgba(120, 235, 255, 0.75)" stroke-width="1.5" />
        </g>
        {blips.map((b, i) => {
          const dist = Math.hypot(b.x, b.z);
          const scale = dist > 1 ? 1 / dist : 1;
          const cx = 75 + b.x * scale * 62;
          const cy = 75 + b.z * scale * 62;
          if (b.kind === 'o2') {
            return (
              <g key={`o2-${i}`} transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}>
                <rect x="-5" y="-5" width="10" height="10" rx="2" fill="rgba(95, 212, 255, 0.25)" stroke="#5fd4ff" stroke-width="1.2" />
                <text y="3" text-anchor="middle" fill="#b8f0ff" font-size="6.5" font-family="var(--mono)">O₂</text>
              </g>
            );
          }
          if (b.kind === 'hab') {
            return (
              <g key={`hab-${i}`} transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}>
                <rect x="-5.5" y="-5.5" width="11" height="11" rx="2" fill="rgba(92, 242, 154, 0.25)" stroke="#5cf29a" stroke-width="1.3" />
                <text y="2.8" text-anchor="middle" fill="#d4ffe6" font-size="7" font-weight="700" font-family="var(--mono)">H</text>
              </g>
            );
          }
          if (b.kind === 'power') {
            return (
              <g key={`pwr-${i}`} transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}>
                <polygon points="0,-6 6,0 0,6 -6,0" fill="rgba(95, 212, 255, 0.25)" stroke="#ffd36a" stroke-width="1.2" />
                <text y="2.5" text-anchor="middle" fill="#ffe8a6" font-size="6.5" font-weight="700" font-family="var(--mono)">P</text>
              </g>
            );
          }
          if (b.kind === 'rover') {
            return (
              <rect
                key={`rov-${i}`}
                x={(cx - 4).toFixed(1)}
                y={(cy - 3).toFixed(1)}
                width="8"
                height="6"
                rx="1.5"
                fill="#ffb547"
                stroke="#fff3d6"
                stroke-width="0.9"
              />
            );
          }
          if (b.kind === 'boss') {
            return (
              <g key={`boss-${i}`} class="sg-blip-boss" transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}>
                <circle r="8.5" fill="rgba(255, 58, 79, 0.3)" stroke="#ff3a4f" stroke-width="1.4" />
                <circle r="4.5" fill="#ff3a4f" />
              </g>
            );
          }
          if (b.kind === 'flyer') {
            return (
              <polygon
                key={`fly-${i}`}
                class="sg-blip-hostile"
                points={`${cx},${cy - 4.5} ${cx + 4},${cy + 3.5} ${cx},${cy + 1.5} ${cx - 4},${cy + 3.5}`}
                fill="#f05bff"
              />
            );
          }
          if (b.kind === 'burrower') {
            return <circle key={`bur-${i}`} class="sg-blip-hostile" cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="3.4" fill="#ff9436" />;
          }
          return <circle key={`crw-${i}`} class="sg-blip-hostile" cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="3.2" fill="#ff4d57" />;
        })}
        <polygon points="75,67 80,79 75,76 70,79" fill="#ffffff" stroke="#081620" stroke-width="1" />
      </svg>
      <div class="sg-radar-label">{t('sg.radar')}</div>
    </div>
  );
}

function CombatCrosshair() {
  const sg = siege.value;
  const activeW = WEAPONS[sg.weaponIndex] ?? WEAPONS[0];
  const hm = sg.hitMarker;
  const reloading = sg.reloading > 0;
  const r = 16;
  const circ = 2 * Math.PI * r;
  return (
    <div class="sg-crosshair" style={{ '--sg-wcol': hexColor(activeW?.color) } as any}>
      <span class="sg-ch-tick t" />
      <span class="sg-ch-tick r" />
      <span class="sg-ch-tick b" />
      <span class="sg-ch-tick l" />
      <span class="sg-ch-dot" />
      {reloading ? (
        <svg class="sg-reload-ring" viewBox="0 0 40 40" width="40" height="40">
          <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2.5" />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            stroke="var(--amber)"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-dasharray={circ}
            stroke-dashoffset={circ * (1 - Math.max(0, Math.min(1, sg.reloading)))}
            transform="rotate(-90 20 20)"
          />
        </svg>
      ) : null}
      {hm && hm.ttl > 0 ? (
        <div class={`sg-hitmarker ${hm.kind}`}>
          <i class="hm-tl" />
          <i class="hm-tr" />
          <i class="hm-bl" />
          <i class="hm-br" />
        </div>
      ) : null}
    </div>
  );
}

export function SiegeHud() {
  const sg = siege.value;
  const activeWeapon = WEAPONS[sg.weaponIndex] ?? WEAPONS[0];
  const curAmmo = sg.ammo[sg.weaponIndex] ?? 0;
  const curMax = sg.maxAmmo[sg.weaponIndex] ?? activeWeapon?.magSize ?? 1;
  const enemyPct = sg.waveTotal > 0 ? Math.max(0, Math.min(100, (sg.enemiesLeft / sg.waveTotal) * 100)) : 0;
  const activeUpgrades = UPGRADES.filter((u) => (sg.upgrades[u.id] ?? 0) > 0);
  const lowAmmo = sg.reloading <= 0 && !sg.roverTurret && curAmmo <= Math.max(2, Math.floor(curMax * 0.2));

  return (
    <div class="sg-hud">
      {sg.damageFlash > 0.01 ? <div class="sg-dmg-vignette" style={{ opacity: Math.min(1, sg.damageFlash) }} /> : null}
      {sg.grab.active ? <div class="sg-grab-vignette" /> : null}

      {/* Top-Left Wave & Score Panel */}
      <div class="panel sg-wave-panel">
        <div class="sg-wave-head">
          <b class="sg-wave-num">{t('sg.wave', { n: num(sg.wave) })}</b>
          {sg.boss ? <span class="sg-boss-tag">☠ {t('sg.bossWave')}</span> : null}
        </div>
        <div class="sg-enemy-row">
          <span>{t('sg.enemies')}</span>
          <b>
            {num(sg.enemiesLeft)} / {num(sg.waveTotal)}
          </b>
        </div>
        <div class="bar sg-enemy-bar">
          <i style={{ width: `${enemyPct}%` }} />
        </div>
        <div class="sg-stats-mini">
          <div>
            <span>{t('sg.kills')}</span>
            <b>{num(sg.kills)}</b>
          </div>
          <div>
            <span>{t('sg.score')}</span>
            <b>{num(sg.score)}</b>
          </div>
          {sg.bestScore > 0 ? (
            <div>
              <span>{t('sg.best')}</span>
              <b>W{num(sg.bestWave)}</b>
            </div>
          ) : null}
        </div>
        {activeUpgrades.length > 0 ? (
          <div class="sg-up-pills">
            {activeUpgrades.map((u) => (
              <span class={`sg-up-pill ${u.rarity}`} key={u.id} title={t(u.titleKey)}>
                <i>{u.icon}</i>
                <b>×{num(sg.upgrades[u.id])}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Intermission Banner */}
      {sg.phase === 'intermission' ? (
        <div class="sg-intermission">
          <b>{t('sg.intermission', { s: num(Math.max(1, Math.ceil(sg.intermission))) })}</b>
          <span>
            {t('sg.skipWait')} <kbd>G</kbd>
          </span>
        </div>
      ) : null}

      {/* Top-Center Boss Health Bar */}
      {sg.boss ? (
        <div class="sg-boss-bar">
          <div class="sg-boss-head">
            <span class="sg-boss-name">
              ☠ {t(sg.boss.nameKey)}
              {sg.boss.tier > 1 ? <em class="sg-boss-tier">MK {ROMAN[sg.boss.tier] ?? sg.boss.tier}</em> : null}
            </span>
            <span class="sg-boss-hp">
              {num(Math.max(0, Math.ceil(sg.boss.hp)))} / {num(Math.ceil(sg.boss.maxHp))}
            </span>
          </div>
          <div class="sg-boss-sub">{t(sg.boss.subtitleKey)}</div>
          <div class="sg-boss-track">
            <i style={{ width: `${Math.max(0, Math.min(100, (sg.boss.hp / Math.max(1, sg.boss.maxHp)) * 100))}%` }} />
            <div class="sg-boss-segs" />
          </div>
        </div>
      ) : null}

      {/* Top-Right Circular Motion Tracker Radar */}
      <MotionRadar />

      {/* Station Alert */}
      {sg.stationAlert ? <div class={`sg-station-alert ${sg.stationAlert}`}>⚠ {t('sg.alert.' + sg.stationAlert)}</div> : null}

      {/* Compact Kill / Event Feed */}
      {sg.killFeed.length > 0 ? (
        <div class="sg-feed">
          {sg.killFeed.slice(-4).map((ev) => (
            <div class="sg-feed-item" key={ev.id}>
              {t(ev.textKey, ev.vars)}
            </div>
          ))}
        </div>
      ) : null}

      {/* Dynamic Combat Crosshair + Hitmarker */}
      <CombatCrosshair />

      {/* Bottom-Right Weapon Hotbar & Ammo Display */}
      <div class="panel sg-weapons">
        {sg.roverTurret ? <div class="sg-turret-badge">🚙 {t('sg.roverTurret')}</div> : null}
        <div class="sg-active-weapon">
          <div class="sg-w-meta">
            <span class="sg-w-name" style={{ color: hexColor(activeWeapon?.color) }}>
              {activeWeapon ? t(activeWeapon.nameKey) : ''}
            </span>
            {sg.reloading > 0 ? (
              <span class="sg-reloading-lbl">{t('sg.reloading')}</span>
            ) : lowAmmo ? (
              <span class="sg-reload-hint">
                <kbd>R</kbd> {t('sg.reloadHint')}
              </span>
            ) : null}
          </div>
          <div class={`sg-ammo-read ${curAmmo === 0 ? 'empty' : lowAmmo ? 'low' : ''}`}>
            <b>{num(curAmmo)}</b>
            <small>/ {num(curMax)}</small>
          </div>
        </div>
        {sg.reloading > 0 ? (
          <div class="bar sg-reload-bar">
            <i style={{ width: `${Math.round(sg.reloading * 100)}%` }} />
          </div>
        ) : null}
        <div class="sg-hotbar">
          {WEAPONS.map((w, i) => {
            const active = i === sg.weaponIndex;
            const wAmmo = sg.ammo[i] ?? 0;
            return (
              <div class={`sg-slot ${active ? 'active' : ''}`} key={w.id} style={active ? ({ borderColor: hexColor(w.color) } as any) : undefined}>
                <kbd>{w.key}</kbd>
                <span class="sg-slot-name">{t(w.nameKey)}</span>
                <small>{num(wAmmo)}</small>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grabbed & Stunned Urgent Overlay */}
      {sg.grab.active ? (
        <div class="sg-grab-overlay">
          <div class="sg-grab-card">
            <div class="sg-grab-title">☣ {t('sg.grab.title', { name: t(sg.grab.alienNameKey) })}</div>
            <div class="sg-grab-mash">
              <kbd class="sg-bounce">SPACE</kbd> / <kbd class="sg-bounce">E</kbd>
              <span>{t('sg.grab.mash')}</span>
            </div>
            <div class="sg-grab-bar-wrap">
              <div class="sg-grab-bar-head">
                <span>
                  {num(sg.grab.taps)} / {num(sg.grab.requiredTaps)}
                </span>
              </div>
              <div class="bar sg-escape-bar">
                <i style={{ width: `${Math.max(0, Math.min(100, (sg.grab.taps / Math.max(1, sg.grab.requiredTaps)) * 100))}%` }} />
              </div>
            </div>
            <div class="sg-grab-bar-wrap">
              <div class="sg-grab-bar-head danger">
                <span>⚠ {t('sg.grab.danger')}</span>
                <span>{Math.max(0, sg.grab.biteTimer).toFixed(1)}s</span>
              </div>
              <div class="bar sg-bite-bar">
                <i style={{ width: `${Math.max(0, Math.min(100, (sg.grab.biteTimer / Math.max(0.01, sg.grab.biteDuration)) * 100))}%` }} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SiegeUpgradeModal({ onPick }: { onPick: (id: string) => void }) {
  const sg = siege.value;
  const choices = sg.upgradeChoices
    .map((id) => UPGRADES.find((u) => u.id === id))
    .filter((u): u is (typeof UPGRADES)[number] => Boolean(u));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : e.code === 'Digit2' || e.code === 'Numpad2' ? 1 : e.code === 'Digit3' || e.code === 'Numpad3' ? 2 : -1;
      if (idx >= 0 && choices[idx]) {
        e.preventDefault();
        onPick(choices[idx].id);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [choices.map((c) => c.id).join(',')]);

  return (
    <div class="modal-backdrop sg-up-backdrop">
      <div class="sg-up-modal">
        <div class="sg-up-head">
          <h2>{t('sg.up.title', { n: num(sg.wave) })}</h2>
          <p>{t('sg.up.subtitle')}</p>
        </div>
        <div class="sg-up-grid">
          {choices.map((u, i) => {
            const cur = sg.upgrades[u.id] ?? 0;
            return (
              <button class={`sg-up-card ${u.rarity}`} key={u.id} onClick={() => onPick(u.id)}>
                <div class="sg-up-card-top">
                  <kbd>{i + 1}</kbd>
                  <span class={`sg-rarity ${u.rarity}`}>{t('sg.up.rarity.' + u.rarity)}</span>
                </div>
                <div class="sg-up-icon">{u.icon}</div>
                <h3>{t(u.titleKey)}</h3>
                <div class="sg-up-lv">{t('sg.up.lv', { a: num(cur), b: num(cur + 1) })}</div>
                <div class={`sg-up-impact ${u.rarity}`}>{upgradeEffectTag(u.id, cur + 1)}</div>
                <p>{t(u.descKey)}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SiegeGameOver({ onAgain, onMenu }: { onAgain: () => void; onMenu: () => void }) {
  const sg = siege.value;
  const collected = UPGRADES.filter((u) => (sg.upgrades[u.id] ?? 0) > 0);
  const totalStacks = collected.reduce((sum, u) => sum + (sg.upgrades[u.id] ?? 0), 0);

  return (
    <div class="menu complete sg-gameover">
      <div class="sg-over-card">
        <small class="sg-over-kicker">{t('sg.over.kicker')}</small>
        <h2>{t('sg.over.title')}</h2>
        {sg.newRecord ? <div class="sg-record-badge">{t('sg.over.record')}</div> : null}
        <div class="sg-over-stats">
          <div class="sg-over-stat">
            <span>{t('sg.over.wave')}</span>
            <b>{num(sg.wave)}</b>
          </div>
          <div class="sg-over-stat">
            <span>{t('sg.over.kills')}</span>
            <b>{num(sg.kills)}</b>
          </div>
          <div class="sg-over-stat">
            <span>{t('sg.over.bosses')}</span>
            <b>{num(sg.bossesKilled)}</b>
          </div>
          <div class="sg-over-stat">
            <span>{t('sg.over.time')}</span>
            <b>{fmtTime(sg.timeSec)}</b>
          </div>
          <div class="sg-over-stat highlight">
            <span>{t('sg.over.score')}</span>
            <b>{num(sg.score)}</b>
          </div>
          <div class="sg-over-stat">
            <span>{t('sg.over.upgrades')}</span>
            <b>{num(totalStacks)}</b>
          </div>
        </div>
        {collected.length > 0 ? (
          <div class="sg-over-ups">
            {collected.map((u) => (
              <span class={`sg-up-pill ${u.rarity}`} key={u.id} title={t(u.titleKey)}>
                <i>{u.icon}</i>
                <b>×{num(sg.upgrades[u.id])}</b>
              </span>
            ))}
          </div>
        ) : null}
        <div class="menu-buttons row">
          <button class="btn sg-deploy-btn" onClick={onAgain}>
            ☣ {t('sg.over.again')}
          </button>
          <button class="btn" onClick={onMenu}>
            {t('pause.menu')}
          </button>
        </div>
      </div>
    </div>
  );
}
