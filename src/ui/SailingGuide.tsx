/**
 * How to sail her, and what every number on screen means.
 *
 * The menu had a key list and nothing else, which answers "what does this
 * button do" and none of "why will the boat not go where I am pointing it".
 * Sailing has a large vocabulary and one genuinely counter-intuitive rule, and
 * a simulator that models both and explains neither is only legible to people
 * who already sail.
 *
 * **Every figure below is this boat's, measured, not a sailing textbook's.**
 * The angles come from `npm run polar` and move when the boat is tuned; a
 * guide quoting the usual "45 degrees" would have been wrong in light air and
 * wrong again in a gale, both of which this model gets right. Where the
 * simulator departs from a real yacht -- running dead downwind really is
 * fastest here, because there is no spinnaker -- it says so rather than
 * teaching something that is untrue of the thing in front of you.
 *
 * Kept as prose plus a glossary rather than an interactive tutorial: the boat
 * is the tutorial, and this is the thing you open when it is not obvious what
 * she is telling you.
 */

/** Column pairs for the glossary, in the order they appear on the panel. */
const GLOSSARY: [string, string][] = [
  ['BSP', 'Boat speed through the water. What the hull feels.'],
  ['SOG', 'Speed over the ground. Differs from BSP only when a tide runs.'],
  ['VMG', 'How fast you are closing on the wind — the number that matters upwind, not BSP.'],
  ['HDG', 'The way the bow points.'],
  ['COG', 'The way she is actually going. A tide sets these apart.'],
  ['TWS', 'True wind speed, as a fixed object would feel it.'],
  ['TWD', 'True wind direction: the bearing it blows from, not the one it blows towards.'],
  ['TWA', 'True wind angle: where the wind is relative to the bow. 0 is dead ahead, 180 dead astern. Negative is over the port side.'],
  ['AWS', 'Apparent wind speed — what the boat feels, wind plus her own motion. Always more than TWS on a beat, less on a run.'],
  ['AWA', 'Apparent wind angle, read at the masthead, which is where a real vane is.'],
  ['Heel', 'How far she is leaning. Her best speed on the wind comes at about 27°; heel harder than that and she goes slower, not faster.'],
  ['Leeway', 'The angle between where she points and where she goes. The keel needs it to make side force at all.'],
  ['Sheet', 'How far the sail is let out from the centreline.'],
  ['Twist', 'How much more the top of the sail is eased than the foot. The second number is what the auto-trim would choose.'],
  ['AoA', "The sail's angle of attack. Too little and it flaps, too much and it stalls."],
  ['Sea', 'Significant wave height — the average of the biggest third, which is what an eye on deck reports.'],
  ['Depth', 'Water under the keel. She draws 1.8 m.'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2 text-[11px] leading-relaxed">{children}</div>
    </section>
  );
}

export function SailingGuide() {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <p className="text-[11px] leading-relaxed">
          <span className="font-medium text-warning">
            A boat cannot sail at the wind.
          </span>{' '}
          Head straight at it and she stops. There is no wall — she comes to a
          stand gradually — but everything else below follows from it.
        </p>
      </div>

      <Section title="Going upwind">
        <p>
          You cannot go straight there, so you zig-zag: sail as close to the
          wind as she will go, then turn through it and do the same on the other
          side. Each turn is a <em>tack</em>.
        </p>
        <p>
          How close is worth knowing, because the edge is not sharp. Measured in
          a 12 knot breeze, pointing at the wind she makes{' '}
          <strong>0.6 knots</strong> — stopped. At 20° off, 1.1. At 30°, 3.0,
          and she is properly sailing. At 45° she does 5.0 and is making the
          most ground to windward she can. So the cost of pointing too high
          creeps up on you rather than announcing itself.
        </p>
        <p>
          The best angle is not a constant, and this boat has been measured at
          it. In a working breeze she wants <strong>45° off the wind</strong>,
          which means 90° between the two tacks. In very light air she needs
          <strong> 50°</strong> to keep moving at all, and by 35 knots she is
          down to <strong>55°</strong> because she cannot carry sail closer.
          Pinching higher than that feels faster and is not.
        </p>
        <p>
          Steer by <strong>VMG</strong>, not boat speed. VMG is speed made good
          towards the wind; bearing away makes BSP rise and VMG fall. The polar
          panel draws the whole curve with a marker for where you are, so the
          gap between the two is exactly what you are leaving out there.
        </p>
      </Section>

      <Section title="Reaching and running">
        <p>
          Across the wind is where she is quickest through the water —{' '}
          <strong>TWA 90–100°</strong>, and 6.9 knots of it in a 20 knot breeze
          against 5.4 on the wind.
        </p>
        <p>
          Downwind, point straight at where you are going.{' '}
          <span className="text-muted-foreground">
            This is the one place this boat is not a racing yacht: she carries
            no spinnaker, so there is nothing to gain by gybing downwind and
            dead astern really is the fastest way to leeward here.
          </span>
        </p>
      </Section>

      <Section title="Trimming the sail">
        <p>
          The sheet sets how far the sail is let out; the vang sets how much the
          top twists away from the foot. Both change the{' '}
          <strong>angle of attack</strong>, and the AoA readout is what to watch:
          too little and the sail flaps, too much and it stalls and she heels
          without going anywhere.
        </p>
        <p>
          The rule of thumb is to ease until it just flaps, then take it back in.
          Or press <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">T</kbd>{' '}
          and let her trim herself while you concentrate on steering — the
          instrument panel shows the twist she would have chosen either way.
        </p>
      </Section>

      <Section title="When it comes on to blow">
        <p>
          Too much sail in too much wind does not go faster; it lies the boat
          over and stops her. Measured on a beat, she is quickest at{' '}
          <strong>5.4 knots in a 16 knot breeze</strong>, pressed to 27° of
          heel. Give her 30 knots of wind and the same sail and she does{' '}
          <strong>4.6</strong> — half as much wind again, and slower for it.
        </p>
        <p>
          Reduce sail with{' '}
          <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">1</kbd>–
          <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">4</kbd>{' '}
          for the main and{' '}
          <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">F</kbd>{' '}
          to roll away the jib, or set auto-reef with{' '}
          <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">Y</kbd>{' '}
          and let her decide. Heel is the gauge to watch.
        </p>
      </Section>

      <Section title="Water and tide">
        <p>
          Depth is real and so is the bottom: she draws 1.8 m and will stop hard
          on anything shallower. In a surveyed region the chart is the same data
          the hull grounds on, so the shoal you can see is the one you will
          touch.
        </p>
        <p>
          When a tide runs, <strong>SOG</strong> and <strong>COG</strong> part
          company with BSP and HDG — she is being carried sideways as well as
          driven forward. Point at a mark and the tide will set you off it; the
          chart's arrows show which way. Working the shallows to escape a foul
          tide is the oldest trick there is, and it costs breeze and eventually
          the keel.
        </p>
      </Section>
      <Section title="Every reading on the panel">
        <dl className="grid grid-cols-[52px_1fr] gap-x-3 gap-y-1.5">
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term} className="contents">
              <dt className="font-mono text-[10px] uppercase tracking-wide text-foreground">
                {term}
              </dt>
              <dd className="text-[11px] leading-relaxed text-muted-foreground">
                {meaning}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
