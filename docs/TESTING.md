# Finora test plan

How to prove the app is correct and safe with real money data before anyone else installs it. Work through it top to bottom; each stage gates the next.

| Stage | What | Cost | Who | Time |
|---|---|---|---|---|
| 0 | Automated checks (already in CI) | ₹0 | CI | every push |
| 1 | Your own iPhone + Android emulator | ₹0 | you | 1 week |
| 2 | Real-statement accuracy against your own statements | ₹0 | you + family | 3–4 days |
| 3 | Family beta on the PWA (and Android APK) | ₹0 | 5–10 people | 2 weeks |
| 4 | Store betas: Play closed test, TestFlight | see [RELEASE.md](RELEASE.md) | 12+ people | 2–3 weeks |

---

## Stage 0 — Automated (already running)

`npm test` (82 tests), `npm run lint`, `npm run typecheck`, `npm run build`, plus CI jobs that compile the Android APK and the iOS simulator app. These cover the money maths, tax rules, crypto, merge, parsers and importers with synthetic data. Keep them green; every bug found below should come back as a new unit test.

---

## Stage 1 — Devices, free

### iPhone without paying Apple (free provisioning)

You can run the app on your own iPhone with a free Apple ID; you only pay ₹8,700/yr when you need TestFlight or the App Store.

1. Install Xcode from the Mac App Store, open it once, accept the licence, then run `sudo xcode-select -s /Applications/Xcode.app`.
2. Xcode → Settings → Accounts → add your Apple ID (creates a free "Personal Team").
3. `cd app && npm run ios`. In Xcode select the **App** target → Signing & Capabilities → Team = your Personal Team. If Xcode says the bundle id is taken, change it to something unique like `com.<yourname>.finora` (also in `capacitor.config.ts`).
4. Connect the iPhone by cable, enable **Developer Mode** (Settings → Privacy & Security), pick it as the run destination, press Run.
5. On the phone: Settings → General → VPN & Device Management → trust your developer certificate.

Limits: the build expires after **7 days** (run it again from Xcode; data stays because the bundle id is the same), and at most 3 apps per free account. Face ID, Keychain, Vision, notifications and Shortcuts all work.

### Android

- Android Studio emulator (Pixel, API 34+) for most tests.
- **SMS without a SIM**: with the emulator running,
  ```bash
  adb emu sms send HDFCBK "Rs.450.00 debited from A/c XX1234 on 12-10-26 to VPA chaipoint@okicici. UPI Ref 4291873645"
  ```
- A real Android phone over USB (enable Developer options → USB debugging) for biometrics, camera roll and performance.

### Test cases

Record results in a copy of the table: ✅ pass, ❌ fail (with a note), ➖ not applicable. Run each on **iPhone** and **Android** unless marked.

**A. Vault and security**

| ID | Steps | Expected |
|---|---|---|
| A1 | Fresh install → Create vault with an 8+ char passphrase | Recovery code shown once; confirming the last group is required |
| A2 | Enable Face ID / fingerprint at onboarding; kill app; reopen | Biometric prompt appears by itself; unlocks |
| A3 | Cancel biometric prompt | Passphrase screen; correct passphrase unlocks |
| A4 | Wrong passphrase 5× | Clear error each time; "Erase vault" link appears only after 5 |
| A5 | "Forgot passphrase?" → enter recovery code in lower case with O instead of 0 | Unlocks |
| A6 | Settings → Change passphrase; lock; unlock with old (fails) and new (works) | As described; recovery code still works |
| A7 | Settings → New recovery code; try the old one | Old code rejected |
| A8 | Auto-lock = 1 min; background the app for 2 min; return | Lock screen |
| A9 | Open the app switcher | App contents hidden (blank/blurred) |
| A10 (Android) | Take a screenshot inside the app | Blocked |
| A11 | Turn biometrics off in Settings; lock | Only passphrase offered |
| A12 | Delete the app and reinstall | Onboarding (no data); importing a backup restores it |

**B. Persistence and crash safety**

| ID | Steps | Expected |
|---|---|---|
| B1 | Add an expense, immediately swipe the app away | Expense present after reopening |
| B2 | Airplane mode, use every tab | Everything works except price refresh, which shows a clear offline message |
| B3 | Reboot phone | Data intact |
| B4 | Add 50 entries quickly via quick add | All saved, no lag over ~100 ms per entry |

**C. Catch-up (the replacement for server cron jobs)**

