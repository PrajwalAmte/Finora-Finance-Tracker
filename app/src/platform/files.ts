import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { fromB64, toB64 } from '../vault/crypto';

/**
 * Private app storage (Directory.Data: the app sandbox, not visible to other apps or the user's
 * file manager, and excluded from nothing by default). On the web build used for development the
 * Filesystem plugin falls back to IndexedDB.
 */
const DIR = Directory.Data;
const FOLDER = 'finora';

const path = (name: string) => `${FOLDER}/${name}`;

async function ensureFolder(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: FOLDER, directory: DIR, recursive: true });
  } catch {
    // Already exists.
  }
}

export async function exists(name: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: path(name), directory: DIR });
    return true;
  } catch {
    return false;
  }
}

export async function readBytes(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const res = await Filesystem.readFile({ path: path(name), directory: DIR });
    if (typeof res.data !== 'string') return new Uint8Array(await res.data.arrayBuffer());
    return fromB64(res.data);
  } catch {
    return null;
  }
}

export async function readText(name: string): Promise<string | null> {
  try {
    const res = await Filesystem.readFile({ path: path(name), directory: DIR, encoding: Encoding.UTF8 });
    return typeof res.data === 'string' ? res.data : await res.data.text();
  } catch {
    return null;
  }
}

/**
 * Crash-safe write: write a temp file, move the current file to `.bak`, then move the temp file in.
 * If the app dies mid-write the previous version is still on disk under one of the two names.
 */
export async function writeAtomic(name: string, data: Uint8Array | string, keepBackup = false): Promise<void> {
  await ensureFolder();
  const tmp = `${name}.tmp`;
  if (typeof data === 'string') {
    await Filesystem.writeFile({ path: path(tmp), directory: DIR, data, encoding: Encoding.UTF8 });
  } else {
    await Filesystem.writeFile({ path: path(tmp), directory: DIR, data: toB64(data) });
  }
  if (keepBackup && (await exists(name))) {
    await removeFile(`${name}.bak`);
    await Filesystem.rename({ from: path(name), to: path(`${name}.bak`), directory: DIR, toDirectory: DIR });
  } else {
    await removeFile(name);
  }
  await Filesystem.rename({ from: path(tmp), to: path(name), directory: DIR, toDirectory: DIR });
}

export async function removeFile(name: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: path(name), directory: DIR });
  } catch {
    // Not there.
  }
}

/** Public, rebuildable data (NAV and price caches). Lives in the OS cache directory, unencrypted. */
export async function readCache(name: string): Promise<string | null> {
  try {
    const res = await Filesystem.readFile({ path: `${FOLDER}/${name}`, directory: Directory.Cache, encoding: Encoding.UTF8 });
    return typeof res.data === 'string' ? res.data : await res.data.text();
  } catch {
    return null;
  }
}

export async function writeCache(name: string, data: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path: FOLDER, directory: Directory.Cache, recursive: true });
  } catch {
    // Already exists.
  }
  await Filesystem.writeFile({ path: `${FOLDER}/${name}`, directory: Directory.Cache, data, encoding: Encoding.UTF8 });
}
