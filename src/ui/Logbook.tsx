import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Trash2, Upload } from 'lucide-react';
import { fromExport, toExport, type LogStore } from '@/logbook';
import { useLang, useT } from './i18n';
import { LOG } from './strings';
import { formatDistance, formatDuration, formatWhen, msToKnots } from '@/sim/units';
import { venueById } from '@/sim/venues';
import { placeName } from '@/sim/regions';
import type { PassageRecord, SightingKind } from '@/sim/passage';
import type { Phrase } from '@/i18n';

/**
 * The logbook.
 *
 * A record, not a scoreboard. There is no ranking, no personal best and no
 * comparison between passages, because the point of writing a passage down is
 * that it happened -- and a table sorted by speed would quietly turn a calm
 * game back into a race.
 *
 * Ordinary React state: this changes when a passage ends or a file is imported,
 * which is nothing like every frame.
 */

/**
 * The two counts, in the order they are worth reading, with the words for one
 * and for more than one.
 *
 * A table rather than a branch so that adding a kind is adding a row. Korean
 * repeats itself here on purpose -- see the note in `strings.ts`.
 */
const SIGHTINGS: { key: SightingKind; one: Phrase; many: Phrase }[] = [
  { key: 'whales', one: LOG.whale, many: LOG.whales },
  { key: 'sharks', one: LOG.shark, many: LOG.sharks },
];

