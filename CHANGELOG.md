# OnClock changelog

Newest first. Dates before 2026-09-27 are **reconstructed** from the
build sessions and are approximate — this project didn't keep a change
log until now, and the exact history lives in the GitHub commit list.
From here on, add an entry whenever behavior changes.

Sections: **Added**, **Changed**, **Fixed**. Anything that needs a
manual step after uploading (republishing Firestore rules, re-running a
backfill, ...) is called out under **After uploading**.

---

## 2026-09-27 — Tests, health checks, and two bugs the tests found

### Added
- **Automated test suite** (`tests/`, run with `npm test`, and on every
  push via `.github/workflows/tests.yml`). ~100 checks covering timezone
  math, the nightly archive, the mileage form fill, work-week math, CSV
  output, and cross-file consistency (element IDs, referenced files,
  Firestore rules coverage, service-worker cache list, cron timing). Each
  check was verified by deliberately breaking the code and confirming the
  test fails.
- **Archive health banner** on the admin dashboard
  (`js/archivehealth.js`): a red warning if recent days have logged
  activity but no nightly archive. Catches a disabled schedule (GitHub
  turns scheduled workflows off after 60 quiet days) and a run that
  "succeeds" while doing nothing.
- **Run summaries** for the nightly job: each run's GitHub Actions page
  now lists the dates it covered and how many logs it archived.
- This changelog.

### Fixed
- **Nightly archive schedule fired at 11:59pm Central, but the script
  archives "yesterday" and assumes it runs after midnight.** It only
  worked because GitHub was consistently hours late; a punctual run would
  have archived the day *before* the one that was ending, leaving every
  day a day behind (and leaving forgotten clock-outs open a day longer).
  The schedule is now 06:30 UTC (1:30am CDT / 12:30am CST) with a backup
  at 10:30 UTC — after midnight Central in both daylight-saving states.
  A test enforces this.
- **Work-week and pay-period date math depended on the device's
  timezone.** On a device set far east of Central (Tokyo, Auckland),
  "the Monday of Thursday Sept 17" came back as Sunday Sept 13, which
  would have put weekly-approval submissions in the wrong week. Now plain
  calendar arithmetic (`js/weeklyapprovals.js`, and the default range on
  the admin Pay Period tab). No effect for devices set to a US timezone.

### Changed (no behavior change)
- Pulled pure logic out of larger functions so it can be tested:
  `fillMileageSheetXml` (`js/mileageexport.js`) and `resolveTargetDates`
  (`scripts/archive-daily.js`). Verified the mileage export still
  produces a workbook that recalculates with zero formula errors.
- The test workflow now uses `npm ci`, so GitHub installs the exact
  dependency versions recorded in `package-lock.json`.
- Service worker cache bumped to v14 and now precaches `archivehealth.js`.

### After uploading
- Upload the new **`.github/workflows/archive-daily.yml`** — the schedule
  lives in that file, so the timing fix does nothing until it's on GitHub.
- The health banner may appear immediately if earlier days were never
  backfilled. That's it working: run *Archive daily logs* manually with
  a date range to catch up.
- No Firestore rules changes in this release.

---

## 2026-09-24 to 2026-09-27 — Approvals, assigned tasks, audit backfill
*(Landed outside the assistant sessions and synced from the repo zip.)*

- Work Week Approval: an employee submits a Monday–Sunday week to a
  chosen coworker, who approves or returns it; admins get a Completed
  Approvals tab. Backed by a field-restricted state machine in
  `firestore.rules`.
- Assigned tasks: an admin assigns a task to an employee's to-do list;
  the employee completes it; the admin approves it (Task Approvals tab).
- `scripts/backfill-audit.js` + workflow: one-time reconstruction of
  audit-log entries for the period before the audit log existed.
- **Security tradeoff:** the user directory became readable by any
  signed-in user (needed for the approver picker), where it was
  previously admin-only.

