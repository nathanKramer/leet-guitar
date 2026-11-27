/**
 * Moving notes between tracks of different kinds (copy on one track, paste on another).
 * The clipboard keeps each note's real pitch; placing it on the target track turns that
 * pitch back into a lane and fret for that instrument.
 */
import { isStringed } from './instruments';
import type { PatternNote, Track, TrackKind } from './types';

export type ClipNote = PatternNote;

/** Copy the named fields that are present (palm mute is only stored when set). */
function pick<T extends object, K extends keyof T>(o: T, ...keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export interface Clip {
  kind: TrackKind;
  tuning: number[];
  notes: ClipNote[];
}

export interface PlacedNote {
  string: number;
  fret: number;
  offset: number;
  duration: number;
  velocity: number;
  palmMute?: boolean;
}

export interface Placement {
  notes: PlacedNote[];
  /** Notes moved up or down by octaves to fit the target's range. */
  octaveShifted: number;
  /** Notes that couldn't be placed (e.g. a 7-note chord on a 6-string, or a drum the kit lacks). */
  dropped: number;
  /** Drums and pitched instruments don't translate into each other. */
  refused: boolean;
}

/** Guitar/bass: stretches beyond this many frets are heavily penalised. */
const COMFORTABLE_SPAN = 3;
/** Hand position assumed for a passage that starts on open strings only. */
const START_HAND = 1;

function sameTuning(a: number[], b: number[]) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/** Shift a pitch by whole octaves into [lo, hi]; returns null if the range is narrower than an octave and it can't fit. */
function fitPitch(pitch: number, lo: number, hi: number): number | null {
  let p = pitch;
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p >= lo && p <= hi ? p : null;
}

/** Drum hits only go on drum tracks; pitched notes (guitar, bass, piano) go on any pitched track. */
export function canPlace(from: TrackKind, to: TrackKind): boolean {
  return (from === 'drums') === (to === 'drums');
}

export function placeClip(clip: Clip, target: Track): Placement {
  const result: Placement = { notes: [], octaveShifted: 0, dropped: 0, refused: false };
  if (!canPlace(clip.kind, target.kind)) return { ...result, refused: true };
  const toDrums = target.kind === 'drums';

  // Identical instrument: keep exactly what was copied, fingering included.
  if (clip.kind === target.kind && sameTuning(clip.tuning, target.tuning)) {
    for (const n of clip.notes) {
      if (n.fret <= target.frets) result.notes.push({ ...n });
      else result.dropped++;
    }
    return result;
  }

  // Drum kit to a different kit, and piano: one lane per pitch.
  if (toDrums || !isStringed(target.kind)) {
    const lo = Math.min(...target.tuning);
    const hi = Math.max(...target.tuning);
    for (const n of clip.notes) {
      const pitch = toDrums ? n.pitch : fitPitch(n.pitch, lo, hi);
      const lane = pitch === null ? -1 : target.tuning.indexOf(pitch);
      if (lane < 0) {
        result.dropped++;
        continue;
      }
      if (pitch !== n.pitch) result.octaveShifted++;
      result.notes.push({ string: lane, fret: 0, offset: n.offset, duration: n.duration, velocity: n.velocity });
    }
    return result;
  }

  if (isStringed(clip.kind)) return matchStrings(clip, target, result);
  return fretClip(clip.notes, target, result);
}

/** Octave offsets tried when lining up one stringed instrument's strings with another's, preferred first. */
const STRING_OFFSETS = [0, -12, 12, -24, 24];

/**
 * Guitar/bass to a guitar/bass with different strings: line the strings up and keep the tab where they match.
 * Find the whole-octave offset at which the most copied notes sit on a source string whose open pitch is one
 * of the target's open strings (guitar to bass is usually an octave down: a guitar's low B string lands on a
 * 5-string bass's low B, its E on the bass's E). Notes on those strings keep their fret. Notes on strings with
 * no counterpart (a guitar's top strings on a bass) move by the same octave and are fingered by pitch, around
 * the strings the matched notes already use. If no strings line up, everything is fingered by pitch.
 */
function matchStrings(clip: Clip, target: Track, result: Placement): Placement {
  const counterpart = (n: ClipNote, offset: number) => {
    const s = target.tuning.indexOf(clip.tuning[n.string] + offset);
    return s >= 0 && n.fret <= target.frets ? s : -1;
  };
  let best = 0;
  let bestCount = 0;
  for (const offset of STRING_OFFSETS) {
    const count = clip.notes.filter((n) => counterpart(n, offset) >= 0).length;
    if (count > bestCount) (best = offset), (bestCount = count);
  }
  if (!bestCount) return fretClip(clip.notes, target, result);

  const rest: ClipNote[] = [];
  const taken = new Map<number, Set<number>>();
  for (const n of clip.notes) {
    const s = counterpart(n, best);
    if (s < 0) {
      rest.push({ ...n, pitch: n.pitch + best });
      continue;
    }
    result.notes.push({ string: s, fret: n.fret, ...pick(n, 'offset', 'duration', 'velocity', 'palmMute') });
    taken.set(n.offset, (taken.get(n.offset) ?? new Set()).add(s));
  }
  return rest.length ? fretClip(rest, target, result, taken) : result;
}

export interface Spot {
  string: number;
  fret: number;
}

interface Fingering {
  /** One entry per pitch in the group (high to low); null = left out. */
  spots: Array<Spot | null>;
  /** How awkward the shape is on its own (stretch, left-out notes, height up the neck). */
  cost: number;
}

/** How many candidate shapes per chord the position search considers. */
const CANDIDATES = 8;
/** Frets the fretting hand covers without moving (index finger at `p` reaches p..p+3). */
const HAND_REACH = 3;

/**
 * Cost of moving the hand from one position to another. Any move costs something, so staying in one
 * position wins over sliding along a string, even when each slide is small.
 */
function shiftCost(from: number, to: number): number {
  return from === to ? 0 : 1 + 0.3 * Math.abs(from - to);
}

/** Hand positions (index-finger fret) from which a shape's fretted notes are all in reach. */
function handPositions(spots: Array<Spot | null>): number[] | null {
  const frets = spots.filter((x): x is Spot => !!x && x.fret > 0).map((x) => x.fret);
  if (!frets.length) return null; // only open strings: the hand can be anywhere
  const lo = Math.max(1, Math.max(...frets) - HAND_REACH);
  const hi = Math.min(...frets);
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) out.push(p);
  // A stretch wider than the hand's reach still gets a position (its cost already penalises it).
  return out.length ? out : [hi];
}

