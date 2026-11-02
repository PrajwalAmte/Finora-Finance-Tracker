import { AuthError, ConflictError, type CloudStorage, type ProviderId, type RemoteFile, type Tokens } from './types';
import { CLOUD_FILE_NAME } from './format';
import { challengeFor, newVerifier, redirectUri, savePending, type OAuthPurpose } from './oauth';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY ?? '';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Set up for this build (client id / app key present). */
  available: boolean;
}

export function providers(): ProviderInfo[] {
  return [
    { id: 'gdrive', label: 'Google Drive', available: !!GOOGLE_CLIENT_ID },
    { id: 'dropbox', label: 'Dropbox', available: !!DROPBOX_APP_KEY },
  ];
}

export function providerLabel(id: ProviderId): string {
  return id === 'gdrive' ? 'Google Drive' : 'Dropbox';
}

const randomState = () => crypto.randomUUID();

/** Leave for the provider's sign-in page. The app reloads on return; see completeSignIn. */
export async function beginSignIn(provider: ProviderId, purpose: OAuthPurpose): Promise<void> {
  const verifier = newVerifier();
  const challenge = await challengeFor(verifier);
  const state = randomState();
  savePending({ provider, state, verifier, purpose });
  const url = provider === 'gdrive'
    ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      // drive.file: only files Finora itself creates; the rest of the Drive stays invisible to it.
      scope: 'https://www.googleapis.com/auth/drive.file openid email',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })}`
    : `https://www.dropbox.com/oauth2/authorize?${new URLSearchParams({
      client_id: DROPBOX_APP_KEY,
      redirect_uri: redirectUri(),
      response_type: 'code',
      token_access_type: 'offline',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })}`;
  location.assign(url);
}

function decodeJwtEmail(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

/** Swap the one-time code for tokens and find out which account was linked. */
export async function completeSignIn(provider: ProviderId, code: string, verifier: string): Promise<{ tokens: Tokens; account: string }> {
  if (provider === 'gdrive') {
    const res = await fetch('/api/google/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: redirectUri() }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error === 'not_configured' ? 'Google Drive is not set up on this server' : `Google sign-in failed (${data.error ?? `server answered ${res.status}`})`);
    return {
      tokens: { accessToken: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000, refreshToken: data.refresh_token },
      account: decodeJwtEmail(data.id_token) ?? 'Google account',
    };
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: DROPBOX_APP_KEY, redirect_uri: redirectUri() }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!res.ok || !data.access_token) throw new Error('Dropbox sign-in failed');
  const tokens: Tokens = { accessToken: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 14400) - 60) * 1000, refreshToken: data.refresh_token };
  let account = 'Dropbox account';
  try {
    const me = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (me.ok) account = ((await me.json()) as { email?: string }).email ?? account;
  } catch {
    // The label is cosmetic.
  }
  return { tokens, account };
}

/** A fresh access token, refreshing when it is about to expire. */
export async function freshTokens(provider: ProviderId, tokens: Tokens): Promise<Tokens> {
  if (tokens.expiresAt > Date.now() + 30_000) return tokens;
  if (!tokens.refreshToken) throw new AuthError();
  if (provider === 'gdrive') {
    const res = await fetch('/api/google/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !data.access_token) throw new AuthError();
    return { ...tokens, accessToken: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 };
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: DROPBOX_APP_KEY }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new AuthError();
  return { ...tokens, accessToken: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 14400) - 60) * 1000 };
}

// ── Google Drive (drive.file scope: a single visible file in My Drive) ─────

function googleDrive(token: string): CloudStorage {
  const auth = { Authorization: `Bearer ${token}` };
  const check = (res: Response) => {
    if (res.status === 401 || res.status === 403) throw new AuthError();
    if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
    return res;
  };
  const find = async (): Promise<{ id: string; version: string } | null> => {
    const q = `name = '${CLOUD_FILE_NAME}' and trashed = false`;
    const res = check(await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, spaces: 'drive', fields: 'files(id,version,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '1' })}`, { headers: auth }));
    const files = ((await res.json()) as { files?: { id: string; version: string }[] }).files ?? [];
    return files[0] ?? null;
  };
  return {
    async download(): Promise<RemoteFile | null> {
      const meta = await find();
      if (!meta) return null;
      const res = check(await fetch(`https://www.googleapis.com/drive/v3/files/${meta.id}?alt=media`, { headers: auth }));
      return { bytes: new Uint8Array(await res.arrayBuffer()), rev: `${meta.id}:${meta.version}` };
    },
    async upload(bytes, rev) {
      if (!rev) {
        // Never create a second file: if one appeared since we looked, it is a conflict.
        if (await find()) throw new ConflictError();
        const boundary = `finora${crypto.randomUUID()}`;
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: CLOUD_FILE_NAME, mimeType: 'application/json', description: 'Encrypted Finora vault. Needs your Finora passphrase to open.' })}\r\n`,
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n`, new Uint8Array(bytes), `\r\n--${boundary}--`,
        ]);
        const res = check(await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', { method: 'POST', headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }));
        const f = (await res.json()) as { id: string; version: string };
        return `${f.id}:${f.version}`;
      }
      const [id, version] = rev.split(':');
      // Drive v3 has no conditional write, so compare versions right before writing.
      const now = check(await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=version,trashed`, { headers: auth }));
      const current = (await now.json()) as { version: string; trashed?: boolean };
      if (current.trashed || current.version !== version) throw new ConflictError();
      const res = check(await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: new Uint8Array(bytes) }));
      const f = (await res.json()) as { id: string; version: string };
      return `${f.id}:${f.version}`;
    },
  };
}

// ── Dropbox (App folder: Apps/Finora/) ─────────────────────────────────────

const DROPBOX_PATH = `/${CLOUD_FILE_NAME}`;

function dropbox(token: string): CloudStorage {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    async download(): Promise<RemoteFile | null> {
      const res = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { ...auth, 'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_PATH }) } });
      if (res.status === 401) throw new AuthError();
      if (res.status === 409) return null; // path/not_found
      if (!res.ok) throw new Error(`Dropbox error ${res.status}`);
      const meta = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as { rev?: string };
      return { bytes: new Uint8Array(await res.arrayBuffer()), rev: meta.rev ?? '' };
    },
    async upload(bytes, rev) {
      const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' };
      const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_PATH, mode, autorename: false, mute: true, strict_conflict: true }) },
        body: new Uint8Array(bytes),
      });
      if (res.status === 401) throw new AuthError();
      if (res.status === 409) throw new ConflictError();
      if (!res.ok) throw new Error(`Dropbox error ${res.status}`);
      return ((await res.json()) as { rev: string }).rev;
    },
  };
}

export function storageFor(provider: ProviderId, accessToken: string): CloudStorage {
  return provider === 'gdrive' ? googleDrive(accessToken) : dropbox(accessToken);
}
