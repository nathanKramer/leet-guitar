import { describe, expect, it } from 'vitest';
import { deleteBars, duplicateBars, insertBars, moveBars, pasteBlocks, copyBlocks, setTimeSig } from './arrange';
import { addNote, initDocument, sortedTracks } from './commands';
import { exportMidi } from '../midi/export';
import { meter, Meter, sigLabel } from './meter';
import { openProjectOps, parseProject, serializeProject } from './project';
import { DocumentStore } from './store';
import type { Song } from './types';

const BAR = 1920; // 4/4
const sig = (beatsPerBar: number, beatUnit: number) => ({ beatsPerBar, beatUnit });

/** One guitar note at the start of each of the first four bars (fret = bar number), plus one on beat 4 of bar 1. */
function setup() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const track = sortedTracks(s.getSong())[0].id;
  const add = (start: number, fret: number, string = 0) =>
    s.transact(addNote(s.getSong(), { trackId: track, string, fret, start, duration: 240, velocity: 96 }).ops);
  for (let b = 0; b < 4; b++) add(b * BAR, b);
  add(BAR + 1440, 9, 1);
  return { s, track };
}

/** Notes as [bar, offset in bar, fret], in time order. */
function layout(song: Song) {
  const m = meter(song);
  return Object.values(song.notes)
    .sort((a, b) => a.start - b.start)
    .map((n) => [m.barAt(n.start), n.start - m.barStart(m.barAt(n.start)), n.fret]);
}

/** Each bar's time signature, as labels. */
const sigs = (song: Song, count = 6) => Array.from({ length: count }, (_, b) => sigLabel(meter(song).sigAt(b)));

describe('Meter', () => {
  const m = new Meter(sig(4, 4), [
    { bar: 2, ...sig(7, 8) },
    { bar: 3, ...sig(4, 4) },
  ]);

  it('maps bars to ticks and back across changes', () => {
    expect([0, 1, 2, 3, 4].map((b) => m.barStart(b))).toEqual([0, 1920, 3840, 3840 + 1680, 3840 + 1680 + 1920]);
    expect(m.barAt(3840 + 1679)).toBe(2);
    expect(m.barAt(3840 + 1680)).toBe(3);
    expect(m.barLength(2)).toBe(1680);
    expect(m.beatTicks(2)).toBe(240);
    expect(m.nextChange(0)).toBe(2);
    expect(m.nextChange(3)).toBe(Infinity);
  });

  it('steps the cursor on each bar’s own grid, never over a bar line', () => {
    // Quarter notes through the 7/8 bar: the last step is an eighth, to the bar line.
    const start = m.barStart(2);
    expect(m.step(start + 1440, 480, 1)).toBe(start + 1680);
    expect(m.step(start + 1680, 480, -1)).toBe(start + 1440);
    expect(m.snap(start + 1680 + 500, 480)).toBe(start + 1680 + 480);
  });

  it('ignores changes that repeat the signature before them', () => {
    const same = new Meter(sig(4, 4), [{ bar: 3, ...sig(4, 4) }]);
    expect(same.changesAt(3)).toBe(false);
  });
});

/** Every note's start tick, in time order. */
const ticks = (song: Song) => Object.values(song.notes).map((n) => n.start).sort((a, b) => a - b);

describe('time signature changes', () => {
  it('moves only the bar lines: notes a shorter bar can’t hold carry over into the next bar', () => {
    const { s } = setup();
    const before = ticks(s.getSong());
    s.transact(setTimeSig(s.getSong(), sig(3, 4), 1));
    expect(sigs(s.getSong())).toEqual(['4/4', '3/4', '3/4', '3/4', '3/4', '3/4']);
    expect(ticks(s.getSong())).toEqual(before);
    // Bars of 1440 ticks from bar 1: beat 4 of the old bar 1 opens bar 2, and everything after shifts along.
    expect(layout(s.getSong())).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 9],
      [2, 480, 2],
      [3, 960, 3],
    ]);
  });

  it('6/4 to 5/4 loses nothing; back to 6/4 restores the bars', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(6, 4), 0));
    const before = layout(s.getSong());
    s.transact(setTimeSig(s.getSong(), sig(5, 4), 0));
    expect(Object.keys(s.getSong().notes)).toHaveLength(5);
    s.transact(setTimeSig(s.getSong(), sig(6, 4), 0));
    expect(layout(s.getSong())).toEqual(before);
  });

  it('a longer bar pulls the next bar’s notes back into it', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(5, 4), 0, 0));
    expect(layout(s.getSong()).slice(0, 2)).toEqual([
      [0, 0, 0],
      [0, 1920, 1],
    ]);
  });

  it('undo restores the time signature', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(3, 4), 1));
    s.undo();
    expect(sigs(s.getSong())).toEqual(['4/4', '4/4', '4/4', '4/4', '4/4', '4/4']);
  });

  it('changes just the given bars; the bars after keep theirs', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(7, 8), 2, 2));
    expect(sigs(s.getSong())).toEqual(['4/4', '4/4', '7/8', '4/4', '4/4', '4/4']);
    expect(Object.keys(s.getSong().timeSigs).sort()).toEqual(['bar-2', 'bar-3']);
    // Setting it back removes both changes.
    s.transact(setTimeSig(s.getSong(), sig(4, 4), 2, 2));
    expect(s.getSong().timeSigs).toEqual({});
  });

  it('changing the first bar sets the song’s time signature', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(6, 8), 0));
    expect(s.getSong().meta).toMatchObject(sig(6, 8));
    expect(s.getSong().timeSigs).toEqual({});
  });

  it('a change stops at the next one', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(5, 4), 3));
    s.transact(setTimeSig(s.getSong(), sig(3, 4), 1));
    expect(sigs(s.getSong())).toEqual(['4/4', '3/4', '3/4', '5/4', '5/4', '5/4']);
  });
});

