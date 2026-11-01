/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  /** OAuth client id for "Save vault to Google Drive" (PWA). Empty hides the option. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Dropbox app key for "Save vault to Dropbox" (PWA). Empty hides the option. */
  readonly VITE_DROPBOX_APP_KEY?: string;
}

/** Build time, injected by Vite. */
declare const __BUILD_ID__: string;
