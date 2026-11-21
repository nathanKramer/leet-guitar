/**
 * Saving and opening project files.
 *
 * Where the browser supports the File System Access API (Chromium), Save writes back to the file that was last
 * opened or saved, like a desktop app. Elsewhere, Save downloads a copy and Open uses a file input.
 */
import { TRACK_KINDS } from '../model/instruments';
import { openProjectOps, parseProject, PROJECT_EXT, projectFileName, serializeProject } from '../model/project';
import { docStore, editor } from '../session';
import { notify, stop } from './actions';

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type PickerOpts = { types?: { description: string; accept: Record<string, string[]> }[]; suggestedName?: string };
declare global {
  interface Window {
    showSaveFilePicker?: (opts?: PickerOpts) => Promise<FileHandle>;
    showOpenFilePicker?: (opts?: PickerOpts) => Promise<FileHandle[]>;
  }
}

const PICKER_TYPES = [{ description: 'leet·guitar project', accept: { 'application/json': [PROJECT_EXT, '.json'] } }];

/** The file this tab last opened or saved (File System Access API only). Not shared with collaborators. */
let currentFile: FileHandle | null = null;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function projectBlob() {
  return new Blob([serializeProject(docStore.getSong())], { type: 'application/json' });
}

/** Save the song. `saveAs` always asks where; otherwise the last opened/saved file is overwritten. */
export async function saveProject(saveAs = false) {
  const name = projectFileName(docStore.getSong().meta.title);
  if (!window.showSaveFilePicker) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(projectBlob());
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify(`Downloaded ${name}.`);
    return;
  }
  try {
    const handle = (!saveAs && currentFile) || (await window.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES }));
    const out = await handle.createWritable();
    await out.write(projectBlob());
    await out.close();
    currentFile = handle;
    notify(`Saved ${handle.name}.`);
  } catch (e) {
    if (!isAbort(e)) notify(`Couldn't save: ${(e as Error).message}`);
  }
}

/** Ask for a project file and replace the current song with it (undoable). */
export async function openProject() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
      if (await loadProjectFile(await handle.getFile())) currentFile = handle;
    } catch (e) {
      if (!isAbort(e)) notify(`Couldn't open the file: ${(e as Error).message}`);
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = `${PROJECT_EXT},.json,application/json`;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void loadProjectFile(file);
  };
  input.click();
}

/** Replace the song with a project file's contents. Returns false (with a message) if it can't be opened. */
export async function loadProjectFile(file: File): Promise<boolean> {
  let project;
  try {
    project = parseProject(await file.text());
  } catch (e) {
    notify(`Couldn't open ${file.name}: ${(e as Error).message}`);
    return false;
  }
  if (editor.get().playing) stop();
  const { ops, firstTrackId } = openProjectOps(docStore.getSong(), project);
  docStore.transact(ops);
  const first = docStore.getSong().tracks[firstTrackId];
  editor.set({
    trackId: firstTrackId,
    cursor: 0,
    cursorString: first ? TRACK_KINDS[first.kind].homeLane : 0,
    selection: [],
  });
  const skipped = project.skipped ? ` ${project.skipped} invalid note${project.skipped === 1 ? ' was' : 's were'} left out.` : '';
  notify(`Opened ${file.name}.${skipped} Ctrl+Z undoes this.`);
  return true;
}
