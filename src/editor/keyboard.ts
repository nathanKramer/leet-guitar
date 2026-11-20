import { docStore, editor } from '../session';
import * as act from './actions';
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
  if (pendingDigit && now - pendingDigit.at < DIGIT_WINDOW_MS && docStore.getSong().notes[pendingDigit.id]) {
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
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function handleKeyDown(e: KeyboardEvent) {
  if (isTyping(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
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
        else act.moveCursor(dir * act.stepTicks());
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
      case 't':
      case 'T':
        act.toggleTriplet();
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
