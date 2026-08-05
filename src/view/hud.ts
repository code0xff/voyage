import { RAD, wrap2Pi } from '../sim/math';
import type { BoatState, Diagnostics } from '../sim/boat';
import type { Environment } from '../sim/config';
import type { Polar } from '../sim/polar';
import type { WindField } from '../sim/wind';
import type { WaveField } from '../sim/waves';
import { msToKnots } from '../sim/units';
import { Telemetry, drawTelemetry } from './telemetry';

/**
 * Instruments: gauges, polar plot and telemetry.
 *
 * This matters more than the renderer. Without seeing the force breakdown and
 * the polar live, tuning parameters is pure guesswork.
 */

export interface HudModes {
  autoTrim: boolean;
  autoReef: boolean;
  sound: boolean;
}

export interface Hud {
  update(
    state: BoatState,
    diag: Diagnostics,
    env: Environment,
    wind: WindField,
    waves: WaveField,
    polar: Polar | null,
    modes: HudModes,
  ): void;
  setBusy(busy: boolean): void;
  telemetry: Telemetry;
}

const rows = [
  'BSP',
  'VMG',
  'HDG',
  'TWS',
  'TWD',
  'TWA',
  'AWS',
  'AWA',
  'AoA',
  'HEEL',
  'LEEWAY',
  'SHEET',
  'RUDDER',
  'SEA',
] as const;

type Row = (typeof rows)[number];

function el(cls: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}