function Entry({ p, onRemove }: { p: PassageRecord; onRemove: () => void }) {
  const t = useT();
  const lang = useLang();
  // Absent and zero mean different things -- a record from before any of this
  // was counted, against a passage that really did see nothing -- but they print
  // the same, which is nothing, so one filter serves both and the distinction
  // stays where it matters, in the record.
  const seen = SIGHTINGS.map(({ key, one, many }) => ({ n: p.sightings?.[key] ?? 0, one, many }))
    .filter(({ n }) => n > 0)
    .map(({ n, one, many }) => `${n} ${t(n === 1 ? one : many)}`);
  return (
    <div className="group grid grid-cols-[1fr_auto] items-start gap-2 border-b border-border/60 py-2 last:border-0">
      <div>
        <div className="text-[11px]">
          {placeName(p.venue, (id) => venueById(id)?.name ?? null)}
          {/* The chosen language, not the browser's. The same passage's date is
              on the front page through `LastPassage`, which already passes it,
              and the two read differently without this. */}
          <span className="ml-2 text-[10px] text-muted-foreground">
            {formatWhen(p.startedAt, lang)}
          </span>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatDuration(p.duration)} · {formatDistance(p.distance)} ·{' '}
          {msToKnots(p.avgSog).toFixed(1)} {t(LOG.avg)} ·{' '}
          {msToKnots(p.maxSog).toFixed(1)} {t(LOG.max)} · {p.windKnots.toFixed(0)}{' '}
          {t(LOG.wind)}
          {/*
            How much was tacked, which is the number here a sailor reads first:
            a beat is about 1.4, a reach about 1. Shown only when it means
            something -- a track shorter than the straight line between its own
            ends is impossible for a boat that sailed it, so a record claiming
            one came from an edited file and the ratio is not a fact about a
            passage.
          */}
          {p.direct > 1 && p.distance >= p.direct && (
            <>
              {' '}
              · {(p.distance / p.direct).toFixed(2)}
              {t(LOG.straightLine)}
            </>
          )}
        </div>
        {/*
          Its own line, and not the monospace one above. Everything up there is
          how well the passage was sailed, and a whale is not that -- set in the
          same tabular column as the top speed it would read as another score,
          which is the one thing this panel is careful not to be.
        */}
        {seen.length > 0 && (
          <div className="text-[10px] text-muted-foreground">{seen.join(' · ')}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={t(LOG.remove)}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function Logbook({
  store,
  version,
  onChanged,
}: {
  store: LogStore;
  version: number;
  /**
   * Called after this panel writes to the store, so that whoever owns `version`
   * can bump it and everything reading the logbook reloads together.
   *
   * The panel used to just reload itself, which was enough while it was the
   * only thing showing a passage. It is not: the front page shows the last one,
   * and deleting that one here left it sitting on the way in, naming a passage
   * that no longer existed.
   */
  onChanged: () => void;
}) {
  const t = useT();
  const [passages, setPassages] = useState<PassageRecord[] | null>(null);
  /**
   * What went wrong, kept as a phrase rather than as translated text.
   *
   * Storing `t(...)` froze the message in whichever language was current when
   * it failed, so switching language left the error behind in the old one --
   * on the one panel where the reader is already confused. It is translated at
   * render instead, which is also what lets `reload` stay out of the language's
   * way: nothing here captures the translator.
   */
  const [problem, setProblem] = useState<Phrase | null>(null);
  /**
   * Which read is the newest.
   *
   * The store is async, so two reloads in flight -- an import finishing while a
   * version bump lands, say -- can come back in either order, and the slower one
   * would overwrite the newer answer with an older logbook.
   */
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    // Null while loading rather than an empty array, so an empty logbook and a
    // logbook that has not answered yet do not print the same thing.
    store.list().then(
      (rows) => {
        if (mine !== generation.current) return;
        setPassages(rows);
        // Deliberately does not clear `problem`. Reading the list back is how
        // every write finishes, so clearing it here wiped the message the write
        // had just set: a failed delete reported itself for one frame and then
        // silently un-reported itself. Whoever succeeded clears it.
      },
      () => {
        if (mine !== generation.current) return;
        // An empty list rather than a permanent spinner: the reader must not be
        // able to leave the panel saying "reading" forever, which is what an
        // unhandled rejection did.
        setPassages([]);
        setProblem(LOG.readFailed);
      },
    );
  }, [store]);

  // `version` is bumped by whoever knows a passage was written. Reloading on it
  // rather than polling keeps this asleep for the whole time the menu is shut.
  useEffect(reload, [reload, version]);

  const download = () => {
    const blob = new Blob([JSON.stringify(toExport(passages ?? [], Date.now()), null, 1)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voyage-logbook-${new Date().toISOString().slice(0, 10)}.json`;
    // Keep the anchor in the document until the click has been dispatched. A
    // URL revoked on the next line can cancel a download in browsers that have
    // not consumed the Blob yet, so release it on the next task instead.
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const upload = (file: File) => {
    void file.text().then(
      async (raw) => {
        const rows = fromExport(raw);
        if (!rows) {
          setProblem(LOG.notALogbook);
          return;
        }
        try {
          // Added rather than replacing, and keyed on the record's own id, so
          // importing the same file twice is the same logbook and not two of it.
          for (const r of rows) await store.add(r);
          setProblem(null);
        } catch {
          setProblem(LOG.partlySaved);
        } finally {
          // Announced either way. A partial import has written real rows, and
          // leaving them off the screen would show a logbook that is not the
          // one on disk.
          onChanged();
        }
      },
      () => setProblem(LOG.fileUnreadable),
    );
  };

  const remove = (id: string) =>
    void store.remove(id).then(
      () => {
        setProblem(null);
        onChanged();
      },
      () => {
        setProblem(LOG.removeFailed);
        // Announced on the failure too: the row may or may not have gone, and
        // every reader has to end up looking at the store either way.
        onChanged();
      },
    );

  if (passages === null) {
    return <p className="py-4 text-[11px] text-muted-foreground">{t(LOG.reading)}</p>;
  }

  return (
    <div>
      {passages.length === 0 ? (
        <p className="py-3 text-[11px] leading-relaxed text-muted-foreground">
          {t(LOG.empty)}
        </p>
      ) : (
        <div className="max-h-[260px] overflow-y-auto pr-1">
          {passages.map((p) => (
            <Entry
              key={p.id}
              p={p}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={download} disabled={passages.length === 0}>
          <Download /> {t(LOG.export)}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            <Upload /> {t(LOG.import)}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                // Cleared so the same file can be picked again after a mistake.
                e.target.value = '';
              }}
            />
          </label>
        </Button>
      </div>
      {/*
        The logbook lives in this browser. Saying so where the export button is
        is the only honest place for it: that button is the answer, and a player
        who never finds it can lose a year of passages to a routine clear of
        site data without ever having been told.
      */}
      {problem && <p className="pt-2 text-[10px] text-destructive">{t(problem)}</p>}
      <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
        {t(LOG.kept)}
      </p>
    </div>
  );
}
