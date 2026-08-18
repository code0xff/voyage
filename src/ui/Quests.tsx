import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, Download, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { questStore } from '@/quests-store';
import {
  emptyQuestState,
  questProgress,
  readPack,
  type Completion,
  type PackProblem,
  type Quest,
  type QuestPack,
  type QuestState,
} from '@/sim/quest';
import { formatLatLon } from '@/sim/globe';
import { STARTER_PACK } from '@/sim/starter';
import { saveFile } from './save-file';
import { formatWhen } from '@/sim/units';
import { BELT, QUEST, WEATHER } from './strings';
import { useLang, useT } from './i18n';
import type { Phrase } from '@/i18n';

/**
 * The quest screens, and why there are two of them.
 *
 * A pack is somebody else's file that changes what the game notices, which
 * makes it a setting -- it sits beside the world and the conditions. What you
 * have done with one is a record, and a record gets its own screen, the way
 * the logbook does. Splitting them means the read-only screen stays readable:
 * it is a list of things done and things left, with nothing to press.
 */

/** A quest's name in the reader's language, falling back to the English. */
const say = (of: Record<string, string> | undefined, lang: string): string =>
  of?.[lang] ?? of?.en ?? '';

/** Everything a completion knew, in the order a logbook entry would say it. */
function Detail({ of }: { of: Completion }) {
  const t = useT();
  const m = of.moment;
  const bits = [
    m.belt ? t(BELT[m.belt as keyof typeof BELT] ?? { en: m.belt, ko: m.belt }) : null,
    m.weather in WEATHER ? t(WEATHER[m.weather as keyof typeof WEATHER]) : null,
    `${m.wind.toFixed(0)} kn`,
    `${m.sea.toFixed(1)} m`,
    `${m.heel.toFixed(0)}°`,
    // Open water reports no bottom, and saying "9007199254740991 m" would be
    // worse than saying nothing. A negative one is not a depth either: she
    // was over the ground, which is a thing to say in words.
    m.depth <= 0 ? t(QUEST.aground) : m.depth < 100_000 ? `${m.depth.toFixed(0)} m` : null,
    `${String(Math.floor(m.hour)).padStart(2, '0')}:${String(
      Math.floor((m.hour % 1) * 60),
    ).padStart(2, '0')}`,
  ].filter(Boolean);
  return (
    <div className="pl-4 pt-0.5 text-[10px] leading-relaxed text-muted-foreground">
      <div className="font-mono tabular-nums">{bits.join(' · ')}</div>
      <div className="font-mono tabular-nums">
        {t(QUEST.thisPassage)} {of.passage.miles.toFixed(1)} nm · {t(QUEST.allTold)}{' '}
        {of.total.miles.toFixed(1)} nm
      </div>
    </div>
  );
}

/** One quest: what it is, and either when it was done or how far along it is. */
function Row({ quest, id, state }: { quest: Quest; id: string; state: QuestState }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const done = state.done[id];
  const progress = done ? null : questProgress(quest, state);
  const where = done?.moment.place ? formatLatLon(done.moment.place) : t(QUEST.atSea);
  return (
    <div>
      <button
        type="button"
        // Only a completed one opens: there is nothing to show for a quest
        // that has not happened yet, and a row that looks pressable and does
        // nothing is worse than one that does not.
        disabled={!done}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className={cn('text-[11px]', done ? 'text-foreground' : 'text-muted-foreground/60')}>
          {done && <ChevronRight className={cn('mr-0.5 inline size-3', open && 'rotate-90')} />}
          {say(quest.name, lang)}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {done
            ? `${formatWhen(done.at, lang)} · ${where}`
            : progress
              ? `${Math.floor(progress.at)} / ${progress.needs}`
              : ''}
        </span>
      </button>
      {done && open && <Detail of={done} />}
      {!done && quest.note && (
        <div className="pl-4 text-[10px] leading-relaxed text-muted-foreground/60">
          {say(quest.note, lang)}
        </div>
      )}
    </div>
  );
}