/**
 * Guitar/bass target: choose a string and fret for every note, for the whole passage at once. `taken` lists
 * strings already used at an offset (by notes placed some other way), which these notes must avoid.
 */
function fretClip(
  notes: ClipNote[],
  target: Track,
  result: Placement,
  taken: Map<number, Set<number>> = new Map(),
): Placement {
  const lo = Math.min(...target.tuning);
  const hi = Math.max(...target.tuning) + target.frets;
  const byOffset = new Map<number, ClipNote[]>();
  for (const n of notes) {
    const pitch = fitPitch(n.pitch, lo, hi);
    if (pitch === null) {
      result.dropped++;
      continue;
    }
    if (pitch !== n.pitch) result.octaveShifted++;
    const group = byOffset.get(n.offset) ?? [];
    group.push({ ...n, pitch });
    byOffset.set(n.offset, group);
  }

  // Chords in time order, one note per pitch, no more notes than strings.
  const groups = [...byOffset.keys()]
    .sort((a, b) => a - b)
    .map((offset) => {
      let group = byOffset.get(offset)!;
      const seen = new Set<number>();
      const unique = group.filter((n) => (seen.has(n.pitch) ? false : (seen.add(n.pitch), true)));
      result.dropped += group.length - unique.length;
      group = unique.sort((a, b) => b.pitch - a.pitch);
      if (group.length > target.tuning.length) {
        // Keep the top and bottom voices; drop inner ones.
        const keep = [...group.slice(0, target.tuning.length - 1), group[group.length - 1]];
        result.dropped += group.length - keep.length;
        group = keep;
      }
      const options = fingerings(group.map((n) => n.pitch), target, CANDIDATES, taken.get(offset));
      return { offset, notes: group, options };
    });

  // Dynamic programming over (shape, hand position): the cheapest way through the whole passage.
  interface State {
    option: number;
    position: number;
    cost: number;
    back: State | null;
  }
  let prev: State[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const before = gi > 0 ? groups[gi - 1] : null;
    const next: State[] = [];
    g.options.forEach((opt, oi) => {
      const positions = handPositions(opt.spots) ?? (prev.length ? [...new Set(prev.map((s) => s.position))] : [START_HAND]);
      for (const position of positions) {
        let best: State | null = null;
        let bestCost = Infinity;
        for (const s of prev) {
          let c = s.cost + shiftCost(s.position, position);
          // Re-using a string that's still ringing from the previous chord cuts that note short.
          if (before) {
            const prevSpots = before.options[s.option].spots;
            for (const spot of opt.spots) {
              if (!spot) continue;
              const k = prevSpots.findIndex((p) => p?.string === spot.string);
              if (k >= 0 && before.offset + before.notes[k].duration > g.offset) c += 3;
            }
          }
          if (c < bestCost) (bestCost = c), (best = s);
        }
        next.push({ option: oi, position, cost: (prev.length ? bestCost : position * 0.05) + opt.cost, back: best });
      }
    });
    prev = next;
  }

  // Walk back from the cheapest end state.
  const chosen: number[] = [];
  let s: State | null = prev.reduce<State | null>((a, b) => (!a || b.cost < a.cost ? b : a), null);
  while (s) {
    chosen.unshift(s.option);
    s = s.back;
  }
  groups.forEach((g, gi) => {
    const spots = g.options[chosen[gi]]?.spots ?? g.notes.map(() => null);
    g.notes.forEach((n, i) => {
      const spot = spots[i];
      if (!spot) result.dropped++;
      else result.notes.push({ ...spot, ...pick(n, 'offset', 'duration', 'velocity', 'palmMute') });
    });
  });
  return result;
}

