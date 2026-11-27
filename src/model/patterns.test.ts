import { describe, expect, it } from 'vitest';
import { addNote, addTrack, deletePattern, initDocument, pasteNotes, savePattern, sortedTracks } from './commands';
import type { DocState } from './crdt';
import { canPlace } from './transfer';
import { newProjectOps, openProjectOps, parseProject, serializeProject } from './project';
import { DocumentStore } from './store';

function newStore(actor = 'a') {
  const s = new DocumentStore({ actor });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}

/** A guitar track with an E5 power chord at tick 480 and a note after it. */
function withRiff() {
  const s = newStore();
  const guitar = sortedTracks(s.getSong())[0].id;
  const a = addNote(s.getSong(), { trackId: guitar, string: 5, fret: 0, start: 480, duration: 240, velocity: 100 });
  s.transact(a.ops);
  const b = addNote(s.getSong(), { trackId: guitar, string: 4, fret: 2, start: 480, duration: 240, velocity: 100 });
  s.transact(b.ops);
  const c = addNote(s.getSong(), { trackId: guitar, string: 3, fret: 2, start: 720, duration: 120, velocity: 90 });
  s.transact(c.ops);
  return { s, guitar, ids: [a.id, b.id, c.id] };
}

describe('patterns', () => {
  it('saves selected notes relative to the earliest one', () => {
    const { s, ids } = withRiff();
    const { ops, id } = savePattern(s.getSong(), ids, 'Riff');
    s.transact(ops);
    const p = s.getSong().patterns[id!];
    expect(p.name).toBe('Riff');
    expect(p.kind).toBe('guitar');
    expect(p.notes.map((n) => n.offset).sort((x, y) => x - y)).toEqual([0, 0, 240]);
    expect(p.notes.map((n) => n.pitch).sort()).toEqual([40, 47, 52]);
  });

  it('saves nothing for an empty selection', () => {
    const s = newStore();
    expect(savePattern(s.getSong(), [], 'Empty').ops).toEqual([]);
  });

  it('inserts at a tick, translated for another track', () => {
    const { s, ids } = withRiff();
    const { ops, id } = savePattern(s.getSong(), ids, 'Riff');
    s.transact(ops);
    const piano = addTrack(s.getSong(), 'piano');
    s.transact(piano.ops);
    const pasted = pasteNotes(s.getSong(), s.getSong().patterns[id!], piano.id, 1920);
    s.transact(pasted.ops);
    const notes = pasted.ids.map((n) => s.getSong().notes[n]);
    expect(notes.map((n) => n.start).sort()).toEqual([1920, 1920, 2160]);
  });

  it('only fits drum patterns on drum tracks, and pitched patterns on pitched tracks', () => {
    expect(canPlace('guitar', 'piano')).toBe(true);
    expect(canPlace('piano', 'bass')).toBe(true);
    expect(canPlace('drums', 'drums')).toBe(true);
    expect(canPlace('drums', 'guitar')).toBe(false);
    expect(canPlace('guitar', 'drums')).toBe(false);
  });

  it('deletes undoably', () => {
    const { s, ids } = withRiff();
    const { ops, id } = savePattern(s.getSong(), ids, 'Riff');
    s.transact(ops);
    s.transact(deletePattern(id!));
    expect(s.getSong().patterns[id!]).toBeUndefined();
    s.undo();
    expect(s.getSong().patterns[id!].name).toBe('Riff');
  });

  it('syncs to another store', () => {
    const { s, ids } = withRiff();
    const other = new DocumentStore({ actor: 'b' });
    s.onLocalOps((ops) => other.applyRemote(ops));
    s.transact(savePattern(s.getSong(), ids, 'Riff').ops);
    expect(Object.values(other.getSong().patterns).map((p) => p.name)).toEqual(['Riff']);
  });

  it('loads a snapshot saved before patterns existed', () => {
    const { s } = withRiff();
    const old = s.getSnapshot() as Partial<DocState>;
    delete old.patterns;
    const loaded = new DocumentStore({ actor: 'b', state: old as DocState });
    expect(loaded.getSong().patterns).toEqual({});
    const guitar = sortedTracks(loaded.getSong())[0].id;
    const ids = Object.values(loaded.getSong().notes).filter((n) => n.trackId === guitar).map((n) => n.id);
    loaded.transact(savePattern(loaded.getSong(), ids, 'Riff').ops);
    expect(Object.keys(loaded.getSong().patterns)).toHaveLength(1);
  });

  it('round-trips through a project file, and a new project clears them', () => {
    const { s, ids } = withRiff();
    s.transact(savePattern(s.getSong(), ids, 'Riff').ops);
    const text = serializeProject(s.getSong());
    const target = newStore('b');
    target.transact(openProjectOps(target.getSong(), parseProject(text)).ops);
    const [p] = Object.values(target.getSong().patterns);
    const [orig] = Object.values(s.getSong().patterns);
    expect({ ...p, id: '' }).toEqual({ ...orig, id: '' });
    target.transact(newProjectOps(target.getSong()).ops);
    expect(target.getSong().patterns).toEqual({});
  });

  it('opens project files without patterns', () => {
    const s = newStore();
    const text = serializeProject(s.getSong());
    expect(text).not.toContain('patterns');
    expect(parseProject(text).patterns).toEqual([]);
  });
});
