import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { RAD, clamp, wrap2Pi } from '@/sim/math';
import { CRUISER } from '@/sim/config';
import { msToKnots } from '@/sim/units';
import { phaseName, formatClock } from '@/sim/sky';
import { useT } from './i18n';
import { DAY_PHASE, PANEL, WEATHER } from './strings';
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
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const msgs: { text: string; tone: 'warn' | 'bad' | 'info' }[] = [];
    const w = s.wind.sample(s.state.pos);

    if (s.clearance < 0) msgs.push({ text: 'AGROUND', tone: 'bad' });
    else if (s.clearance < 3) msgs.push({ text: `SHOAL — ${s.clearance.toFixed(1)} m under keel`, tone: 'bad' });

    if (w.exposure < 0.75) msgs.push({ text: 'WIND SHADOW — sailing into a lee', tone: 'warn' });
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
    // Twist first: it is the cheapest way to give power back, and it is the one
    // the player is least likely to reach for on their own.
    if (Math.abs(s.state.heel) * RAD > 32)
      msgs.push({ text: t(PANEL.overpowered), tone: 'warn' });
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
  const t = useT();
  const label = useReadout<HTMLSpanElement>((s) => {
    const reef = s.state.reef === 0 ? t(PANEL.fullMain) : `${t(PANEL.reef)} ${s.state.reef}`;
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

/**
 * Sail twist, against the twist that would make the most drive.
 *
 * The number alone would be useless. Twist is only meaningful relative to what
 * the sail wants at this moment, and that changes with every course alteration
 * -- a couple of degrees hard on the wind, thirty on a broad reach, back to
 * nothing on a dead run. So the bar carries a mark at the optimum and the
 * player trims to it.
 *
 * The mark is the *power* optimum, deliberately, and not the gradient's spread
 * of apparent wind over the rig. Those two agree only while the boom is clear
 * of the shrouds; off the wind they part company completely, and a mark at the
 * spread would be telling the player to give away a percent of boat speed for
 * being correctly trimmed.
 *
 * Sitting past the mark is not an error, and the bar deliberately does not
 * scold: twisting off beyond the optimum is how you depower without reefing,
 * and in a breeze it is the fastest thing to do. The mark says what makes most
 * power; the decision to give power away is the player's.
 */
function Twist() {
  const t = useT();
  const angle = useReadout<HTMLSpanElement>((s) =>
    s.diag ? `${(s.state.twist * RAD).toFixed(0)}° / ${(s.diag.twistWanted * RAD).toFixed(0)}°` : '--',
  );
  const fill = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);

  useEngineFrame((s) => {
    if (!s.diag) return;
    if (fill.current) {
      fill.current.style.width = `${clamp(s.state.twist / CRUISER.maxTwist, 0, 1) * 100}%`;
      // Twisted well past the optimum means the sail is being used to spill
      // wind rather than to make power, which is worth seeing at a glance --
      // it is the difference between trimmed and depowered.
      const tone =
        s.state.twist > s.diag.twistWanted + 4 * (Math.PI / 180) ? 'bg-info' : 'bg-foreground';
      const cls = `absolute inset-y-0 left-0 rounded-sm ${tone}`;
      if (fill.current.className !== cls) fill.current.className = cls;
    }
    if (mark.current) {
      mark.current.style.left = `${clamp(s.diag.twistWanted / CRUISER.maxTwist, 0, 1) * 100}%`;
    }
  });

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] text-muted-foreground">{t(PANEL.twistBest)}</span>
        <span ref={angle} className="font-mono text-[10.5px] tabular-nums" />
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-sm bg-secondary">
        <div ref={fill} className="absolute inset-y-0 left-0 rounded-sm bg-foreground" />
        <div ref={mark} className="absolute inset-y-0 w-px -translate-x-1/2 bg-background/80" />
      </div>
    </div>
  );
}

/**
 * Helm angle.
 *
 * The keys move the rudder and it stays where it is left, so how much helm is
 * wound on is persistent state the player has to know. On a real boat you know
 * it because your hand is on the tiller; on a screen there is no such feedback,
 * and the only symptom of a forgotten quarter-turn is the boat quietly circling.
 * Every simulator that keeps the helm where you put it carries an indicator for
 * exactly this reason.
 *
 * It reads the *actual* rudder angle rather than the commanded one, which is
 * what a rudder-angle indicator shows: the blade slews at its own rate, and
 * during a tack the lag is real and worth seeing.
 */
function Helm() {
  const t = useT();
  const angle = useReadout<HTMLSpanElement>((s) => {
    const d = s.state.rudder * RAD;
    if (Math.abs(d) < 0.5) return t(PANEL.amidships);
    return `${Math.abs(d).toFixed(0)}° ${d > 0 ? 'stbd' : 'port'}`;
  });
  const who = useReadout<HTMLSpanElement>((s) =>
    s.pilot.mode === 'off' ? t(PANEL.helm) : t(PANEL.pilot),
  );
  const fill = useRef<HTMLDivElement>(null);

  useEngineFrame((s) => {
    const el = fill.current;
    if (!el) return;
    const v = clamp(s.state.rudder / CRUISER.maxRudder, -1, 1);
    const half = Math.abs(v) * 50;
    // Grow out from the centre, so which way it is wound is the shape, not a
    // number to be read.
    el.style.left = v >= 0 ? '50%' : `${50 - half}%`;
    el.style.width = `${half}%`;

    // A blade near hard over is mostly making drag rather than turning the
    // boat, which is worth saying out loud.
    const tone =
      Math.abs(v) > 0.85
        ? 'bg-warning'
        : s.pilot.mode !== 'off'
          ? 'bg-info'
          : 'bg-foreground';
    const cls = `absolute inset-y-0 rounded-sm ${tone}`;
    if (el.className !== cls) el.className = cls;
  });

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span ref={who} className="text-[10.5px] text-muted-foreground" />
        <span ref={angle} className="font-mono text-[10.5px] tabular-nums" />
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-sm bg-secondary">
        <div ref={fill} className="absolute inset-y-0 rounded-sm bg-foreground" />
        {/* Amidships. Without a centre mark the bar says how much but not from where. */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-background/80" />
      </div>
    </div>
  );
}