describe('bar edits carry time signatures', () => {
  const odd = () => {
    const { s, track } = setup();
    s.transact(setTimeSig(s.getSong(), sig(7, 8), 2, 2));
    return { s, track };
  };

  it('moving a bar takes its time signature with it', () => {
    const { s } = odd();
    s.transact(moveBars(s.getSong(), { first: 2, count: 1 }, 0));
    expect(sigs(s.getSong())).toEqual(['7/8', '4/4', '4/4', '4/4', '4/4', '4/4']);
    expect(layout(s.getSong()).map((n) => n[2])).toEqual([2, 0, 1, 9, 3]);
  });

  it('inserting before a changed bar keeps the change on that bar', () => {
    const { s } = odd();
    s.transact(insertBars(s.getSong(), 2));
    expect(sigs(s.getSong())).toEqual(['4/4', '4/4', '4/4', '7/8', '4/4', '4/4']);
  });

  it('duplicating and deleting bars', () => {
    const { s } = odd();
    s.transact(duplicateBars(s.getSong(), { first: 2, count: 1 }));
    expect(sigs(s.getSong())).toEqual(['4/4', '4/4', '7/8', '7/8', '4/4', '4/4']);
    s.transact(deleteBars(s.getSong(), { first: 2, count: 2 }));
    expect(sigs(s.getSong())).toEqual(['4/4', '4/4', '4/4', '4/4', '4/4', '4/4']);
    expect(layout(s.getSong()).map((n) => n.slice(0, 2))).toEqual([
      [0, 0],
      [1, 0],
      [1, 1440],
      [2, 240],
    ]);
  });

  it('pasting a block into a shorter bar leaves out what doesn’t fit', () => {
    const { s, track } = odd();
    const tracks = sortedTracks(s.getSong());
    const clip = copyBlocks(s.getSong(), [{ trackId: track, bar: 1 }], tracks)!;
    const r = pasteBlocks(s.getSong(), tracks, clip, 0, 2);
    expect(r.dropped).toBe(0); // beat 4 of 4/4 = 1440 ticks, still inside a 7/8 bar (1680)
    s.transact(setTimeSig(s.getSong(), sig(3, 4), 2, 2));
    expect(pasteBlocks(s.getSong(), tracks, clip, 0, 2).dropped).toBe(1);
  });
});

describe('saving and exporting', () => {
  it('round-trips time signature changes through a project file', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(7, 8), 2, 2));
    const dst = new DocumentStore({ actor: 'b' });
    dst.transact(initDocument(dst.getSong()), { undoable: false });
    dst.transact(openProjectOps(dst.getSong(), parseProject(serializeProject(s.getSong()))).ops);
    expect(sigs(dst.getSong())).toEqual(sigs(s.getSong()));
    expect(layout(dst.getSong())).toEqual(layout(s.getSong()));
  });

  it('writes a MIDI time signature event at each change', () => {
    const { s } = setup();
    s.transact(setTimeSig(s.getSong(), sig(7, 8), 2, 2));
    const bytes = [...exportMidi(s.getSong())];
    const events: number[][] = [];
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 4) events.push(bytes.slice(i + 3, i + 5));
    }
    expect(events).toEqual([
      [4, 2],
      [7, 3],
      [4, 2],
    ]);
  });
});
