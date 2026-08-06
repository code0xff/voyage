import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { RAD, wrap2Pi } from '@/sim/math';
import { msToKnots } from '@/sim/units';
import type { Snapshot } from '@/engine';
import { useEngineFrame, useReadout } from './engine-context';
import { TelemetryCard } from './TelemetryCard';
import { useRef } from 'react';

/** One label/value row. The value is written per frame, outside React. */
function Gauge({
  label,
  read,
  unit,
  emphasis,
}: {
  label: string;
  read: (s: Snapshot) => string;
  unit?: string;
  emphasis?: boolean;
}) {
  const ref = useReadout<HTMLSpanElement>(read);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">
        <span
          ref={ref}
          className={cn(emphasis ? 'text-sm font-medium text-foreground' : 'text-xs')}
        >
          --
        </span>
        {unit && <span className="ml-0.5 text-[10px] text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

const deg = (v: number) => `${v.toFixed(0)}°`;

/** Warnings, gusts and shifts. Empty most of the time, loud when it matters. */
function Alerts() {
  const ref = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const msgs: { text: string; tone: 'warn' | 'bad' | 'info' }[] = [];
    const w = s.wind.sample(s.state.pos);

    if (w.gust > 1.12) msgs.push({ text: `PUFF +${Math.round((w.gust - 1) * 100)}%`, tone: 'info' });
    else if (w.gust < 0.9) msgs.push({ text: `LULL ${Math.round((w.gust - 1) * 100)}%`, tone: 'info' });
    if (Math.abs(w.shift) * RAD > 5) {
      msgs.push({
        text: `${w.shift > 0 ? 'RIGHT' : 'LEFT'} SHIFT ${Math.abs(w.shift * RAD).toFixed(0)}°`,
        tone: 'info',
      });
    }
    if (s.diag.luffing < 0.6) msgs.push({ text: 'LUFFING — sheet in or bear away', tone: 'warn' });
    if (Math.abs(s.diag.twa) * RAD < 35) msgs.push({ text: 'NO-GO ZONE', tone: 'warn' });
    if (Math.abs(s.state.heel) * RAD > 32) msgs.push({ text: 'OVERPOWERED — reef or ease', tone: 'warn' });
    if (s.diag.froude > 0.95) msgs.push({ text: 'HULL SPEED', tone: 'info' });

    const html = msgs
      .slice(0, 4)
      .map(
        (m) =>
          `<div class="${
            m.tone === 'bad'
              ? 'text-destructive'
              : m.tone === 'warn'
                ? 'text-warning'
                : 'text-info'
          }">${m.text}</div>`,
      )
      .join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  return <div ref={ref} className="min-h-[42px] space-y-0.5 text-[10.5px] leading-tight" />;
}

/** Sail plan bar: reef state, furl and the resulting area. */
function SailPlan() {
  const label = useReadout<HTMLSpanElement>((s) => {
    const reef = s.state.reef === 0 ? 'Full main' : `Reef ${s.state.reef}`;
    const furl = s.state.jibFurl > 0.01 ? ` · jib ${Math.round(s.state.jibFurl * 100)}% furled` : '';
    return `${reef}${furl}`;
  });
  const pct = useReadout<HTMLSpanElement>((s) =>
    s.diag ? `${Math.round(s.diag.sailFraction * 100)}%` : '--',
  );
  const bar = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = bar.current?.querySelector('[data-slot="indicator"]') as HTMLElement | null;
    if (el && s.diag) el.style.transform = `translateX(-${100 - s.diag.sailFraction * 100}%)`;
  });

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span ref={label} className="text-[10.5px] text-muted-foreground" />
        <span ref={pct} className="font-mono text-[10.5px] tabular-nums" />
      </div>
      <div ref={bar}>
        <Progress value={100} className="h-1" />
      </div>
    </div>
  );
}

/** Auto-mode chips. These change rarely, so plain React state via a re-render is fine. */
function Modes() {
  const ref = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el) return;
    const chips = [
      s.autoTrim ? 'AUTO TRIM' : null,
      s.autoReef ? 'AUTO REEF' : null,
      s.soundOn ? null : 'MUTED',
    ].filter(Boolean) as string[];
    const html = chips
      .map(
        (c) =>
          `<span class="inline-flex items-center rounded border border-border px-1 py-px text-[9px] tracking-wide text-muted-foreground">${c}</span>`,
      )
      .join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  return <div ref={ref} className="flex flex-wrap gap-1" />;
}

export function Instruments() {
  return (
    <Card className="pointer-events-auto w-[268px] gap-0 p-3 backdrop-blur-md bg-card/85">
      <div className="flex items-center justify-between pb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Instruments
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Gauge label="BSP" unit="kn" emphasis read={(s) => (s.diag ? msToKnots(s.diag.speed).toFixed(2) : '--')} />
        <Gauge label="VMG" unit="kn" emphasis read={(s) => (s.diag ? msToKnots(s.diag.vmg).toFixed(2) : '--')} />
        <Gauge label="HDG" read={(s) => deg(wrap2Pi(s.state.heading) * RAD)} />
        <Gauge label="TWS" unit="kn" read={(s) => msToKnots(s.env.tws).toFixed(1)} />
        <Gauge label="TWA" read={(s) => (s.diag ? deg(s.diag.twa * RAD) : '--')} />
        <Gauge label="TWD" read={(s) => deg(wrap2Pi(s.env.twd) * RAD)} />
        <Gauge label="AWA" read={(s) => (s.diag ? deg(s.diag.awa * RAD) : '--')} />
        <Gauge label="AWS" unit="kn" read={(s) => (s.diag ? msToKnots(s.diag.aws).toFixed(1) : '--')} />
        <Gauge label="Heel" read={(s) => `${(s.state.heel * RAD).toFixed(1)}°`} />
        <Gauge label="Leeway" read={(s) => (s.diag ? `${(s.diag.leeway * RAD).toFixed(1)}°` : '--')} />
        <Gauge label="Sheet" read={(s) => deg(s.state.sheet * RAD)} />
        <Gauge label="Rudder" read={(s) => deg(s.state.rudder * RAD)} />
        <Gauge label="Sea" unit="m" read={(s) => s.waves.sigWaveHeight.toFixed(1)} />
        <Gauge label="Fr" read={(s) => (s.diag ? s.diag.froude.toFixed(2) : '--')} />
      </div>

      <Separator className="my-2.5" />
      <SailPlan />
      <div className="mt-1.5">
        <Modes />
      </div>
      <Separator className="my-2.5" />
      <Alerts />
      <TelemetryCard />
    </Card>
  );
}
