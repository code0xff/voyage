import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { RAD, clamp, compassVec, wrap2Pi } from '@/sim/math';
import { CRUISER } from '@/sim/config';
import { msToKnots } from '@/sim/units';
import { formatLatLon } from '@/sim/globe';
import { phaseName, formatClock } from '@/sim/sky';
import { pace } from '@/sim/polar';
import { useT } from './i18n';
import { ALERT, BELT, DAY_PHASE, PANEL, WEATHER, lull, maneuverReport, puff, shift, shoal } from './strings';
import type { Snapshot } from '@/engine';
import { useEngineFrame, useReadout } from './engine-context';
import { TelemetryCard } from './TelemetryCard';
import { useRef } from 'react';

/**
 * Where she is on the Earth, and which sea that makes it.
 *
 * The whole point of opening the planet, in one line: a latitude is not
 * trivia here, it is the thing that decides what the wind does. Reading
 * "the trades" beside 15 degrees north is the difference between sailing
 * a big map and sailing an ocean that has parts.
 *
 * The belt is silent in a surveyed region and at a venue, because those
 * places keep their own conditions and naming a belt there would describe a
 * wind nobody is feeling. Written per frame outside React like every other
 * readout -- it changes in the last digit at walking pace, but it changes
 * every step, and this panel's rule is that nothing per-frame goes through
 * the reconciler.
 */
function Fix() {
  const t = useT();
  const where = useReadout<HTMLSpanElement>((s) => formatLatLon(s.place));
  const belt = useReadout<HTMLSpanElement>((s) => (s.belt ? t(BELT[s.belt]) : ''));
  return (
    <div className="mt-2 flex items-baseline justify-between gap-2">
      <span ref={where} className="font-mono text-[10.5px] tabular-nums text-muted-foreground" />
      <span ref={belt} className="truncate text-[10.5px] text-muted-foreground" />
    </div>
  );
}

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

/**
 * How she is going against her own polar, or null where saying would mislead.
 *
 * The two readouts built on it share this rather than each deciding, because
 * they must be silent together: a target with no percentage beside it, or the
 * reverse, reads as a broken instrument rather than as a refusal to answer.
 *
 * Silent while a tide runs, and that is the same decision `view/polarplot.ts`
 * makes about its live marker, for the reason set out at length there: the
 * curve is a still-water polar, the apparent wind at a given boat speed is not
 * what still water would give once she is being carried, and the gap stops
 * meaning "how much you are leaving out there". Two places, one rule -- change
 * your mind about it and both have to move.
 */
const paceNow = (s: Snapshot) =>
  s.polar && s.diag && !s.currents.running ? pace(s.polar, s.diag.twa, s.diag.speed) : null;

/**
 * How far ahead the wind is read, in seconds.
 *
 * A judgement about how much warning is useful rather than a derived number,
 * and it is bounded on both sides. Shorter and there is no time to ease a sheet
 * and bear away before it lands; longer and it stops being about now -- a puff
 * is 130 m across and the pattern carries at four fifths of the wind, so ten
 * seconds is roughly a third of a puff at a working breeze. It scales itself at
 * the ends, too: a drifter carries the pattern slowly and so warns of very
 * little, and a gale carries it a whole puff-length, which is exactly the
 * weather in which more warning is wanted.
 */
const LOOK_AHEAD = 10;

