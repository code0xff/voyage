import { useState } from "react";
import { Anchor, Compass, Play, Settings2, Waves, Wind } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatTime, type Course, type RaceState } from "@/sim/race";
import { formatClock } from "@/sim/sky";
import { WEATHER_KINDS, WEATHER_LABEL, type WeatherKind } from "@/sim/weather";
import type { Settings } from "@/settings";
import { cn } from "@/lib/utils";

export interface RaceResult {
  time: number;
  isBest: boolean;
  race: RaceState;
  course: Course;
  best: number | null;
}

/** A labelled range control. Sliders read better than numeric inputs for conditions. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr_64px] items-center gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-foreground
                   [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
      />
      <span className="text-right font-mono text-[11px] tabular-nums">
        {format(value)}
      </span>
    </div>
  );
}

function Results({ result }: { result: RaceResult }) {
  const labels = result.course.legs.map((l) => l.label);
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-4">
      <div className="text-center font-mono text-3xl tabular-nums text-success">
        {formatTime(result.time)}
      </div>
      <div className="mt-1 text-center text-[11px]">
        {result.isBest ? (
          <span className="text-warning">
            New personal best — ghost updated
          </span>
        ) : result.best !== null ? (
          <span className="text-muted-foreground">
            Personal best {formatTime(result.best)} ·{" "}
            {result.time - result.best >= 0 ? "+" : ""}
            {(result.time - result.best).toFixed(1)}s
          </span>
        ) : null}
      </div>
      <Separator className="my-3" />
      <div className="space-y-0.5">
        {result.race.splits.map((t, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_58px] gap-3 font-mono text-[10.5px] tabular-nums text-muted-foreground"
          >
            <span className="truncate font-sans">{labels[i] ?? ""}</span>
            <span>{formatTime(t)}</span>
            <span className="text-right opacity-70">
              +{(t - (i === 0 ? 0 : result.race.splits[i - 1])).toFixed(1)}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MenuDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
  onStartRace,
  onFreeSail,
  result,
  canResume,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onStartRace: () => void;
  onFreeSail: () => void;
  result: RaceResult | null;
  canResume: boolean;
}) {
  const [tab, setTab] = useState("race");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onSettings({ ...settings, [k]: v });

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      className="max-w-[560px]"
      title={
        <span className="flex items-center gap-2">
          <Anchor className="size-4 text-info" />
          <span className="text-lg font-medium tracking-[0.2em]">VOYAGE</span>
        </span>
      }
      description={
        <span className="block text-[11px] leading-relaxed">
          A sailing simulator that computes apparent wind, sail lift, keel side
          force and wave-making resistance. Wind differs from place to place,
          weather turns, and land steals your breeze.
        </span>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <Badge variant="outline" className="text-[10px] font-normal">
            physics core runs headless · npm run polar
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            seed {settings.seed}
          </span>
        </div>
      }
    >
      <div>
        {result && (
          <div className="mb-4">
            <Results result={result} />
          </div>
        )}

        {/* Two buttons that throw the current session away, and -- on its own
            row, because it is not one of them -- the one that keeps it. Wedged
            in beside them it was both cramped and easy to mistake for a third
            way to start something. */}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onStartRace}>
            <Play /> Start race
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onFreeSail}>
            <Compass /> Free sail
          </Button>
        </div>
        {canResume && (
          <Button variant="outline" className="mt-2 w-full" onClick={() => onOpenChange(false)}>
            Resume
            <span className="text-muted-foreground">· Esc</span>
          </Button>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="race" className="flex-1">
              <Settings2 /> Course
            </TabsTrigger>
            <TabsTrigger value="conditions" className="flex-1">
              <Wind /> Conditions
            </TabsTrigger>
            <TabsTrigger value="keys" className="flex-1">
              <Waves /> Controls
            </TabsTrigger>
          </TabsList>

          <TabsContent value="race" className="mt-4 space-y-2.5">
            <Slider
              label="Leg length"
              min={150}
              max={1000}
              step={10}
              value={settings.legLength}
              format={(v) => `${v} m`}
              onChange={(v) => set("legLength", v)}
            />
            <Slider
              label="Laps"
              min={1}
              max={5}
              step={1}
              value={settings.laps}
              format={(v) => String(v)}
              onChange={(v) => set("laps", v)}
            />
            <Slider
              label="Countdown"
              min={5}
              max={180}
              step={5}
              value={settings.countdown}
              format={(v) => `${v}s`}
              onChange={(v) => set("countdown", v)}
            />
            <Slider
              label="Islands"
              min={0}
              max={10}
              step={1}
              value={settings.islandCount}
              format={(v) => (v === 0 ? "open sea" : `${v}/10`)}
              onChange={(v) => set("islandCount", v)}
            />
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                World seed
              </span>
              <div className="flex gap-2">
                <input
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  value={settings.seed}
                  disabled={settings.randomWorld}
                  onChange={(e) => set("seed", Number(e.target.value) || 1)}
                />
                <Button
                  variant={settings.randomWorld ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => set("randomWorld", !settings.randomWorld)}
                >
                  {settings.randomWorld ? "New each race" : "Pinned"}
                </Button>
              </div>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              The ocean has no edge: islands keep coming over the horizon for as
              long as you sail. Their lee is flat water but almost no wind, and
              the shoals around them will stop you dead. Pin the seed to race the
              same water twice.
            </p>
          </TabsContent>

          <TabsContent value="conditions" className="mt-4 space-y-2.5">
            <Slider
              label="Mean wind"
              min={3}
              max={40}
              step={1}
              value={settings.windKnots}
              format={(v) => `${v} kn`}
              onChange={(v) => set("windKnots", v)}
            />
            <Slider
              label="Gusts / shifts"
              min={0}
              max={1}
              step={0.05}
              value={settings.gustiness}
              format={(v) => (v === 0 ? "steady" : `${Math.round(v * 100)}%`)}
              onChange={(v) => set("gustiness", v)}
            />
            <Slider
              label="Sea state"
              min={0}
              max={2}
              step={0.1}
              value={settings.seaScale}
              format={(v) => (v === 0 ? "flat" : `${v.toFixed(1)}x`)}
              onChange={(v) => set("seaScale", v)}
            />
            <Slider
              label="Start time"
              min={0}
              max={23.5}
              step={0.5}
              value={settings.startHour}
              format={(v) => formatClock(v)}
              onChange={(v) => set("startHour", v)}
            />
            <Slider
              label="Time speed"
              min={0}
              max={360}
              step={10}
              value={settings.timeScale}
              format={(v) => (v === 0 ? "frozen" : `${v}x`)}
              onChange={(v) => set("timeScale", v)}
            />
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Weather</span>
              <Select
                value={settings.weatherMode}
                onValueChange={(v) =>
                  set("weatherMode", v as "auto" | WeatherKind)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Evolving (random)</SelectItem>
                  {WEATHER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {WEATHER_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              Evolving weather is what makes two runs of the same course
              different. A squall on the second beat forces a reef and changes
              which side pays.
            </p>
          </TabsContent>

          <TabsContent value="keys" className="mt-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                ["← →  /  A D", "helm (holds its angle)"],
                ["Space", "centre the helm"],
                ["↑ ↓  /  W S", "trim in / ease"],
                ["T", "auto-trim"],
                ["1 2 3 4", "reef 0–3"],
                ["F / G", "furl / unfurl jib"],
                ["Y", "auto-reef"],
                ["Q E", "mean wind direction"],
                ["C", "camera"],
                ["N", "chart range"],
                ["drag", "orbit around the boat"],
                ["wheel", "zoom"],
                ["double-click", "recentre astern"],
                ["P", "re-solve polar"],
                ["R", "restart"],
                ["M", "sound"],
                ["Esc", "this menu"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3"
                >
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-px font-mono text-[10px]">
                    {k}
                  </kbd>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
            <div
              className={cn(
                "mt-4 rounded-md border border-warning/40 bg-warning/10 p-3",
              )}
            >
              <p className="text-[11px] leading-relaxed">
                <span className="font-medium text-warning">
                  You cannot sail at the windward mark.
                </span>{" "}
                Zig-zag up to it at roughly 45° to the wind. The polar panel
                shows the best angle.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>
  );
}
