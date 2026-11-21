import { describe, expect, it } from 'vitest';
import { exportMidi } from '../midi/export';
import { palmMuteChannels } from '../midi/channels';
import { addNote, addTrack, copyNotes, DEFAULT_TRACK_ID, initDocument, pasteNotes, setTrackProgram, togglePalmMute } from './commands';
import { openProjectOps, parseProject, serializeProject } from './project';
import { DocumentStore } from './store';

function setup() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const add = (trackId: string, string: number, fret: number, start: number, duration = 480) => {
    const { ops, id } = addNote(s.getSong(), { trackId, string, fret, start, duration, velocity: 100 });
    s.transact(ops);
    return id;
  };
  return { s, add };
}

/** Note-on events in a MIDI file as [channel, pitch, velocity]. */
function noteOns(bytes: Uint8Array) {
  const out: number[][] = [];
  for (let i = 0; i < bytes.length - 2; i++) {
    if ((bytes[i] & 0xf0) === 0x90 && bytes[i + 1] < 128 && bytes[i + 2] > 0 && bytes[i + 2] < 128) {
      out.push([bytes[i] & 0x0f, bytes[i + 1], bytes[i + 2]]);
    }
  }
  return out;
}

describe('palm mute', () => {
  it('toggles: mutes all if any is open, otherwise unmutes; undo restores', () => {
    const { s, add } = setup();
    const a = add(DEFAULT_TRACK_ID, 5, 0, 0);
    const b = add(DEFAULT_TRACK_ID, 5, 0, 480);
    s.transact(togglePalmMute(s.getSong(), [a]));
    expect(s.getSong().notes[a].palmMute).toBe(true);
    s.transact(togglePalmMute(s.getSong(), [a, b]));
    expect([s.getSong().notes[a].palmMute, s.getSong().notes[b].palmMute]).toEqual([true, true]);
    s.transact(togglePalmMute(s.getSong(), [a, b]));
    expect(s.getSong().notes[a].palmMute).toBeUndefined();
    s.undo();
    expect(s.getSong().notes[b].palmMute).toBe(true);
  });

  it('does nothing on piano or drum notes', () => {
    const { s, add } = setup();
    const piano = addTrack(s.getSong(), 'piano');
    s.transact(piano.ops);
    const n = add(piano.id, 40, 0, 0);
    expect(togglePalmMute(s.getSong(), [n])).toEqual([]);
  });

  it('survives copy/paste to guitar and bass, but not piano', () => {
    const { s, add } = setup();
    const a = add(DEFAULT_TRACK_ID, 4, 3, 0);
    s.transact(togglePalmMute(s.getSong(), [a]));
    const clip = copyNotes(s.getSong(), [a])!;
    const bass = addTrack(s.getSong(), 'bass');
    const piano = addTrack(s.getSong(), 'piano');
    s.transact([...bass.ops, ...piano.ops]);
    for (const [track, expected] of [[DEFAULT_TRACK_ID, true], [bass.id, true], [piano.id, undefined]] as const) {
      const { ops, ids } = pasteNotes(s.getSong(), clip, track, 960);
      s.transact(ops);
      expect(s.getSong().notes[ids[0]].palmMute).toBe(expected);
    }
  });

  it('is kept in project files', () => {
    const { s, add } = setup();
    const a = add(DEFAULT_TRACK_ID, 5, 0, 0);
    add(DEFAULT_TRACK_ID, 5, 0, 480);
    s.transact(togglePalmMute(s.getSong(), [a]));
    const dst = new DocumentStore({ actor: 'b' });
    dst.transact(openProjectOps(dst.getSong(), parseProject(serializeProject(s.getSong()))).ops);
    const muted = Object.values(dst.getSong().notes).filter((n) => n.palmMute);
    expect(muted).toHaveLength(1);
    expect(muted[0].start).toBe(0);
  });

  it('exports clean guitars on a muted-guitar channel, damped; distorted guitars keep their channel', () => {
    const { s, add } = setup();
    const a = add(DEFAULT_TRACK_ID, 5, 0, 0, 1920); // E2, a whole note at 120 bpm (2 s)
    add(DEFAULT_TRACK_ID, 5, 3, 1920);
    s.transact(togglePalmMute(s.getSong(), [a]));
    const pm = palmMuteChannels(s.getSong()).get(DEFAULT_TRACK_ID)!;
    expect(pm).toBe(1);
    const bytes = exportMidi(s.getSong());
    expect(noteOns(bytes)).toEqual([
      [pm, 40, 85],
      [0, 43, 100],
    ]);
    // Program 28 on the palm-mute channel, and the note cut to 0.2 s (192 ticks at 120 bpm).
    const text = Array.from(bytes);
    expect(text.some((b, i) => b === (0xc0 | pm) && text[i + 1] === 28)).toBe(true);
    const off = [0x81, 0x40, 0x80 | pm, 40, 0]; // delta 192 (VLQ), then note-off
    expect(text.some((_, i) => off.every((b, j) => text[i + j] === b))).toBe(true);

    s.transact(setTrackProgram(DEFAULT_TRACK_ID, 30)); // distortion
    expect(palmMuteChannels(s.getSong()).size).toBe(0);
    expect(noteOns(exportMidi(s.getSong()))[0]).toEqual([0, 40, 85]);
  });
});