/** The read-only screen: what has been done, and what is left. */
export function Quests({ version }: { version: number }) {
  const t = useT();
  const [packs, setPacks] = useState<QuestPack[] | null>(null);
  const [state, setState] = useState<QuestState>(emptyQuestState());

  /*
   * Read from the store rather than from the engine, and not because the
   * store is better: this screen is rendered outside the engine's provider,
   * because the menu is up before the engine has loaded. The engine writes a
   * completion down the moment it happens for exactly this reason -- the
   * tallies may lag half a minute behind, and a completion never does.
   */
  useEffect(() => {
    let alive = true;
    void Promise.all([questStore.packs(), questStore.state()]).then(([p, s]) => {
      if (!alive) return;
      setPacks(p);
      setState(s ?? emptyQuestState());
    });
    return () => {
      alive = false;
    };
  }, [version]);

  if (packs === null) return null;
  if (packs.length === 0) {
    return <p className="py-3 text-[11px] leading-relaxed text-muted-foreground">{t(QUEST.noPacks)}</p>;
  }

  const total = packs.reduce((n, p) => n + p.quests.length, 0);
  const done = packs.reduce(
    (n, p) => n + p.quests.filter((q) => state.done[`${p.id}.${q.id}`]).length,
    0,
  );

  return (
    <div>
      <div className="flex items-baseline justify-between pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t(QUEST.done)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {done} / {total}
        </span>
      </div>
      <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
        {packs.map((pack) => (
          <div key={pack.id}>
            <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
              <span className="text-[11px] font-medium">{pack.name}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {pack.quests.filter((q) => state.done[`${pack.id}.${q.id}`]).length} /{' '}
                {pack.quests.length}
              </span>
            </div>
            <div className="space-y-1 pt-1">
              {pack.quests.map((q) => (
                <Row key={q.id} quest={q} id={`${pack.id}.${q.id}`} state={state} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The example file: the pack that ships with the game, serialised.
 *
 * Handing out the real thing rather than a written-out sample is the point.
 * It is the format's documentation, it is a pack that demonstrably installs
 * -- it is the one the game itself put in -- and because it carries the same
 * id, an edited copy installed back *replaces* it, which is what someone
 * learning the format will want to do first.
 *
 * A component rather than a function because it is offered in two places: at
 * the install button, where the decision is made, and in the guide, where
 * somebody is reading about the format and should not have to go and find it.
 */
export function SamplePack() {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => saveFile('voyage-quest-pack.json', JSON.stringify(STARTER_PACK, null, 2))}
    >
      <Download /> {t(QUEST.sample)}
    </Button>
  );
}

/**
 * The settings tab: which packs are installed, and the things that can be
 * done about it.
 *
 * The note under it is not decoration. Installing a stranger's file is a
 * thing people are right to be careful about, and the honest answer -- it can
 * only notice, nothing in it is run -- is worth saying where the decision is
 * made rather than in a document nobody opens.
 */
export function QuestPacks({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [packs, setPacks] = useState<QuestPack[]>([]);
  const [problem, setProblem] = useState<PackProblem | null>(null);

  const reload = () =>
    void questStore.packs().then((p) => {
      setPacks(p);
      onChanged();
    });
  useEffect(reload, []);

  const install = async (file: File) => {
    setProblem(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setProblem({ kind: 'notAPack' });
      return;
    }
    const read = readPack(raw);
    if ('problem' in read) {
      setProblem(read.problem);
      return;
    }
    await questStore.install(read.pack);
    reload();
  };

  return (
    <div className="space-y-2">
      {packs.length > 0 && (
        <div className="space-y-1">
          {packs.map((pack) => (
            <div key={pack.id} className="flex items-baseline justify-between gap-2">
              <span className="text-[11px]">
                {pack.name}
                <span className="pl-2 text-[10px] text-muted-foreground">
                  {pack.author ? `${pack.author} · ` : ''}
                  {pack.quests.length}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() =>
                  void questStore.remove(pack.id).then(reload)
                }
              >
                <Trash2 /> {t(QUEST.remove)}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            <Upload /> {t(QUEST.install)}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void install(f);
                // Cleared so the same file can be picked again after a fix.
                e.target.value = '';
              }}
            />
          </label>
        </Button>
        <SamplePack />
      </div>
      {problem && (
        <p className="text-[10px] leading-relaxed text-warning">
          {t((QUEST[problem.kind] ?? QUEST.notAPack) as Phrase)}
          {problem.named ? ` ${problem.named}` : ''}
          {problem.quest ? ` (${problem.quest})` : ''}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {t(QUEST.packNote)} {t(QUEST.sampleNote)}
      </p>
    </div>
  );
}
