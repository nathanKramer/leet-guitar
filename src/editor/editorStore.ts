import { useSyncExternalStore } from 'react';
import type { BaseDuration } from '../model/durations';
import type { ChannelMode } from '../midi/export';
import type { ID } from '../model/types';

/** Row lengths the timeline can be set to (zoom in = fewer bars per row). */
export const BARS_PER_ROW = [1, 2, 4, 8];

/** Local, per-user UI state. Never synced or persisted with the document. */
export interface EditorState {
  /** Which view fills the main area: the note editor, or the bar-by-bar arrangement of all tracks. */
  view: 'edit' | 'arrange';
  /** Selected bars in the arrangement view (numbered from 0): the bar clicked first and the one extended to. */
  barSel: { anchor: number; focus: number } | null;
  trackId: ID;
  cursor: number;
  cursorString: number;
  base: BaseDuration;
  triplet: boolean;
  /** When on, entering a note doesn't advance the cursor (build chords). */
  chordMode: boolean;
  selection: ID[];
  playing: boolean;
  playhead: number | null;
  /** How many bars each timeline row holds; rows stack vertically and stretch to the timeline's width. */
  barsPerRow: number;
  /** Measured width (px) of the timeline. */
  rowWidth: number;
  midiMode: ChannelMode;
  /** Play a bar of metronome clicks before playback starts. */
  countIn: boolean;
  /** The count-in beat being clicked right now (1, 2, …), or null when not counting in. */
  countBeat: number | null;
  /** Tracks silenced during playback (a local listening choice, not part of the song). */
  mutedTracks: ID[];
  /** Soloed tracks: while any are soloed, only they play (still a local listening choice). */
  soloTracks: ID[];
  /** A short message for the status bar (e.g. what a paste had to change); clears itself. */
  notice: string | null;
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