/**
 * Candidate shapes for a chord (pitches high to low), each note on its own string, cheapest first.
 * A note can be left out, at a high cost, when no shape fits all of them.
 */
export function fingerings(
  pitches: number[],
  track: Pick<Track, 'tuning' | 'frets'>,
  limit: number,
  blocked: Set<number> = new Set(),
): Fingering[] {
  const options = pitches.map((p) =>
    track.tuning
      .map((open, string) => ({ string, fret: p - open }))
      .filter((o) => o.fret >= 0 && o.fret <= track.frets && !blocked.has(o.string)),
  );
  const found: Fingering[] = [];
  const chosen: Array<Spot | null> = [];
  const used = new Set<number>();

  const shapeCost = () => {
    const placed = chosen.filter((c): c is Spot => !!c);
    const fretted = placed.filter((c) => c.fret > 0).map((c) => c.fret);
    const span = fretted.length > 1 ? Math.max(...fretted) - Math.min(...fretted) : 0;
    return (
      (pitches.length - placed.length) * 100 +
      Math.max(0, span - COMFORTABLE_SPAN) * 10 +
      span +
      fretted.reduce((a, b) => a + b, 0) * 0.02
    );
  };

  const search = (i: number) => {
    if (i === pitches.length) {
      found.push({ spots: [...chosen], cost: shapeCost() });
      return;
    }
    for (const o of options[i]) {
      if (used.has(o.string)) continue;
      used.add(o.string);
      chosen.push(o);
      search(i + 1);
      chosen.pop();
      used.delete(o.string);
    }
    chosen.push(null);
    search(i + 1);
    chosen.pop();
  };
  search(0);
  return found.sort((a, b) => a.cost - b.cost).slice(0, limit);
}

/** The single most comfortable shape for a chord, ignoring what comes before or after. */
export function bestFingering(pitches: number[], track: Pick<Track, 'tuning' | 'frets'>): Array<Spot | null> {
  return fingerings(pitches, track, 1)[0]?.spots ?? pitches.map(() => null);
}

/**
 * Where to play one pitch on a guitar or bass, for entering notes by pitch (from the piano keys). Strings in
 * `blocked` (already struck at the cursor) are avoided. `near` holds the frets of the surrounding notes: the
 * spot within reach of the hand position they imply wins, so a line entered key by key stays in one position.
 * With nothing around, the lowest spot wins (open strings first). Null if the pitch is out of range.
 */
export function spotForPitch(
  pitch: number,
  track: Pick<Track, 'tuning' | 'frets'>,
  near: number[] = [],
  blocked: Set<number> = new Set(),
): Spot | null {
  const fretted = near.filter((f) => f > 0).map((fret) => ({ string: 0, fret }));
  const positions = handPositions(fretted);
  const cost = (fret: number) => {
    if (!positions) return fret;
    // Open strings sound from any position, but a fretted note in reach is the more natural choice.
    if (fret === 0) return 0.5;
    const shift = Math.min(
      ...positions.map((p) => (fret < p ? p - fret : fret > p + HAND_REACH ? fret - p - HAND_REACH : 0)),
    );
    return (shift ? 1 + 0.3 * shift : 0) + fret * 0.01;
  };
  let best: Spot | null = null;
  track.tuning.forEach((open, string) => {
    const fret = pitch - open;
    if (fret < 0 || fret > track.frets || blocked.has(string)) return;
    if (!best || cost(fret) < cost(best.fret)) best = { string, fret };
  });
  return best;
}
