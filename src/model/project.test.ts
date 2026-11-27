import { describe, expect, it } from 'vitest';
import { addNote, addTrack, initDocument, setMeta, setTrackPan, setTrackVolume, setTuning, sortedTracks } from './commands';
import { newProjectOps, openProjectOps, parseProject, projectFileName, serializeProject } from './project';
import { DocumentStore } from './store';
import type { Song } from './types';

function newStore(actor = 'a') {
  const s = new DocumentStore({ actor });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}

/** Song contents without ids, for comparing across documents. */
function shape(song: Song) {
  const tracks = sortedTracks(song);
  const index = new Map(tracks.map((t, i) => [t.id, i]));
  return {
    meta: song.meta,
    tracks: tracks.map(({ id: _id, ...t }) => t),
    notes: Object.values(song.notes)
      .map(({ id: _id, trackId, ...n }) => ({ ...n, track: index.get(trackId) }))
      .sort((a, b) => a.track! - b.track! || a.start - b.start || a.string - b.string),
  };
}

function sampleSong() {
  const s = newStore();
  const guitar = sortedTracks(s.getSong())[0].id;
  s.transact(setMeta({ title: 'Riff', bpm: 140, beatsPerBar: 7, beatUnit: 8 }));
  s.transact(setTuning(s.getSong(), guitar, [62, 57, 53, 48, 43, 38, 31]).ops);
  s.transact(addNote(s.getSong(), { trackId: guitar, string: 6, fret: 3, start: 0, duration: 160, velocity: 90 }).ops);
  s.transact(
    addNote(s.getSong(), { trackId: guitar, string: 0, fret: 12, start: 480, duration: 240, velocity: 96 }).ops,
  );
  const drums = addTrack(s.getSong(), 'drums');
  s.transact(drums.ops);
  s.transact(setTrackPan(drums.id, -0.4));
  s.transact(setTrackVolume(drums.id, 0.6));
  s.transact(
    addNote(s.getSong(), { trackId: drums.id, string: 8, fret: 0, start: 0, duration: 120, velocity: 110 }).ops,
  );
  const piano = addTrack(s.getSong(), 'piano');
  s.transact(piano.ops);
  s.transact(
    addNote(s.getSong(), { trackId: piano.id, string: 39, fret: 0, start: 960, duration: 1920, velocity: 80 }).ops,
  );
  return s;
}

describe('project files', () => {
  it('keeps track pan, and opens older files (without pan) centred', () => {
    const src = sampleSong();
    const file = JSON.parse(serializeProject(src.getSong()));
    expect(file.tracks.map((t: { pan: number }) => t.pan)).toEqual([0, -0.4, 0]);
    delete file.tracks[1].pan;
    expect(parseProject(JSON.stringify(file)).tracks[1].pan).toBe(0);
  });

  it('keeps track volume, and opens older files (without volume) at full', () => {
    const file = JSON.parse(serializeProject(sampleSong().getSong()));
    expect(file.tracks.map((t: { volume: number }) => t.volume)).toEqual([1, 0.6, 1]);
    delete file.tracks[1].volume;
    expect(parseProject(JSON.stringify(file)).tracks[1].volume).toBe(1);
  });

  it('round-trips a song into a different document', () => {
    const src = sampleSong();
    const dst = newStore('b');
    const { ops, firstTrackId } = openProjectOps(dst.getSong(), parseProject(serializeProject(src.getSong())));
    dst.transact(ops);
    expect(shape(dst.getSong())).toEqual(shape(src.getSong()));
    expect(sortedTracks(dst.getSong())[0].id).toBe(firstTrackId);
  });

  it('opening replaces the current song and undoes in one step', () => {
    const src = sampleSong();
    const dst = newStore('b');
    const guitar = sortedTracks(dst.getSong())[0].id;
    dst.transact(
      addNote(dst.getSong(), { trackId: guitar, string: 2, fret: 5, start: 0, duration: 480, velocity: 96 }).ops,
    );
    const before = shape(dst.getSong());
    dst.transact(openProjectOps(dst.getSong(), parseProject(serializeProject(src.getSong()))).ops);
    expect(shape(dst.getSong())).toEqual(shape(src.getSong()));
    dst.undo();
    expect(shape(dst.getSong())).toEqual(before);
  });

  it('a new project is a blank song like a fresh document, and undoes in one step', () => {
    const s = sampleSong();
    const before = shape(s.getSong());
    const { ops, firstTrackId } = newProjectOps(s.getSong());
    s.transact(ops);
    expect(shape(s.getSong())).toEqual(shape(newStore('b').getSong()));
    expect(Object.keys(s.getSong().tracks)).toEqual([firstTrackId]);
    s.undo();
    expect(shape(s.getSong())).toEqual(before);
  });

  it('opening the same file twice gives the same song', () => {
    const text = serializeProject(sampleSong().getSong());
    const dst = newStore('b');
    dst.transact(openProjectOps(dst.getSong(), parseProject(text)).ops);
    dst.transact(openProjectOps(dst.getSong(), parseProject(text)).ops);
    expect(shape(dst.getSong())).toEqual(shape(sampleSong().getSong()));
  });

  it('rejects files that are not projects', () => {
    expect(() => parseProject('MThd')).toThrow(/isn't a leet·guitar project/);
    expect(() => parseProject('{"hello":1}')).toThrow(/isn't a leet·guitar project/);
    expect(() => parseProject('{"format":"leet-guitar","version":99}')).toThrow(/newer version/);
    expect(() => parseProject('{"format":"leet-guitar","version":1,"tracks":[]}')).toThrow(/no tracks/);
  });

  it('skips notes that do not fit their track', () => {
    const file = {
      format: 'leet-guitar',
      version: 1,
      meta: { title: 'x', bpm: 9999 },
      tracks: [{ id: 't', kind: 'bass', name: 'B', tuning: [43, 38, 33, 28], frets: 24, program: 33 }],
      notes: [
        { trackId: 't', string: 3, fret: 5, start: 0, duration: 480 },
        { trackId: 't', string: 4, fret: 5, start: 0, duration: 480 }, // no 5th string
        { trackId: 't', string: 0, fret: 30, start: 0, duration: 480 }, // past the last fret
        { trackId: 'missing', string: 0, fret: 0, start: 0, duration: 480 },
        { trackId: 't', string: 0, fret: 0, start: -1, duration: 480 },
      ],
    };
    const p = parseProject(JSON.stringify(file));
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]).toMatchObject({ string: 3, fret: 5, velocity: 96 });
    expect(p.skipped).toBe(4);
    expect(p.meta).toEqual({ title: 'x', bpm: 120, beatsPerBar: 4, beatUnit: 4 });
  });

  it('writes one note per line', () => {
    const text = serializeProject(sampleSong().getSong());
    const noteLines = text.split('\n').filter((l) => l.includes('"trackId"'));
    expect(noteLines).toHaveLength(4);
    expect(text).toContain('"tuning": [62, 57, 53, 48, 43, 38, 31]');
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('names files after the title', () => {
    expect(projectFileName('My Song: take 2/3')).toBe('My Song take 23.leetguitar');
    expect(projectFileName('  ')).toBe('Untitled.leetguitar');
  });
});
