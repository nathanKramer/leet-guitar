import { docStore, editor } from '../session';
import * as act from './actions';
import * as arr from './arrange';
import { openProject, saveProject } from './project';
import { stepDuration, type BaseDuration } from '../model/durations';

const DURATION_KEYS: Record<string, BaseDuration> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  e: 'eighth',
  s: 'sixteenth',
};

/** Two-digit fret entry: typing "1" then "2" quickly enters fret 12. */
let pendingDigit: { id: string; value: number; at: number } | null = null;
const DIGIT_WINDOW_MS = 700;

function enterDigit(d: number) {
  const s = editor.get();
  const track = docStore.getSong().tracks[s.trackId];
  if (!track) return;
  if (track.kind === 'drums') {
    // Digits are pads: 1 = top lane. Like typed frets, they don't advance the cursor.
    if (d >= 1 && d <= track.tuning.length) act.placeNote(d - 1, 0, { advance: false });
    return;
  }
  if (track.kind === 'piano') return; // no frets to type
  const now = Date.now();
  const pendingNote = pendingDigit && docStore.getSong().notes[pendingDigit.id];
  // Only combine with a note still under the cursor: after moving on, a new digit is a new note.
  const sameSpot = pendingNote && pendingNote.start === s.cursor && pendingNote.string === s.cursorString;
  if (pendingDigit && now - pendingDigit.at < DIGIT_WINDOW_MS && sameSpot) {
    const combined = pendingDigit.value * 10 + d;
    if (combined <= track.frets) {
      act.setFret(pendingDigit.id, combined);
      pendingDigit = null;
      return;
    }
  }
  const id = act.placeNote(s.cursorString, d, { advance: false });
  pendingDigit = id ? { id, value: d, at: now } : null;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

export function handleKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  // Save / open work from anywhere, including text fields, instead of the browser's "save page".
  if (mod && !e.altKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) {
    e.preventDefault();
    if (e.key.toLowerCase() === 's') void saveProject(e.shiftKey);
    else void openProject();
    return;
  }
  if (isTyping(e.target)) return;
  if (editor.get().view === 'arrange') {
    if (handleArrangeKey(e, mod)) e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  const hasSel = act.liveSelection().length > 0;
  let handled = true;

  if (mod) {
    if (key === 'z') (e.shiftKey ? act.redo : act.undo)();
    else if (key === 'y') act.redo();
    else if (key === 'a') act.selectAll();
    else if (key === 'c') act.copy();
    else if (key === 'x') act.cut();
    else if (key === 'v') act.paste();
    else handled = false;
  } else if (/^[0-9]$/.test(e.key)) {
    enterDigit(Number(e.key));
  } else if (DURATION_KEYS[key]) {
    act.setDuration(DURATION_KEYS[key]);
  } else if (e.key === '[' || e.key === ']') {
    act.setDuration(stepDuration(editor.get().base, e.key === '[' ? 1 : -1));
  } else {
    switch (e.key) {
      case ' ':
        act.togglePlay();
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.altKey && hasSel) act.moveSelection(dir * act.stepTicks());
        else if (e.shiftKey) act.extendSelection(dir);
        else act.stepCursor(dir);
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const piano = docStore.getSong().tracks[editor.get().trackId]?.kind === 'piano';
        if (e.altKey && hasSel) act.moveSelectionString(dir);
        // Piano has no frets: Shift moves by an octave instead.
        else if (e.shiftKey && hasSel) piano ? act.moveSelectionString(dir * 12) : act.shiftSelectionFret(-dir);
        else act.moveCursorString(dir);
        break;
      }
      case 'Delete':
      case 'Backspace':
        act.deleteSelection();
        break;
      case 'Escape':
        editor.set({ selection: [] });
        break;
      case 'Home':
        editor.set({ cursor: 0 });
        break;
      case 'PageDown':
      case 'PageUp':
        // Same spot, one timeline row (a few bars) later or earlier.
        act.moveCursorRow(e.key === 'PageDown' ? 1 : -1);
        break;
      case 'p':
      case 'P':
        act.togglePalmMute();
        break;
      case 't':
      case 'T':
        act.toggleTriplet();
        break;
      case '.':
        act.toggleDotted();
        break;
      case 'c':
      case 'C':
        editor.set((s) => ({ chordMode: !s.chordMode }));
        break;
      default:
        handled = false;
    }
  }
  if (handled) e.preventDefault();
}

/** Keys in the arrangement view, which works on blocks (a track's bar). Note-editing keys do nothing there. */
function handleArrangeKey(e: KeyboardEvent, mod: boolean): boolean {
  const key = e.key.toLowerCase();
  if (mod) {
    if (key === 'z') (e.shiftKey ? act.redo : act.undo)();
    else if (key === 'y') act.redo();
    else if (key === 'c') arr.copy();
    else if (key === 'x') arr.cut();
    else if (key === 'v') arr.paste();
    else if (key === 'd') arr.duplicate();
    else if (key === 'a') arr.selectAll();
    else return false;
    return true;
  }
  const dBars = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const dRows = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (dBars || dRows) {
    if (e.altKey) dBars ? arr.nudge(dBars as 1 | -1) : arr.moveBlocksBy(dRows, 0);
    else arr.stepSelection(dBars, dRows, e.shiftKey);
  } else if (e.key === ' ') act.togglePlay();
  else if (e.key === 'Delete' || e.key === 'Backspace') (e.shiftKey ? arr.removeBars : arr.clear)();
  else if (e.key === 'Insert' || key === 'i') arr.insertBar();
  else if (e.key === 'Enter') arr.openInEditor();
  else if (e.key === 'Escape') arr.clearSelection();
  else return false;
  return true;
}