| ID | Steps | Expected |
|---|---|---|
| C1 | Add a loan started 3 years ago, leave balance empty | 36 EMIs applied; months left = tenure − 36; History lists them |
| C2 | Add a loan started 3 years ago with today's outstanding from your bank app | Balance equals what you typed; next EMI date correct |
| C3 | Active SIP with auto-record on a fund that has a price; set phone date +2 months; open app | 2 installments recorded as "estimated"; toast explains |
| C4 | Repeat C3 open/close several times | No duplicates |
| C5 | Leave the app open past midnight, then bring it to foreground | Today's EMIs/SIPs applied without relaunch |

**D. Investments and prices**

| ID | Steps | Expected |
|---|---|---|
| D1 | Add a mutual fund through search ("parag parikh flexi direct") | Search results appear (online); NAV filled |
| D2 | Add a stock with symbol INFY; Refresh prices | Price updates; "updated today" subtitle |
| D3 | Refresh offline | Error toast; old prices kept |
| D4 | Buy 50 @ 1400 (2023), sell 20 @ 1800 today | 30 units left; realised +₹8,000; lot shows 30 @ 1400 |
| D5 | Compare a holding's XIRR with Excel's `=XIRR()` over the same cash flows | Within 0.1% |
| D6 | Try to sell more units than held | Blocked with message |
| D7 | Delete a holding → Undo | Holding and its transactions return |
| D8 | Family: add Spouse, import her statement as Spouse; toggle chips on Home/Invest | Totals split and add up correctly |

**E. Spending capture**

| ID | Steps | Expected |
|---|---|---|
| E1 | Quick add each of: `200 chai upi yesterday`, `+50k salary`, `uber 450 3 oct`, `₹99 netflix cc 01/10`, `rent 25000` | Amount, date, method and category as you'd expect; Undo works |
| E2 | Change a Swiggy entry's category to "Eating out"; quick add "swiggy 300" | New entry gets "Eating out" (learned) |
| E3 | Scan 10 real payment screenshots (GPay, PhonePe, Paytm, your bank app, a failed payment) | Note how many give the right amount/payee/date; the failed one is rejected. Target ≥ 8/10 |
| E4 | Scan the same screenshot twice | Second time: "already in your expenses" |
| E5 (Android) | Send 5 SMS with `adb emu sms send` (debit, credit, card spend, OTP, promo) → Spend → From SMS | 3 transactions found; OTP and promo ignored |
| E6 (iPhone) | Set up the Shortcuts automation from Spend → From SMS; forward a real bank SMS (or text yourself one containing "debited") | Finora opens with the transaction pre-filled; Save adds it; sending the same again is caught as duplicate |
| E7 (iPhone) | E6 while Finora is locked / not running | Unlock first, then the pre-filled sheet appears |
| E8 | Import a bank statement .xlsx from HDFC, ICICI or SBI net banking; import it again | First time all rows; second time all marked duplicate |

**F. Loans and planning**

| ID | Steps | Expected |
|---|---|---|
| F1 | Enter a loan exactly as on your bank's sanction letter | EMI matches the bank's to the rupee (or within ₹1) |
| F2 | Compare the Upcoming EMIs list with the bank's amortisation schedule | Principal/interest split within a few rupees per month |
| F3 | Record a prepayment (reduce tenure) | Months left drops; EMI unchanged |
| F4 | Simulator: change amount and return quickly | Updates instantly; result flips around the break-even rate |
| F5 | Add salary (day 1) and rent (day 3) in Plan | Calendar and Safe to spend reflect them |
| F6 | Goal linked to a fund + SIP | Projection, "Add a month" amount shown |
| F7 | Set an EMI day = tomorrow; allow notifications | Reminder at 9:00 tomorrow |

**G. Backup and sync between two phones**

| ID | Steps | Expected |
|---|---|---|
| G1 | Phone A: export with passphrase → save to Files/Drive | `.finora` file created; "Last export" updated |
| G2 | Phone B (fresh install): "I have a Finora backup" → import | Everything identical (spot-check totals) |
| G3 | Edit different entries on A and B; delete one on B; export B → import on A | Merge preview counts are right; both edits kept; deletion applied |
| G4 | Import the same file twice | Second time: 0 added / 0 updated |
| G5 | Import an old web-app `.enc` vault | Opens and upgrades; holdings show an opening buy |
| G6 | Wrong passphrase on import | Clear error, nothing changed |

