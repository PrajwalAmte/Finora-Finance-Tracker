# Finora release plan

Goal: get Finora to real users on Android and iPhone while paying for the Apple account only when the iOS build is ready to go out.

## Costs

| Item | Cost | When it is needed | Notes |
|---|---|---|---|
| Apple Developer Program | **₹8,700 / year** (US $99) | TestFlight beta and App Store | Price reported by Indian developers at enrolment; confirm in the Apple Developer app. Several people report payment errors from India, so start enrolment a week before you need it |
| Google Play developer account | **US $25 once** (≈ ₹2,100) | Play Console, closed testing | Needs ID verification (a few days) |
| Domain (optional) | ≈ ₹800–1,000 / year | PWA address, privacy-policy URL | The free `*.vercel.app` address also works |
| PWA hosting, price functions, privacy-policy page | ₹0 | PWA, store listings | Vercel Hobby (free, non-commercial: the PWA stays free) |
| Testing on your own iPhone | ₹0 | Now | Xcode free provisioning (7-day builds), see [TESTING.md](TESTING.md) |
| **Total, year 1** | **≈ ₹10,800–11,800** | | Apple renews every year; Google does not |

Paying Apple last means the ₹8,700 year starts when you actually need TestFlight, not months before launch.

---

## Timeline

| Week | Stage | Spend | Outcome |
|---|---|---|---|
| 1 | Device testing on your iPhone (free provisioning) and Android emulator: TESTING.md Stage 1 | ₹0 | S1/S2 bugs fixed |
| 2 | Real-statement accuracy (Stage 2) + build the PWA ([PWA.md](PWA.md)) | ₹0 | Parsers match your statements; PWA live |
| 2 | Release prep checklist below (icons, privacy policy, final app id) | ₹0 | Store-ready builds |
| 3–4 | Family beta: PWA on iPhones, APK on Android (Stage 3) | ₹0 | 2 weeks of real use |
| 3 | Open Google Play account; start ID verification | ₹2,100 | |
| 4–6 | **Play closed test**: 12+ testers opted in for 14 consecutive days (required for new personal accounts) | — | Production access request |
| 5 | Enrol in Apple Developer Program | ₹8,700 | |
| 5–6 | TestFlight: internal testers immediately, external after Beta App Review (usually ~1 day) | — | iOS beta |
| 7 | Submit to App Store review and Play production | — | Launch |

Recruit the 12 Play testers from the family beta in week 3 so the 14 days start as soon as the account is verified. A tester who leaves restarts the count.

---

## Release prep checklist

**Identity, decide once and never change**
- [ ] Final app id / bundle id (now `app.finora.mobile`): `app/capacitor.config.ts`, Android `applicationId`, iOS bundle identifier. It cannot change after the first upload.
- [ ] App name: check "Finora" is free on both stores; have a fallback like "Finora: Money Vault".

**Assets**
- [ ] Icon (1024×1024, no transparency for iOS) and splash → `npx @capacitor/assets generate`.
- [ ] Screenshots: iPhone 6.9" and 6.5", Android phone; 4–6 each (Home, Invest, Tax, Loans simulator, Spend, Privacy).
- [ ] Short and long descriptions leading with "no account, nothing leaves your phone".

**Legal and policy**
- [ ] Privacy policy page (required by both stores): no data collected, the two price endpoints, local notifications, optional SMS reading on device, how to export/delete.
- [ ] App Store privacy label: **Data Not Collected**.
- [ ] Play Data safety form: no data collected or shared; data encrypted; users can delete it (erase vault).
- [ ] Play **Financial features declaration** (required for every app): personal finance tracking only, no loans or payments.
- [ ] Encryption export compliance: `ITSAppUsesNonExemptEncryption = false` is set (standard OS crypto only); confirm when App Store Connect asks.
- [ ] In-app tax disclaimer is already shown; add one line to the store description too.

**SMS on Android**
- [ ] Recommended: ship **v1.0 without `READ_SMS`** (remove that line in `AndroidManifest.xml` and hide the button), so the first review is not blocked by Google's SMS permission declaration.
- [ ] v1.1: add it back with the Permissions Declaration Form and a short video showing the in-app SMS review flow. iPhone's Shortcuts route needs no special approval.

**Signing and builds**
- [ ] Android: create an upload key (`keytool`), enrol in Play App Signing, store the keystore and passwords in your password manager *and* an offline copy. Losing the upload key means a support request to reset it.
- [ ] iOS: Xcode automatic signing with the paid team.
- [ ] Version scheme: `versionName`/`CFBundleShortVersionString` = 1.0.0; build numbers increase every upload. Add `npm run version:bump` to set both.
- [ ] CI: add release jobs that build a signed `.aab` (secrets in GitHub) and an iOS archive (later, optionally via fastlane).
- [ ] Release builds: `webContentsDebuggingEnabled` off (already), no `console.log` of data, minified bundle.

**Final checks**
- [ ] [TESTING.md](TESTING.md) exit criteria met.
- [ ] Upgrade test (L1) from the beta build to the release build.
- [ ] Fresh-install test on a phone that never had Finora.

---

## After launch

- **Crash reports without analytics:** use Play Console *Android vitals* and Xcode *Organizer → Crashes* (from users who share diagnostics with developers). No SDK, so the "Data Not Collected" promise holds.
- **Feedback:** a mailto link in Settings and the store review replies.
- **Yearly tax update:** the Union Budget is on 1 Feb. Update `src/domain/tax/rules.ts` if rates or the 112A exemption change, add tests, and ship before 1 April.
- **Parser drift:** CAMS, KFintech and banks change layouts. When a user reports a failed import, ask for the anonymised text (not the PDF) and add a test.
- **Release rhythm:** monthly bug-fix releases; keep the PWA on the same version so backups move freely between them.