## 2026-09-22 to 2026-09-24 — Archive fixed, History, audit log, Central Time
- Nightly archive finally working (see incident 2 below). Scheduled runs
  archive "yesterday"; manual runs can take a date or a date range;
  archiving *today* creates an "up to now" snapshot that never closes the
  live shift; future dates are refused; forgotten clock-outs are closed
  at 11:59pm in the archive and the live entry.
- Admin dashboard reorganized: Today (editable, today only), History
  (read-only, grouped by month, per-month CSV download, filters, inline
  detail), Pay Period, Employees, Audit Log.
- Audit log (append-only): who did what, when.
- Every date and time pinned to Central Time regardless of the device's
  timezone.
- Manual punch entry tucked into a collapsible "Add or correct a punch".

## 2026-09-17 to 2026-09-22 — Features
- Employee page reorganized into tabs (Log / Mileage / Past Days).
- Punches: add or correct any day; clock-in-only and clock-out-only
  entries; open punches on past days no longer accrue phantom hours;
  notes can be edited (text and time).
- To-do list: check-off timestamps land in the day's log; editable;
  shareable as PDF/CSV; pending items appear on today's export.
- Mileage log: trips saved with the ending odometer left blank until
  the day's done; exports fill accounting's exact Excel form (edited at
  the XML level so fonts, borders, logo, and the $.73/mile formulas are
  untouched) and a matching PDF.
- Daily PDF: one continuous log instead of separate tables.
- Admin: Pay Period gets an employee filter; note/to-do/punch edit
  controls close on save.

## 2026-09-15 to 2026-09-17 — First build
- Clock in/out with live timer, timestamped notes, daily PDF/CSV.
- Admin dashboard: every employee's day, editable; pay-period totals.
- Firebase Auth (email/password, forgot-password) and Firestore, static
  site on GitHub Pages, free tiers only.
- Installable PWA with service worker, iOS polish, OnClock branding.
- First version of the nightly archive (GitHub Actions).

---

## Incident log

Kept because each of these ran unnoticed for a while. The pattern —
things that *looked* fine while doing nothing — is why the health banner,
run summaries, and tests exist.

**1. Sign-in failed with `auth/api-key-not-valid` (right after the first deploy, mid-Sep).**
Cause: one character. The Firebase API key in `js/firebase-config.js`
had a capital letter **O** where the real key has a **zero**. Invisible
in most fonts. Found by comparing the key character by character against
the Firebase console. *Lesson: paste keys from the console; don't retype
or eyeball them.*

**2. Nightly archive "succeeded" for a week and archived nothing (Sep
16–22).** Three causes stacked, and the first hid the others:
1. The first schedule ran hourly; GitHub skipped most runs (frequent
   schedules are the most likely to be dropped).
2. After moving to a precise 11:59pm schedule, the script still only
   archived if the current hour was 11pm. GitHub was delaying scheduled
   runs by 5–7 hours (landing around 5am), so the script saw "not the
   right hour", exited cleanly, and every run showed a green check.
3. The `FIREBASE_SERVICE_ACCOUNT` secret had never been created. The
   script would have failed loudly — but the hour check exited first, so
   it never got that far.
Found by comparing the run times in the Actions history against the
schedule, then noticing the repo had no secrets. Fixed by always
archiving "yesterday" (independent of when the run fires) and creating
the secret. *Lesson: a green run only means "didn't crash".*

**3. Fixes silently lost when later work branched from an older copy
(several times, roughly Sep 18–24).** The auto-clock-out and the "scan every
punch for an open one" fix each disappeared once after a later edit
started from a stale copy of the code. *Lesson: GitHub `main` is the one
source of truth; the tests now guard the behaviors that were lost.*

**4. Cron at 11:59pm vs. "archive yesterday" (found Sep 27).** See the
2026-09-27 entry. Found by writing a test for the run-time logic.

**5. Week math wrong for far-east device timezones (found Sep 27).** See
the 2026-09-27 entry. Found by running the tests as if the device were in
Tokyo.
