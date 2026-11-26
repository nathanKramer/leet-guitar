import { describe, expect, it } from 'vitest';
import {
  clearBlocks,
  copyBlocks,
  deleteBars,
  duplicateBars,
  duplicateBlocks,
  insertBars,
  moveBars,
  moveBlocks,
  movedTo,
  pasteBlocks,
  usedBars,
} from './arrange';
import { addNote, addTrack, initDocument, sortedTracks } from './commands';
import { DocumentStore } from './store';
import type { Song } from './types';

/** 4/4 at PPQ 480: one bar is 1920 ticks. */
const BAR = 1920;

function setup() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const guitar = sortedTracks(s.getSong())[0].id;
  const drums = addTrack(s.getSong(), 'drums');
  s.transact(drums.ops);
  /** One note per bar on the guitar, fret = bar number, plus a kick in bar 0 and bar 2. */
  for (let b = 0; b < 4; b++) {
    s.transact(
      addNote(s.getSong(), { trackId: guitar, string: 0, fret: b, start: b * BAR, duration: 480, velocity: 96 }).ops,
    );
  }
  for (const b of [0, 2]) {
    s.transact(
      addNote(s.getSong(), {
        trackId: drums.id,
        string: 8,
        fret: 0,
        start: b * BAR + 240,
        duration: 120,
        velocity: 110,
      }).ops,
    );
  }
  return { s, guitar, drums: drums.id };
}

