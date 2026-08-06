import type { Diagnostics } from '../sim/boat';
import type { Polar } from '../sim/polar';
import { msToKnots } from '../sim/units';
import { token } from '../ui/tokens';

/**
 * The polar diagram, drawn to a canvas.
 *
 * Wind is up the screen, so the plot is oriented the way a sailor thinks: the
 * no-go zone is the notch at the top, and the live marker shows where the boat
 * currently sits against what it could be doing.
 */
export function drawPolar(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  polar: Polar | null,
  diag: Diagnostics | null,
  busy: boolean,
): void {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.42;

  ctx.font = '9px ui-monospace, "JetBrains Mono", monospace';

  if (!polar) {
    ctx.fillStyle = token('--muted-foreground');
    ctx.textAlign = 'center';
    ctx.fillText(busy ? 'Solving polar…' : 'Press P to solve', cx, cy);
    return;
  }

  const maxKn = Math.max(2, Math.ceil(msToKnots(polar.maxSpeed) / 2) * 2 + 2);
  const rad = (kn: number) => (kn / maxKn) * R;
  const pt = (twa: number, kn: number, sign: number) => {
    const r = rad(kn);
    return [cx + sign * Math.sin(twa) * r, cy - Math.cos(twa) * r] as const;
  };

  // Speed rings and radials
  ctx.strokeStyle = token('--border');
  ctx.lineWidth = 1;
  for (let kn = 2; kn <= maxKn; kn += 2) {
    ctx.beginPath();
    ctx.arc(cx, cy, rad(kn), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < 180; a += 30) {
    const t = (a * Math.PI) / 180;
    ctx.beginPath();
    const [x1, y1] = pt(t, maxKn, 1);
    const [x2, y2] = pt(t, maxKn, -1);
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.fillStyle = token('--muted-foreground');
  ctx.textAlign = 'left';
  for (let kn = 2; kn <= maxKn; kn += 2) {
    ctx.fillText(String(kn), cx + 3, cy - rad(kn) - 2);
  }

  // The curve itself, mirrored port and starboard.
  ctx.strokeStyle = token('--info');
  ctx.lineWidth = 1.6;
  for (const sign of [1, -1]) {
    ctx.beginPath();
    polar.points.forEach((p, i) => {
      const [x, y] = pt(p.twa, msToKnots(p.speed), sign);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  // Best VMG angles: the two headings actually worth steering.
  ctx.setLineDash([3, 3]);
  for (const [p, color] of [
    [polar.bestUpwind, token('--warning')],
    [polar.bestDownwind, token('--success')],
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

  if (diag) {
    const [px, py] = pt(Math.abs(diag.twa), msToKnots(diag.speed), diag.twa >= 0 ? 1 : -1);
    ctx.fillStyle = token('--foreground');
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = token('--muted-foreground');
  ctx.textAlign = 'center';
  ctx.fillText('WIND', cx, 9);
}