/** Auto-mode chips. These change rarely, so plain React state via a re-render is fine. */
function Modes() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el) return;
    // The pilot's chip carries its target, because "on" is not the useful fact
    // -- what it is steering to is, and it is the only place that number shows.
    const pilot =
      s.pilot.mode === 'compass'
        ? `PILOT ${Math.round(s.pilot.heading * RAD)}°`
        : s.pilot.mode === 'wind'
          ? `PILOT WIND ${Math.round(Math.abs(s.pilot.twa * RAD))}°${s.pilot.twa < 0 ? 'P' : 'S'}`
          : null;
    const chips = [
      pilot,
      s.autoTrim ? t(PANEL.autoTrim) : null,
      s.autoReef ? t(PANEL.autoReef) : null,
      s.soundOn ? null : t(PANEL.muted),
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
  const t = useT();
  const conditions = useReadout<HTMLSpanElement>(
    (s) =>
      `${formatClock(s.sky.hour)} · ${t(DAY_PHASE[phaseName(s.sky)])} · ${t(
        WEATHER[s.weather.state.kind],
      )}`,
  );

  return (
    <Card className="pointer-events-auto w-[268px] gap-0 p-3 backdrop-blur-md bg-card/85">
      <div className="flex items-center justify-between pb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t(PANEL.instruments)}
        </span>
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal">
          <span ref={conditions} />
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Gauge label="BSP" unit="kn" emphasis read={(s) => (s.diag ? msToKnots(s.diag.speed).toFixed(2) : '--')} />
        <Gauge label="VMG" unit="kn" emphasis read={(s) => (s.diag ? msToKnots(s.diag.vmg).toFixed(2) : '--')} />
        {/*
          Their own row rather than slotted into the next gap, so BSP sits
          directly above SOG and the two can be read as a column: through the
          water above, over the ground below. The difference between them is the
          tide, and on slack water they agree and say so. HDG follows on the row
          under, which keeps all four of the where-am-I-going numbers in the top
          three rows.
        */}
        <Gauge label="SOG" unit="kn" read={(s) => (s.diag ? msToKnots(s.diag.sog).toFixed(2) : '--')} />
        <Gauge label="COG" read={(s) => (s.diag ? deg(wrap2Pi(s.diag.cog) * RAD) : '--')} />
        <Gauge label="HDG" read={(s) => deg(wrap2Pi(s.state.heading) * RAD)} />
        <Gauge label="TWS" unit="kn" read={(s) => msToKnots(s.env.tws).toFixed(1)} />
        <Gauge label="TWA" read={(s) => (s.diag ? deg(s.diag.twa * RAD) : '--')} />
        <Gauge label="TWD" read={(s) => deg(wrap2Pi(s.env.twd) * RAD)} />
        {/*
          From the masthead, not from the sail's centre of effort, because that
          is where a boat's wind sensor is -- and because the vane drawn on the
          masthead is fed `awaMast`. Reading `awa` here put a number on screen
          that disagreed with the instrument beside it by up to twenty degrees
          on a broad reach, which is the sort of thing a player eventually
          notices and cannot explain.
        */}
        <Gauge label="AWA" read={(s) => (s.diag ? deg(s.diag.awaMast * RAD) : '--')} />
        <Gauge
          label="AWS"
          unit="kn"
          read={(s) => (s.diag ? msToKnots(s.diag.awsMast).toFixed(1) : '--')}
        />
        <Gauge label="Heel" read={(s) => `${(s.state.heel * RAD).toFixed(1)}°`} />
        <Gauge label="Leeway" read={(s) => (s.diag ? `${(s.diag.leeway * RAD).toFixed(1)}°` : '--')} />
        <Gauge label="Sheet" read={(s) => deg(s.state.sheet * RAD)} />
        <Gauge label="AoA" read={(s) => (s.diag ? deg(s.diag.sailAoA * RAD) : '--')} />
        <Gauge label="Sea" unit="m" read={(s) => s.waves.sigWaveHeight.toFixed(1)} />
        <Gauge
          label="Depth"
          unit="m"
          read={(s) => (s.depth === Infinity ? '∞' : s.depth.toFixed(0))}
        />
      </div>

      <Separator className="my-2.5" />
      <Helm />
      <div className="mt-2">
        <Twist />
      </div>
      <div className="mt-2">
        <SailPlan />
      </div>
      <div className="mt-1.5">
        <Modes />
      </div>
      <Separator className="my-2.5" />
      <Alerts />
      <TelemetryCard />
    </Card>
  );
}