/** Warnings, gusts and shifts. Empty most of the time, loud when it matters. */
function Alerts() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const msgs: { text: string; tone: 'warn' | 'bad' | 'info' }[] = [];
    const w = s.wind.sample(s.state.pos);
    // Where she will be, not where she is. Ten seconds is twenty-five metres
    // at five knots -- a fifth of a puff's hundred and thirty -- so forecasting
    // at the present position would be answering about a patch of water she is
    // partly leaving. Straight-line from the present course over the ground,
    // which is wrong for a boat mid-turn and right for one being sailed -- and
    // a helmsman mid-tack is not reading the water anyway.
    const run = s.diag.sog * LOOK_AHEAD;
    const track = compassVec(s.diag.cog);
    const soon = s.wind.sample(
      { x: s.state.pos.x + track.x * run, y: s.state.pos.y + track.y * run },
      LOOK_AHEAD,
    );

    if (s.clearance < 0) msgs.push({ text: t(ALERT.aground), tone: 'bad' });
    else if (s.clearance < 3)
      msgs.push({ text: t(shoal(s.clearance.toFixed(1))), tone: 'bad' });

    // The answer to the player's own last action goes above the weather's
    // running commentary: for the few seconds it is up, it is the one line
    // here they are actually looking for.
    if (s.maneuver) {
      msgs.push({
        text: t(maneuverReport(s.maneuver.kind, s.maneuver.seconds, msToKnots(s.maneuver.lost))),
        tone: 'info',
      });
    }

    if (w.exposure < 0.75) msgs.push({ text: t(ALERT.windShadow), tone: 'warn' });

    // What is here now if it is here, and otherwise what is on its way. Both
    // are the same reading of the same field, one of them ahead of the boat --
    // so a puff announced and then a puff arriving is the instrument being
    // proved right, which is what makes it worth believing the next time.
    //
    // The form follows the boat's own reading every frame, with no hysteresis,
    // and that is a decision: a lull that has eased to just inside the
    // threshold while a deeper one stands ten seconds out really has become
    // "LULL in 10s" again, and holding the old form to look steadier would be
    // the instrument smoothing over a fact. The cost is a single frame of
    // churn at the exact crossing, which the value ticking through -10, -11,
    // -12 makes invisible in practice.
    const blowingNow = w.gust > 1.12 || w.gust < 0.9;
    const gust = blowingNow ? w : soon;
    const gustLead = blowingNow ? null : LOOK_AHEAD;
    if (gust.gust > 1.12) {
      msgs.push({ text: t(puff(Math.round((gust.gust - 1) * 100), gustLead)), tone: 'info' });
    } else if (gust.gust < 0.9) {
      msgs.push({ text: t(lull(Math.round((gust.gust - 1) * 100), gustLead)), tone: 'info' });
    }

    const veeringNow = Math.abs(w.shift) * RAD > 5;
    const veer = veeringNow ? w : soon;
    if (Math.abs(veer.shift) * RAD > 5) {
      msgs.push({
        text: t(
          shift(
            veer.shift > 0,
            Math.abs(veer.shift * RAD).toFixed(0),
            veeringNow ? null : LOOK_AHEAD,
          ),
        ),
        tone: 'info',
      });
    }
    if (s.diag.luffing < 0.6) msgs.push({ text: t(ALERT.luffing), tone: 'warn' });
    if (Math.abs(s.diag.twa) * RAD < 35) msgs.push({ text: t(ALERT.noGo), tone: 'warn' });
    // Twist first: it is the cheapest way to give power back, and it is the one
    // the player is least likely to reach for on their own.
    if (Math.abs(s.state.heel) * RAD > 32)
      msgs.push({ text: t(PANEL.overpowered), tone: 'warn' });
    if (s.diag.froude > 0.95) msgs.push({ text: t(ALERT.hullSpeed), tone: 'info' });

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

/**
 * Six numbers, on a grid that cannot move.
 *
 * Chosen for what you cannot see by looking: speed, where the wind is, how hard
 * she is pressed, and what is under the keel. Heading is there because a
 * compass is the one thing the view genuinely cannot show you, and POL took
 * the grid's last slot because on a phone there is no polar card -- it is the
 * one place the panel can still say whether she is being sailed well.
 *
 * Only BSP carries emphasis here, where the full panel emphasises five. Not an
 * oversight: on a card this size one headline is a hierarchy and three is
 * noise, and every number on it already earned its place by being steered by.
 *
 * **A fixed grid and a fixed width, not `flex-wrap`.** Wrapping reflowed on the
 * data: `-96°` is wider than `-9°` and `100°` than `9°`, so the strip jumped
 * between two rows and four as the boat sailed, and a panel that changes shape
 * while you read it is worse than one that is slightly too big. Two columns and
 * three rows, always, whatever the numbers say.
 *
 * Foldable, because it still covers the top of a phone. Tapping it puts it away
 * -- the card itself, since it has nothing else a tap could mean -- and leaves
 * the one number worth having at a glance.
 */
