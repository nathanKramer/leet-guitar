import { useSyncExternalStore } from 'react';
import type { BaseDuration } from '../model/durations';
import type { ChannelMode } from '../midi/export';
import type { ID } from '../model/types';

/** Local, per-user UI state. Never synced or persisted with the document. */
export interface EditorState {
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
  /** Pixels per tick in the timeline. */
  zoom: number;
  midiMode: ChannelMode;
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
