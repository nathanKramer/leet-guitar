/**
 * Which sound engine plays the song: the built-in synth (default) or a SoundFont the user
 * loaded from disk. This is a local listening preference: never synced, never part of the song.
 * The SoundFont file itself is kept in IndexedDB so it survives reloads.
 */
import type { SoundEngine } from '../audio/engine';
import type { Instrument } from '../model/gm';
import { builtInEngine, player } from '../session';
import { fileStore } from '../sync/fileStore';
import { stop } from './actions';
import { createStore } from './editorStore';

export type SoundSource = 'builtin' | 'soundfont';

export interface SoundState {
  source: SoundSource;
  /** File name of the loaded SoundFont, if any. */
  fontName: string | null;
  loading: boolean;
  error: string | null;
  /** The loaded SoundFont's melodic instruments, for the instrument menus. */
  instruments: Instrument[] | null;
}

const FILE_KEY = 'soundfont';
const SOURCE_KEY = 'leet-guitar:sound-source';

interface StoredFont {
  name: string;
  data: ArrayBuffer;
}

export const sound = createStore<SoundState>({
  source: 'builtin',
  fontName: null,
  loading: false,
  error: null,
  instruments: null,
});

let fontEngine: SoundEngine | null = null;

function rememberSource(source: SoundSource) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* storage unavailable */
  }
}

export function setSource(source: SoundSource) {
  if (source === 'soundfont' && !fontEngine) return;
  stop();
  player.setEngine(source === 'soundfont' ? fontEngine! : builtInEngine);
  sound.set({ source });
  rememberSource(source);
}

async function activate(font: StoredFont, select: boolean): Promise<boolean> {
  sound.set({ loading: true, error: null });
  try {
    const { SoundFontEngine } = await import('../audio/soundfont');
    const engine = await SoundFontEngine.create(font.data);
    const previous = fontEngine;
    fontEngine = engine;
    sound.set({ fontName: font.name, loading: false, instruments: engine.instruments() });
    if (select) setSource('soundfont');
    else if (sound.get().source === 'soundfont') player.setEngine(engine);
    previous?.dispose();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sound.set({ loading: false, error: `Couldn't load ${font.name}: ${message}` });
    return false;
  }
}

/** Load a SoundFont the user picked, switch to it, and remember it for next time. */
export async function loadSoundFontFile(file: File) {
  const font: StoredFont = { name: file.name, data: await file.arrayBuffer() };
  if (await activate(font, true)) {
    try {
      await fileStore.put(FILE_KEY, font);
    } catch {
      sound.set({ error: 'Loaded, but the browser would not store it; you will need to load it again next time.' });
    }
  }
}

export async function removeSoundFont() {
  setSource('builtin');
  fontEngine?.dispose();
  fontEngine = null;
  sound.set({ fontName: null, error: null, instruments: null });
  try {
    await fileStore.delete(FILE_KEY);
  } catch {
    /* nothing stored */
  }
}

/** On startup, bring back the SoundFont from last time (if any) and the chosen source. */
export async function restoreSound() {
  let font: StoredFont | undefined;
  try {
    font = await fileStore.get<StoredFont>(FILE_KEY);
  } catch {
    return;
  }
  if (!font) return;
  let wanted: string | null = null;
  try {
    wanted = localStorage.getItem(SOURCE_KEY);
  } catch {
    /* storage unavailable */
  }
  await activate(font, wanted !== 'builtin');
}
