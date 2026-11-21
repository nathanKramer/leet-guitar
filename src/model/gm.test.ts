import { describe, expect, it } from 'vitest';
import { exportMidi } from '../midi/export';
import { addTrack, initDocument, sortedTracks } from './commands';
import { GM_INSTRUMENTS, GM_PROGRAM_NAMES, groupByFamily, trackKindFor } from './gm';
import { instrumentChoices } from './instruments';
import { openProjectOps, parseProject, serializeProject } from './project';
import { DocumentStore } from './store';

const KALIMBA = { program: 108, bank: 0, name: 'Kalimba' };
const UKULELE = { program: 24, bank: 8, name: 'Ukulele' };

function store() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}

describe('General MIDI instruments', () => {
  it('has 128 names in 16 families of 8', () => {
    expect(GM_PROGRAM_NAMES).toHaveLength(128);
    const groups = groupByFamily(GM_INSTRUMENTS);
    expect(groups).toHaveLength(16);
    expect(groups.every((g) => g.instruments.length === 8)).toBe(true);
    expect(GM_PROGRAM_NAMES[108]).toBe('Kalimba');
  });

  it('puts guitars and basses on fretboard tracks, everything else on a piano roll', () => {
    expect([trackKindFor(24), trackKindFor(31), trackKindFor(33), trackKindFor(108), trackKindFor(0)]).toEqual([
      'guitar',
      'guitar',
      'bass',
      'piano',
      'piano',
    ]);
  });

  it('offers the SoundFont list when loaded: all of it for piano rolls, the family for guitar/bass', () => {
    const font = [KALIMBA, UKULELE, { program: 33, bank: 0, name: 'Fingered Bass' }];
    expect(instrumentChoices('piano', font)).toEqual(font);
    expect(instrumentChoices('guitar', font)).toEqual([UKULELE]);
    expect(instrumentChoices('piano', null)).toHaveLength(128);
    expect(instrumentChoices('drums', font)[0]).toMatchObject({ name: 'Standard' });
  });
});

describe('instrument tracks', () => {
  it('are named after the instrument, numbered when the name is taken', () => {
    const s = store();
    const a = addTrack(s.getSong(), 'piano', KALIMBA);
    s.transact(a.ops);
    const b = addTrack(s.getSong(), 'piano', KALIMBA);
    s.transact(b.ops);
    expect(s.getSong().tracks[a.id]).toMatchObject({ name: 'Kalimba', program: 108, bank: 0, kind: 'piano' });
    expect(s.getSong().tracks[b.id].name).toBe('Kalimba 2');
  });

  it('export bank select before the program change, and keep the bank in project files', () => {
    const s = store();
    const u = addTrack(s.getSong(), 'guitar', UKULELE);
    s.transact(u.ops);
    const ch = sortedTracks(s.getSong()).findIndex((t) => t.id === u.id);
    const bytes = Array.from(exportMidi(s.getSong()));
    const seq = [0xb0 | ch, 0, 8, 0x00, 0xb0 | ch, 32, 0, 0x00, 0xc0 | ch, 24];
    expect(bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b))).toBe(true);

    const dst = new DocumentStore({ actor: 'b' });
    dst.transact(openProjectOps(dst.getSong(), parseProject(serializeProject(s.getSong()))).ops);
    expect(sortedTracks(dst.getSong())[1]).toMatchObject({ name: 'Ukulele', program: 24, bank: 8 });
  });
});