**H. Reports**

| ID | Steps | Expected |
|---|---|---|
| H1 | Export Excel report; open in Excel / Google Sheets / Numbers | All sheets open, numbers not text |
| H2 | Emergency file with PDF password | PDF asks for the password; folios, nominees, loans listed |
| H3 | Tax → Schedule 112A CSV | Columns line up with the ITR utility's 112A CSV template |

**I. UI and accessibility**

| ID | Steps | Expected |
|---|---|---|
| I1 | Light and dark mode (phone setting and in-app) | Readable everywhere; status bar clock visible in both |
| I2 | Largest text size (Dynamic Type / Font size) | Nothing overlaps or gets cut off on main screens |
| I3 | Smallest phone you can find (iPhone SE / 5" Android) | Tab bar, sheets and keyboard usable |
| I4 | Every form: keyboard open | Save button visible above the keyboard |
| I5 (Android) | Back button from sheets, sub-pages, tab roots | Closes sheet → goes back → minimises |
| I6 | Hide amounts (eye) | Every rupee figure masked, including chart tooltips |

**J. Privacy (do once per platform)**

| ID | Steps | Expected |
|---|---|---|
| J1 | Route the phone through Proxyman or Charles (or Android Studio's Network Inspector) and use every feature, including import, scan and export | Only `portal.amfiindia.com` and `query1.finance.yahoo.com` are contacted, and only on price refresh / fund search |
| J2 | Inspect app storage (Xcode → Devices → Download Container; `adb shell run-as`) | Only `keyring.json`, `vault.bin(.bak)` and the public NAV cache; no readable personal data |

**K. Performance**

| ID | Steps | Expected |
|---|---|---|
| K1 | Cold start to lock screen | < 1.5 s on a mid-range phone |
| K2 | Import a 5-year CAMS statement | < 10 s; app stays responsive |
| K3 | 5,000 expenses (import several bank years) → scroll Spend, search | Smooth; search < 300 ms |

**L. Upgrades**

| ID | Steps | Expected |
|---|---|---|
| L1 | Install build N, add data, install build N+1 over it | Data intact, no re-onboarding |

---

## Stage 2 — Accuracy against your real statements

The parsers were written against synthetic text. Real statements are the biggest risk, so treat this as a separate stage.

1. Collect, for you and each family member: a CAMS **and** a KFintech detailed CAS (full history, "since inception"), an NSDL or CDSL CAS, a Zerodha/Groww holdings export, two bank statements (Excel), and the **capital gains statement** from CAMS/your broker for last FY.
2. Keep them **out of git**: put them in `app/testdata/private/` (add that path to `.gitignore`).
3. For each file, write the expected numbers from the statement itself: number of folios/holdings, closing units per scheme, total market value, total cost.
4. Import and compare:
   - holdings count and units match exactly; value within ₹1 per holding (rounding);
   - for CAMS/KFintech: the app's realised gains for last FY match the CAMS capital gains statement within ₹10 per scheme; LT/ST classification matches;
   - re-import is a no-op.
5. Every mismatch → fix the parser → add a unit test using an anonymised snippet of that statement's text (replace names/PAN/folio, keep layout).
6. Optional: add `app/src/importers/golden.test.ts` that runs only when `testdata/private` exists, so you can re-run all real statements after every parser change.

---

## Stage 3 — Family beta (free)

- iPhone users: the PWA (see [PWA.md](PWA.md)) — no Apple fee needed.
- Android users: the debug APK from CI artifacts, or a release APK sideloaded.
- Give testers a one-page checklist (create vault, import their CAS, add a week of expenses, export a backup) and a short form: what confused you, what number looked wrong.
- Ask everyone to **export a backup first** — betas can have bugs.

## Stage 4 — Store betas

See [RELEASE.md](RELEASE.md): Google Play closed testing (12 testers × 14 days for new personal accounts) and TestFlight.

---

## Bug triage

| Severity | Examples | Rule |
|---|---|---|
| S1 | Data loss, cannot unlock, wrong money totals, data leaves the phone | Stop the beta, fix, add test |
| S2 | Wrong parse of a statement/SMS, wrong tax category, crash in one screen | Fix before store release |
| S3 | Layout glitch, confusing text | Fix when convenient |

**Exit criteria for store release:** all of A, B, C, G and J pass on both platforms; no open S1/S2; Stage 2 matches for every statement you have; at least 2 weeks of family use without data issues.
