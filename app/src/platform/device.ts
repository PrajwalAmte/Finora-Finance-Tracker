import { App } from '@capacitor/app';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { fromB64, toB64 } from '../vault/crypto';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform() as 'android' | 'ios' | 'web';

/** What this build can do. The PWA has no biometrics, OCR, SMS, scheduled notifications or screen protection. */
export function capabilities() {
  const p = platform();
  return {
    biometrics: p !== 'web',
    scan: p !== 'web',
    smsRead: p === 'android',
    smsShortcut: p === 'ios',
    reminders: p !== 'web',
  };
}

/** Running as an installed web app (home-screen icon) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (isNative()) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Safari or another browser on an iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIosBrowser(): boolean {
  if (isNative()) return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Ask the browser not to evict the vault under storage pressure. No-op in the native apps. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (isNative() || !navigator.storage?.persist) return isNative();
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<{ persisted: boolean; usage?: number; quota?: number }> {
  if (isNative() || !navigator.storage) return { persisted: true };
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.().catch(() => false) ?? false,
    navigator.storage.estimate?.().catch(() => undefined),
  ]);
  return { persisted, usage: estimate?.usage, quota: estimate?.quota };
}

// ── Network (only market data uses this) ────────────────────────────────────

/** GET as text. Native builds go through the OS HTTP stack, so third-party sites need no CORS headers. */
export async function httpGetText(url: string, headers: Record<string, string> = {}): Promise<string> {
  if (isNative()) {
    const res = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 15000, readTimeout: 30000 });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

// ── Files in and out ─────────────────────────────────────────────────────────

export interface PickedFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export async function pickFile(types: string[]): Promise<PickedFile | null> {
  try {
    const res = await FilePicker.pickFiles({ types, limit: 1, readData: true });
    const f = res.files[0];
    if (!f) return null;
    const bytes = f.data ? fromB64(f.data) : f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : null;
    if (!bytes) return null;
    return { name: f.name, mimeType: f.mimeType, bytes };
  } catch (e) {
    if (e instanceof Error && /cancel/i.test(e.message)) return null;
    throw e;
  }
}

export async function pickImage(): Promise<PickedFile | null> {
  return pickFile(['image/png', 'image/jpeg', 'image/webp', 'image/heic']);
}

/** Hand a file to the OS share sheet (Drive, Files, WhatsApp, AirDrop, email…). */
export async function shareFile(fileName: string, data: Uint8Array | string, mimeType: string, title: string): Promise<void> {
  if (!isNative()) {
    const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mimeType });
    // Phones: the system share sheet (save to Files/Drive, send to the other phone). If the browser
    // refuses because preparing the file took too long after the tap, fall back to a download.
    const file = new File([blob], fileName, { type: mimeType });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return;
  }
  const written = await Filesystem.writeFile({
    path: `share/${fileName}`,
    directory: Directory.Cache,
    data: typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : toB64(data),
    recursive: true,
  });
  try {
    await Share.share({ title, files: [written.uri], dialogTitle: title });
  } finally {
    // The shared copy is not needed once the sheet closes.
    setTimeout(() => {
      Filesystem.deleteFile({ path: `share/${fileName}`, directory: Directory.Cache }).catch(() => {});
    }, 60_000);
  }
}

// ── Look and feel ────────────────────────────────────────────────────────────

export async function tap(): Promise<void> {
  if (isNative()) await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export async function applyStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
}

/** Blocks screenshots/recording on Android and blanks the app in the task switcher on both platforms. */
export async function setScreenProtection(on: boolean): Promise<void> {
  if (!isNative()) return;
  await (on ? PrivacyScreen.enable() : PrivacyScreen.disable()).catch(() => {});
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function onAppState(handler: (active: boolean) => void): () => void {
  if (!isNative()) {
    const fn = () => handler(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }
  const p = App.addListener('appStateChange', s => handler(s.isActive));
  return () => { p.then(h => h.remove()); };
}

export function onBackButton(handler: () => boolean): () => void {
  if (!isNative()) return () => {};
  const p = App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp().catch(() => {});
  });
  return () => { p.then(h => h.remove()); };
}

/**
 * Deep links (finora://…). Used by the iOS Shortcuts automation that forwards bank SMS. Calls the
 * handler for the URL that launched the app and for every later one.
 */
export function onAppUrl(handler: (url: string) => void): () => void {
  if (!isNative()) return () => {};
  App.getLaunchUrl().then(res => { if (res?.url) handler(res.url); }).catch(() => {});
  const p = App.addListener('appUrlOpen', e => handler(e.url));
  return () => { p.then(h => h.remove()); };
}

// ── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  id: number;
  title: string;
  body: string;
  at: Date;
}

/** Replace all scheduled reminders. Notifications are generated and delivered on the device. */
export async function scheduleReminders(reminders: Reminder[]): Promise<void> {
  if (!isNative()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    const future = reminders.filter(r => r.at.getTime() > Date.now()).slice(0, 60);
    if (future.length) {
      await LocalNotifications.schedule({ notifications: future.map(r => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true } })) });
    }
  } catch {
    // Reminders are best-effort.
  }
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative()) return false;
  const res = await LocalNotifications.requestPermissions();
  return res.display === 'granted';
}