function CompactInstruments() {
  const [open, setOpen] = useState(true);
  const t = useT();
  const speed = (s: Snapshot) => (s.diag ? msToKnots(s.diag.speed).toFixed(1) : '--');
  return (
    <Card
      onClick={() => setOpen((v) => !v)}
      className="pointer-events-auto w-[168px] cursor-pointer gap-0 px-2.5 py-1.5 backdrop-blur-md bg-card/85"
      title={t(open ? PANEL.fold : PANEL.unfold)}
    >
      {open ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <Gauge label="BSP" unit="kn" emphasis read={speed} />
          <Gauge label="TWA" read={(s) => (s.diag ? deg(s.diag.twa * RAD) : '--')} />
          <Gauge label="HDG" read={(s) => deg(wrap2Pi(s.state.heading) * RAD)} />
          <Gauge label="Heel" read={(s) => `${(s.state.heel * RAD).toFixed(0)}°`} />
          <Gauge label="Depth" unit="m" read={(s) => (s.clearance > 90 ? '--' : s.depth.toFixed(0))} />
          {/*
            The verdict number takes the grid's last free slot: on a phone
            there is no polar card and no room for TGT, so this is the one
            place the panel can still say whether she is being sailed well.
            It shows the same refusals as the full panel -- nothing in the
            no-go zone or a tide -- for the same reasons.
          */}
          <Gauge
            label="POL"
            unit="%"
            read={(s) => {
              const p = paceNow(s);
              return p ? (p.fraction * 100).toFixed(0) : '--';
            }}
          />
        </div>
      ) : (
        <Gauge label="BSP" unit="kn" emphasis read={speed} />
      )}
    </Card>
  );
}

/**
 * The chips that say what is steering and what is trimming itself.
 *
 * Written straight into the DOM per frame like every other readout, and not
 * through React. An older comment on this said the opposite -- that these
 * change rarely enough for plain state and a re-render -- and it had been left
 * behind by the conversion. The pilot's chip is why the conversion happened: it
 * carries the heading being steered, which moves continuously.
 */
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

/**
 * The panel, and a strip of it for a small screen.
 *
 * Compact is not the same panel scaled down -- at 390 px wide the full one
 * squeezed to 156 and ran its values into its labels. It is a different
 * selection: the six readings you steer by, and nothing you can look out of
 * the window for. Everything cut is still on the full panel the moment there
 * is room, and all of it is explained in the guide either way.
 */
export function Instruments({ compact = false }: { compact?: boolean }) {
  const t = useT();
  if (compact) return <CompactInstruments />;
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
          What she should be making here, and what she is making as a fraction
          of it. Directly under TWA and TWS on purpose: those are the two
          numbers this one is worked out from, so it reads as "given that wind
          at that angle, this".

          Boat speed alone cannot say whether five and a half knots was well
          sailed, because it says nothing about what was on offer. This is the
          number that turns a trim into a verdict -- ease a little and watch it
          climb -- and it is honest in a way a score is not: the target comes
          out of the same solver, the same CRUISER and the same physics she is
          being sailed by.
        */}
        <Gauge
          label="TGT"
          unit="kn"
          emphasis
          read={(s) => {
            const p = paceNow(s);
            return p ? msToKnots(p.target).toFixed(2) : '--';
          }}
        />
        <Gauge
          label="POL"
          unit="%"
          emphasis
          read={(s) => {
            const p = paceNow(s);
            return p ? (p.fraction * 100).toFixed(0) : '--';
          }}
        />
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
        {/*
          The third emphasised pair-and-a-half, with BSP/VMG and TGT/POL: the
          five numbers a helmsman actually sails by. Heel is the odd one out of
          the five in that it is the *limit* rather than the goal -- pressed
          hard on a beat her best speed comes in the high twenties of degrees
          and past that she is slower, not faster -- which is exactly why it
          earns the same weight as the numbers being chased.
        */}
        <Gauge label="Heel" emphasis read={(s) => `${(s.state.heel * RAD).toFixed(1)}°`} />
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

      <Fix />

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