export function createHud(root: HTMLElement): Hud {
  const panel = el('hud', root);
  const table = el('gauges', panel);

  const cells = new Map<Row, HTMLElement>();
  for (const label of rows) {
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = label;
    const v = document.createElement('div');
    v.className = 'v';
    v.textContent = '--';
    table.append(k, v);
    cells.set(label, v);
  }

  // Sail plan and mode bar
  const sailBar = el('sailbar', panel);
  const sailText = el('sailtext', sailBar);
  const sailFill = el('sailfill', sailBar);

  const warn = el('warn', panel);

  // Telemetry
  const telCanvas = document.createElement('canvas');
  telCanvas.className = 'tel';
  telCanvas.width = 292;
  telCanvas.height = 84;
  panel.appendChild(telCanvas);
  const telCtx = telCanvas.getContext('2d')!;

  const telemetry = new Telemetry(
    [
      { label: 'BSP', color: '#4fd1c5', min: 0, max: 10 },
      { label: 'VMG', color: '#f6c667', min: -8, max: 8 },
      { label: 'HEEL', color: '#e07a8b', min: 0, max: 45 },
      { label: 'TWS', color: '#8fa8c0', min: 0, max: 35 },
    ],
    50,
  );

  // The polar gets its own panel, bottom right. Bolted onto the instrument
  // panel it overflows vertically and covers the key list.
  const polarPanel = el('polarpanel', root);
  const polarCanvas = document.createElement('canvas');
  polarCanvas.className = 'polar';
  polarCanvas.width = 260;
  polarCanvas.height = 260;
  polarPanel.appendChild(polarCanvas);
  const ctx = polarCanvas.getContext('2d')!;

  const caption = el('caption', polarPanel);

  let busy = false;

  const set = (k: Row, s: string) => {
    cells.get(k)!.textContent = s;
  };

  function drawPolar(polar: Polar | null, diag: Diagnostics): void {
    const w = polarCanvas.width;
    const h = polarCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.44;

    if (!polar) {
      ctx.fillStyle = '#5b6b7d';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(busy ? 'Computing polar...' : 'Press P to compute polar', cx, cy);
      return;
    }

    const maxKn = Math.max(2, Math.ceil(msToKnots(polar.maxSpeed) / 2) * 2 + 2);
    const rad = (kn: number) => (kn / maxKn) * R;

    // Polar layout: up the screen is where the wind comes from (TWA 0).
    const pt = (twa: number, speedKn: number, sign: number) => {
      const r = rad(speedKn);
      return [cx + sign * Math.sin(twa) * r, cy - Math.cos(twa) * r] as const;
    };

    ctx.strokeStyle = '#26333f';
    ctx.fillStyle = '#4a5a6b';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (let kn = 2; kn <= maxKn; kn += 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad(kn), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(String(kn), cx + 3, cy - rad(kn) - 2);
    }
    for (let a = 0; a < 180; a += 30) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const [x, y] = pt(a * (Math.PI / 180), maxKn, 1);
      ctx.lineTo(x, y);
      ctx.moveTo(cx, cy);
      const [x2, y2] = pt(a * (Math.PI / 180), maxKn, -1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (const sign of [1, -1]) {
      ctx.beginPath();
      polar.points.forEach((p, i) => {
        const [x, y] = pt(p.twa, msToKnots(p.speed), sign);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#4fd1c5';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    ctx.setLineDash([3, 3]);
    for (const [p, color] of [
      [polar.bestUpwind, '#f6c667'],
      [polar.bestDownwind, '#e07a8b'],
    ] as const) {
      if (!p) continue;
      ctx.strokeStyle = color;
      for (const sign of [1, -1]) {
        const [x, y] = pt(p.twa, msToKnots(p.speed), sign);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    const twaAbs = Math.abs(diag.twa);
    const sign = diag.twa >= 0 ? 1 : -1;
    const [px, py] = pt(twaAbs, msToKnots(diag.speed), sign);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5b6b7d';
    ctx.textAlign = 'center';
    ctx.fillText('WIND', cx, 10);
  }

  return {
    telemetry,
    setBusy(b: boolean) {
      busy = b;
    },
    update(state, diag, env, wind, waves, polar, modes) {
      const heelDeg = Math.abs(state.heel) * RAD;
      set('BSP', `${msToKnots(diag.speed).toFixed(2)} kn`);
      set('VMG', `${msToKnots(diag.vmg).toFixed(2)} kn`);
      set('HDG', `${(wrap2Pi(state.heading) * RAD).toFixed(0)}°`);
      set('TWS', `${msToKnots(env.tws).toFixed(1)} kn`);
      set('TWD', `${(wrap2Pi(env.twd) * RAD).toFixed(0)}°`);
      set('TWA', `${(diag.twa * RAD).toFixed(0)}°`);
      set('AWS', `${msToKnots(diag.aws).toFixed(1)} kn`);
      set('AWA', `${(diag.awa * RAD).toFixed(0)}°`);
      set('AoA', `${(diag.sailAoA * RAD).toFixed(0)}°`);
      set('HEEL', `${(state.heel * RAD).toFixed(1)}°`);
      set('LEEWAY', `${(diag.leeway * RAD).toFixed(1)}°`);
      set('SHEET', `${(state.sheet * RAD).toFixed(0)}°`);
      set('RUDDER', `${(state.rudder * RAD).toFixed(0)}°`);
      set('SEA', `${waves.sigWaveHeight.toFixed(1)} m`);

      // Sail plan bar
      const pct = Math.round(diag.sailFraction * 100);
      const reefLabel = state.reef === 0 ? 'Full sail' : `Reef ${state.reef}`;
      const furlLabel =
        state.jibFurl > 0.01 ? ` \u00b7 jib ${Math.round(state.jibFurl * 100)}% furled` : '';
      sailText.textContent =
        `${reefLabel}${furlLabel} — ${pct}%` +
        `${modes.autoReef ? '  [AUTO REEF]' : ''}${modes.autoTrim ? '  [AUTO TRIM]' : ''}` +
        `${modes.sound ? '' : '  [MUTED]'}`;
      sailFill.style.width = `${pct}%`;

      const msgs: string[] = [];
      // Puffs and shifts are tactical information. As bare numbers nobody reads them.
      const w = wind.sample(state.pos);
      if (w.gust > 1.12) msgs.push(`PUFF +${Math.round((w.gust - 1) * 100)}%`);
      else if (w.gust < 0.9) msgs.push(`LULL ${Math.round((w.gust - 1) * 100)}%`);
      if (Math.abs(w.shift) * RAD > 5) {
        msgs.push(`${w.shift > 0 ? 'RIGHT' : 'LEFT'} SHIFT ${Math.abs(w.shift * RAD).toFixed(0)}\u00b0`);
      }
      if (diag.luffing < 0.6) msgs.push('LUFFING - sheet in or bear away');
      if (Math.abs(diag.twa) * RAD < 35) msgs.push('NO-GO ZONE - too close to the wind');
      if (heelDeg > 32) msgs.push('OVERPOWERED - reef or ease the sheet');
      if (diag.froude > 0.95) msgs.push('HULL SPEED - wave-making wall');
      warn.textContent = msgs.join('\n');

      drawTelemetry(telCtx, telemetry, telCanvas.width, telCanvas.height);
      drawPolar(polar, diag);
      caption.textContent = polar
        ? `Polar at mean TWS ${msToKnots(polar.tws).toFixed(0)} kn` +
          (polar.bestUpwind
            ? ` \u00b7 best upwind ${(polar.bestUpwind.twa * RAD).toFixed(0)}\u00b0`
            : '')
        : '';
    },
  };
}