/** Per track, notes as [bar, offset in bar, fret], in time order. */
function layout(song: Song, trackId: string) {
  return Object.values(song.notes)
    .filter((n) => n.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((n) => [Math.floor(n.start / BAR), n.start % BAR, n.fret]);
}

describe('arranging bars', () => {
  it('moves a bar earlier, in every track', () => {
    const { s, guitar, drums } = setup();
    s.transact(moveBars(s.getSong(), { first: 2, count: 1 }, 0));
    expect(layout(s.getSong(), guitar).map((n) => n[2])).toEqual([2, 0, 1, 3]);
    expect(layout(s.getSong(), drums)).toEqual([
      [0, 240, 0],
      [1, 240, 0],
    ]);
  });

  it('moves several bars later', () => {
    const { s, guitar } = setup();
    s.transact(moveBars(s.getSong(), { first: 0, count: 2 }, 4));
    expect(layout(s.getSong(), guitar).map((n) => n[2])).toEqual([2, 3, 0, 1]);
  });

  it('leaves the song alone when dropped onto itself, and undoes in one step', () => {
    const { s, guitar } = setup();
    expect(moveBars(s.getSong(), { first: 1, count: 2 }, 2)).toEqual([]);
    expect(movedTo({ first: 1, count: 2 }, 3)).toBeNull();
    const before = layout(s.getSong(), guitar);
    s.transact(moveBars(s.getSong(), { first: 3, count: 1 }, 1));
    s.undo();
    expect(layout(s.getSong(), guitar)).toEqual(before);
  });

  it('duplicates bars straight after themselves', () => {
    const { s, guitar, drums } = setup();
    s.transact(duplicateBars(s.getSong(), { first: 1, count: 2 }));
    expect(layout(s.getSong(), guitar).map((n) => n[2])).toEqual([0, 1, 2, 1, 2, 3]);
    expect(layout(s.getSong(), drums).map((n) => n[0])).toEqual([0, 2, 4]);
  });

  it('inserts and deletes bars', () => {
    const { s, guitar } = setup();
    s.transact(insertBars(s.getSong(), 1));
    expect(layout(s.getSong(), guitar).map((n) => n[0])).toEqual([0, 2, 3, 4]);
    s.transact(deleteBars(s.getSong(), { first: 0, count: 2 }));
    expect(layout(s.getSong(), guitar).map((n) => [n[0], n[2]])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(usedBars(s.getSong())).toBe(3);
  });

  it('cuts a ringing note short when its bar moves in front of a note on the same string', () => {
    const { s, guitar } = setup();
    const long = addNote(s.getSong(), {
      trackId: guitar,
      string: 1,
      fret: 7,
      start: 3 * BAR,
      duration: 2 * BAR,
      velocity: 96,
    });
    s.transact(long.ops);
    s.transact(
      addNote(s.getSong(), { trackId: guitar, string: 1, fret: 9, start: 1 * BAR, duration: 480, velocity: 96 }).ops,
    );
    // Bar 3 (with the two-bar note) moves to the front: it would ring through bar 1's note on string 1.
    s.transact(moveBars(s.getSong(), { first: 3, count: 1 }, 0));
    const moved = s.getSong().notes[long.id];
    expect(moved.start).toBe(0);
    expect(moved.duration).toBe(2 * BAR); // the next note on string 1 is now in bar 2
    s.transact(moveBars(s.getSong(), { first: 2, count: 1 }, 1));
    expect(s.getSong().notes[long.id].duration).toBe(BAR);
  });
});

describe('arranging blocks (one track, one bar)', () => {
  it('moves a block within its track, replacing the destination and leaving the source empty', () => {
    const { s, guitar, drums } = setup();
    const tracks = sortedTracks(s.getSong());
    const r = moveBlocks(s.getSong(), tracks, [{ trackId: guitar, bar: 0 }], 0, 2);
    s.transact(r.ops);
    expect(layout(s.getSong(), guitar).map((n) => [n[0], n[2]])).toEqual([
      [1, 1],
      [2, 0],
      [3, 3],
    ]);
    // Other tracks are untouched.
    expect(layout(s.getSong(), drums).map((n) => n[0])).toEqual([0, 2]);
    expect(r.blocks).toEqual([{ trackId: guitar, bar: 2 }]);
  });

  it('copies blocks with their shape and pastes them over other blocks', () => {
    const { s, guitar, drums } = setup();
    const tracks = sortedTracks(s.getSong());
    const clip = copyBlocks(
      s.getSong(),
      [
        { trackId: guitar, bar: 0 },
        { trackId: drums, bar: 1 }, // empty: pasting it empties the target
      ],
      tracks,
    )!;
    expect([clip.rows, clip.bars]).toEqual([2, 2]);
    s.transact(pasteBlocks(s.getSong(), tracks, clip, 0, 2).ops);
    expect(layout(s.getSong(), guitar).map((n) => [n[0], n[2]])).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 3],
    ]);
    expect(layout(s.getSong(), drums).map((n) => n[0])).toEqual([0, 2]);
    s.transact(pasteBlocks(s.getSong(), tracks, clip, 0, 1).ops);
    expect(layout(s.getSong(), drums).map((n) => n[0])).toEqual([0]); // bar 2's kick replaced by the empty block
  });

  it('refuses to put drum hits on a pitched track', () => {
    const { s, drums } = setup();
    const tracks = sortedTracks(s.getSong());
    const r = moveBlocks(s.getSong(), tracks, [{ trackId: drums, bar: 0 }], -1, 0);
    expect(r.refused).toBe(1);
    expect(r.blocks).toEqual([]);
  });

  it('carries a guitar block to a bass track by pitch', () => {
    const { s, guitar } = setup();
    const bass = addTrack(s.getSong(), 'bass');
    s.transact(bass.ops);
    const tracks = sortedTracks(s.getSong());
    const row = tracks.findIndex((t) => t.id === bass.id) - tracks.findIndex((t) => t.id === guitar);
    s.transact(moveBlocks(s.getSong(), tracks, [{ trackId: guitar, bar: 3 }], row, 0, true).ops);
    const notes = Object.values(s.getSong().notes).filter((n) => n.trackId === bass.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].start).toBe(3 * BAR);
  });

  it('duplicates and clears blocks', () => {
    const { s, guitar } = setup();
    const tracks = sortedTracks(s.getSong());
    const blocks = [
      { trackId: guitar, bar: 0 },
      { trackId: guitar, bar: 1 },
    ];
    s.transact(duplicateBlocks(s.getSong(), tracks, blocks).ops);
    expect(layout(s.getSong(), guitar).map((n) => n[2])).toEqual([0, 1, 0, 1]);
    s.transact(clearBlocks(s.getSong(), blocks));
    expect(layout(s.getSong(), guitar).map((n) => [n[0], n[2]])).toEqual([
      [2, 0],
      [3, 1],
    ]);
  });
});
