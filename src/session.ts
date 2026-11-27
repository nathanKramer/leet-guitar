/**
 * Wires one editing session together: document store, persistence, sync, presence,
 * audio and local editor state. Open the app with `#doc=<name>` to work on a
 * different document; tabs open on the same document edit it together.
 */
import { useSyncExternalStore } from 'react';
import { BuiltInEngine } from './audio/builtin';
import { Player } from './audio/player';
import { createStore, type EditorState, type EntrySurface } from './editor/editorStore';
import { DEFAULT_TRACK_ID, initDocument } from './model/commands';
import { newId } from './model/id';
import { DocumentStore } from './model/store';
import { Awareness } from './sync/awareness';
import { BroadcastChannelProvider } from './sync/broadcastChannel';
import { attachPersistence, loadSnapshot } from './sync/persistence';

const PEER_COLORS = ['#4fc3f7', '#ba68c8', '#81c784', '#ff8a65', '#f06292', '#9575cd', '#4db6ac'];

export const docId = new URLSearchParams(location.hash.slice(1)).get('doc') ?? 'default';
const actor = newId().replace(/-/g, '').slice(0, 10);

export const docStore = new DocumentStore({ actor, state: loadSnapshot(docId) });
docStore.transact(initDocument(docStore.getSong()), { undoable: false });
attachPersistence(docStore, docId);

const COUNT_IN_KEY = 'leet-guitar:count-in';

/** The count-in setting is remembered in this browser (on unless turned off). */
function loadCountIn() {
  try {
    return localStorage.getItem(COUNT_IN_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveCountIn(on: boolean) {
  try {
    localStorage.setItem(COUNT_IN_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered (private window or blocked storage); the setting still applies to this tab.
  }
}

export const editor = createStore<EditorState>({
  view: 'edit',
  arrSel: { blocks: [], anchor: null, focus: null },
  trackId: DEFAULT_TRACK_ID,
  cursor: 0,
  cursorString: 0,
  base: 'eighth',
  triplet: false,
  dotted: false,
  chordMode: false,
  selection: [],
  playing: false,
  playhead: null,
  barsPerRow: 4,
  rowWidth: 1000,
  midiMode: 'per-track',
  countIn: loadCountIn(),
  countBeat: null,
  mutedTracks: [],
  soloTracks: [],
  entry: loadEntry(),
  notice: null,
});

export const awareness = new Awareness({
  actor,
  name: `Guest ${actor.slice(0, 4)}`,
  color: PEER_COLORS[parseInt(actor.slice(0, 6), 16) % PEER_COLORS.length] ?? PEER_COLORS[0],
  cursor: 0,
  string: 0,
  trackId: DEFAULT_TRACK_ID,
});
const ENTRY_KEY = 'leet-guitar:entry';

/** The fretboard / piano choice for entering notes is remembered in this browser. */
function loadEntry(): EntrySurface | null {
  try {
    const v = localStorage.getItem(ENTRY_KEY);
    return v === 'fretboard' || v === 'piano' ? v : null;
  } catch {
    return null;
  }
}

export function saveEntry(entry: EntrySurface) {
  try {
    localStorage.setItem(ENTRY_KEY, entry);
  } catch {
    // Not remembered; the choice still applies to this tab.
  }
}

editor.subscribe(() => {
  const s = editor.get();
  awareness.setLocal({ cursor: s.cursor, string: s.cursorString, trackId: s.trackId });
});

new BroadcastChannelProvider(docId).connect(docStore, awareness);

export const builtInEngine = new BuiltInEngine();
export const player = new Player(builtInEngine);
player.mix(docStore.getSong());
docStore.subscribe(() => player.mix(docStore.getSong()));

export function useSong() {
  return useSyncExternalStore(docStore.subscribe, docStore.getSong);
}

export function usePeers() {
  return useSyncExternalStore(awareness.subscribe, awareness.getPeers);
}
