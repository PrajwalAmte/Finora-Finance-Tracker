# Finora PWA plan

A Progressive Web App built from the same `app/` code: installed from Safari/Chrome to the home screen, works offline, and needs no App Store account. It is the free way to get Finora onto iPhones while the native app is being tested, and it also gives a desktop version.

**Status: built.** `npm run build:pwa` produces `app/dist-pwa/`; prices come from two small Vercel Functions in `app/api/` on the same domain. Deployment steps are at the end of this page. Not built yet: Tesseract screenshot scanning and passkey unlock (both optional).

---

## What works in the PWA

| Feature | Native app | PWA | Notes |
|---|---|---|---|
| Vault, encryption, autosave | ✅ | ✅ | WebCrypto is identical; files go to IndexedDB (the Filesystem plugin's web fallback, already used by `npm run dev`) |
| Unlock | Passphrase, Face ID / fingerprint, recovery code | Passphrase, recovery code | Passkey unlock possible later (see below) |
| Statement import (PDF/Excel/CSV) | ✅ | ✅ | Same parsers; file input instead of the native picker |
| Bank statement import | ✅ | ✅ | |
| Quick add, categories, undo | ✅ | ✅ | |
| Tax, XIRR, loans, simulator, goals, calendar, insights | ✅ | ✅ | Pure TypeScript |
| Export / import backup | Share sheet | Web Share (iOS/Android) or download (desktop) | |
| Excel report, emergency PDF, 112A CSV | ✅ | ✅ | |
| NAV and stock price refresh | Direct | Via the app's own `/api` functions | AMFI and Yahoo send no CORS headers, so a browser cannot fetch them (checked) |
| Payment screenshot → expense | Vision / ML Kit | Optional | Tesseract.js on-device: works, but ~10 MB download and less accurate |
| Bank SMS | Android: reads SMS; iPhone: Shortcuts | ❌ | iOS opens links from Shortcuts in Safari, not in the installed web app, and the two have separate storage |
| EMI/SIP reminders | Local notifications | ❌ | The web has no scheduled local notifications; push would need a server |
| Screenshot blocking, app-switcher blur | ✅ | ❌ | Not available to web pages |

## Price refresh in the PWA (decided: Vercel Functions)

`app/api/amfi.ts` and `app/api/yahoo/[symbol].ts` run on Vercel next to the app, so the PWA calls `/api/amfi` and `/api/yahoo/INFY.NS` on its own domain (no CORS setup, no separate service). They relay exactly two public endpoints, forward no headers or cookies, store nothing, and refuse requests that browsers mark as coming from other websites. Vercel's CDN caches the AMFI file for 6 hours and quotes for 5 minutes, so AMFI and Yahoo are hit rarely. The AMFI file is the same for everyone; Yahoo requests reveal only which symbols are priced. The native apps keep calling AMFI and Yahoo directly.

Vercel's Hobby plan is free for non-commercial use, which fits a free PWA. If the PWA ever becomes part of a paid product, move to Vercel Pro or to a host whose free tier allows commercial use; the functions are plain `Request → Response` code and port easily.

## The iPhone storage caveat

Safari can delete a website's data after 7 days without a visit, but **web apps added to the Home Screen are exempt** and have their own storage. Data can still be lost if the user deletes the web app or iOS clears storage under heavy pressure. So the PWA will:

- refuse to create a vault in a normal Safari tab on iOS, and instead show "Add to Home Screen" instructions;
- call `navigator.storage.persist()` and show the result in Settings;
- nag for an encrypted export weekly instead of monthly;
- show a one-line warning that deleting the web app deletes its data.

## Passkey unlock (later, optional)

iOS 18+ Safari supports the WebAuthn **PRF** extension with iCloud Keychain passkeys, which can produce a stable secret to wrap the vault's data key, just as Face ID does in the native app. Reports show bugs in cross-device flows and a changed-output problem on some versions, so it would be an *extra* wrapper only: the passphrase and recovery code still open the vault, so a PRF failure can never lock anyone out. Ship v1 without it.

---

## Work items

| # | Task | Files | Days |
|---|---|---|---|
| 1 | `vite-plugin-pwa`: web manifest (name, colours, `display: standalone`), service worker that precaches the bundle, "new version available" prompt | `vite.config.ts`, `src/ui/pwa.ts` | 0.5 |
| 2 | Icons (192/512/maskable/Apple touch) and splash colours; reuse for native via `@capacitor/assets` | `public/`, `assets/` | 0.5 |
| 3 | Separate build target: `npm run build:pwa` with absolute base `/` and the PWA plugin enabled; native build unchanged | `package.json`, `vite.config.ts` | 0.25 |
| 4 | Install gate on iOS Safari (not standalone) and install hints for Android/desktop | `src/ui/pages/Install.tsx` | 0.5 |
| 5 | `navigator.storage.persist()` + usage display; weekly export reminder when `platform() === 'web'` | `platform/device.ts`, `domain/insights.ts` | 0.5 |
| 6 | Export via `navigator.share({ files })` when available, download otherwise | `platform/device.ts` | 0.25 |
| 7 | Hide native-only features on web (scan, SMS, reminders, biometrics, screen protection) behind one `capabilities()` helper | `platform/device.ts`, Spend/Settings | 0.5 |
| 8 | Price functions on Vercel (`/api/amfi`, `/api/yahoo/:symbol`), also served by the Vite dev/preview server | `api/`, `market/prices.ts`, `vite.config.ts` | 0.5 |
| 9 | Hosting on Vercel (Git integration, `vercel.json`); custom domain optional | `app/vercel.json` | 0.25 |
| 10 | Optional: Tesseract.js screenshot scanning, lazy-loaded only when used | `platform/capture.ts` | 1 |
| 11 | Test on iPhone Safari (installed), Android Chrome, desktop Chrome/Safari: sections A (passphrase parts), B, D, G, H, I of [TESTING.md](TESTING.md) | — | 1 |

## Same data on PWA and native

Both use the same vault format, so moving between them is the normal backup flow: export from one, import in the other. Someone can start on the PWA during the beta and move to the App Store app later without losing anything.

---

## Deploying to Vercel (one-time setup, about 10 minutes, ₹0)

1. Push the branch to GitHub (Vercel deploys from there).
2. Sign in at vercel.com with GitHub (Hobby plan, free) → **Add New → Project** → import the Finora repository.
3. In the import screen set **Root Directory** to `app`. Leave the framework as **Other**; `app/vercel.json` already sets the install command, `npm run build:pwa`, the `dist-pwa` output and security headers.
4. Click **Deploy**. You get an address like `https://finora-<something>.vercel.app`; rename the project to get `https://finora.vercel.app` if the name is free.
5. **Production branch:** Vercel uses the repository's default branch (`main`). Until `mobile-local-first` is merged, every push to it gets its own *preview* URL, which works the same for testing.
6. **Check on your iPhone:** open the address in Safari → "Add Finora to your Home Screen" → install → create a vault → add a fund → refresh prices.

After that, every push deploys automatically; there are no tokens or secrets to manage. A custom domain can be added in Project → Settings → Domains.

## Local development

```bash
cd app && npm run dev                                   # http://localhost:5173, /api served by Vite
cd app && npm run build:pwa && npm run preview:pwa      # production build with the service worker, http://localhost:4173
```

The Vite dev and preview servers run the same `/api` code that Vercel runs, so prices work locally without the Vercel CLI.
