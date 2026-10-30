export type ProviderId = 'gdrive' | 'dropbox';

export interface Tokens {
  accessToken: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
  refreshToken?: string;
}

/** One cloud account linked on this device. Kept in the device-only encrypted secrets file. */
export interface Connection {
  provider: ProviderId;
  account: string;
  tokens: Tokens;
  /** Last revision this device uploaded or merged, to skip no-op work. */
  lastRev?: string;
  lastSyncAt?: string;
}

export interface RemoteFile {
  bytes: Uint8Array<ArrayBuffer>;
  /** Opaque revision used for conflict-safe writes. */
  rev: string;
}

/** Thrown when someone else wrote the file between our read and our write. */
export class ConflictError extends Error {
  constructor() {
    super('The cloud copy changed while saving');
    this.name = 'ConflictError';
  }
}

export class AuthError extends Error {
  constructor(message = 'Sign-in expired. Reconnect to keep syncing.') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Storage operations a provider implements. Tokens are fresh when these are called. */
export interface CloudStorage {
  download(): Promise<RemoteFile | null>;
  /** Write the file. `rev` null = create; otherwise only succeed if the file is still at `rev`. */
  upload(bytes: Uint8Array, rev: string | null): Promise<string>;
}
