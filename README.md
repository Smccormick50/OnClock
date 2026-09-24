# OnClock — WFH time clock & notes

Static site: `index.html` (employee clock) + `admin.html` (admin
dashboard), backed by Firebase Auth (email/password) and Firestore
only — no Firebase Storage, no Cloud Functions, no Blaze plan needed.
Push `index.html`, `admin.html`, `css/`, and `js/` as-is to GitHub
Pages. The after-midnight archiving job runs as a free GitHub Actions
scheduled workflow instead of a paid Firebase Cloud Function.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Add project**.
   Name it whatever you like (e.g. "mccoy-onclock"). Google Analytics
   is optional — you can skip it.
2. In the left sidebar, **Build > Authentication** → **Get started** →
   enable the **Email/Password** sign-in method.
3. In the left sidebar, **Build > Firestore Database** → **Create
   database** → start in **Production mode** → pick a region close to
   you.
4. In the left sidebar, click the gear icon → **Project settings** →
   scroll to **Your apps** → click the **</>** (web) icon → register
   an app (nickname doesn't matter, no need for Firebase Hosting).
   Firebase will show you a `firebaseConfig` object.
5. Open `js/firebase-config.js` in this project and paste your real
   values in place of the `YOUR_...` placeholders. These values are
   safe to be public — they identify your project, not secret keys.
   Access is controlled by `firestore.rules`, not by hiding this file.

## 2. Deploy the security rules

The rules in `firestore.rules` keep each employee's data private to
them, while letting anyone whose `users/{uid}` doc has `role: "admin"`
read and edit everyone's data. Audit records are append-only and only
admins can review everyone's changes. The `archives` collection is
read-only from the browser — it's only ever written by the GitHub
Actions script below, using an admin service account that bypasses
these rules entirely.

In the Firebase console: **Firestore Database > Rules** → delete the
default contents → paste in everything from `firestore.rules` in this
project → **Publish**.

### One more thing: an index

The "Past days" list on each employee's own page runs a query
(by `uid` and `date` together) that needs a composite index — Firestore
won't build this one automatically. Easiest way: just use the app for
a bit and open the browser console (F12); the first time that query
runs, Firestore logs an error there with a direct link that creates
the exact index needed in one click. Alternatively, create it by hand
in the Firebase console: **Firestore Database > Indexes > Composite >
Add index** — collection `entries`, fields `uid` (Ascending) then
`date` (Descending), query scope "Collection". (`firestore.indexes.json`
in this project describes the same index, if you're using the CLI:
`firebase deploy --only firestore:indexes`.) It takes Firestore a few
minutes to finish building a new index.

## 3. Create the first admin (yourself)

Roles can't be self-assigned from the app — a brand-new signup is
always `role: "employee"`, and only an existing admin can promote
someone. So for the very first admin:

1. Push the site live (step 5 below) and sign up for an account
   through `index.html` like anyone else.
2. In the Firebase console, go to **Firestore Database > Data**, open
   the `users` collection, find the document with your `uid`, and
   change its `role` field from `employee` to `admin`.
3. Reload `admin.html` — you're in. From the **Employees** tab you can
   promote or demote anyone else's role, with every change recorded in
   the Audit Log. No more
   manual editing needed.

## 4. Set up the nightly archive (GitHub Actions)

This saves each completed employee day into the `archives` collection
shortly after midnight, whether or not anyone has the app open.

1. **Get a service account key.** In the Firebase console: gear icon
   → **Project settings** → **Service accounts** tab → **Generate new
   private key**. This downloads a `.json` file — keep it safe, it's
   a real credential.
2. **Add it as a GitHub secret.** In your GitHub repo (push the code
   there first if you haven't — see step 5): **Settings > Secrets and
   variables > Actions > New repository secret**. Name it
   `FIREBASE_SERVICE_ACCOUNT`, and paste the *entire contents* of the
   `.json` file you downloaded as the value.
3. That's it — `.github/workflows/archive-daily.yml` runs shortly after
   midnight Central and archives the completed previous day. Change the
   `TIME_ZONE` constant near the top of `scripts/archive-daily.js` if
   your team is elsewhere.
4. **To test it or refresh an already-archived day:**
   push the repo, then on GitHub go to the **Actions** tab → **Archive
   daily logs** → **Run workflow**. Leave **date** blank to archive
   yesterday, or fill it in (YYYY-MM-DD) to (re-)archive that date.
   Entering today's date creates an "up to now" snapshot without
   clocking the employee out. The admin dashboard flags this: opening
   an employee's detail view for a day that's already archived shows a
   note reminding you to re-run it for that date after making changes.

## 5. Push to GitHub Pages

1. Create a new GitHub repo and push this whole folder to it:
   ```
   git init
   git add .
   git commit -m "OnClock: WFH time clock and notes"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub, go to the repo's **Settings > Pages**. Under "Build and
   deployment", set **Source** to "Deploy from a branch", branch
   `main`, folder `/ (root)`. Save.
3. GitHub will give you a URL like
   `https://<your-username>.github.io/<repo-name>/` — that's the
   employee clock. Admins go to the same URL + `admin.html`.
4. Don't forget step 4 above (the GitHub secret) — the repo needs to
   exist on GitHub before you can add a secret to it, so it's fine to
   do this step and step 4 in either order.

## How it's organized

- `index.html` / `admin.html` — the two pages
- `css/style.css` — shared styling
- `js/firebase-config.js` — your project keys (edit this)
- `js/auth.js` — sign up / sign in / sign out / profile lookup
- `js/timeutils.js` — Central Time conversion plus date, time, and duration formatting shared by both pages
- `js/pdfexport.js` — builds a PDF in the browser and downloads it
- `js/csvexport.js` — same idea, as a CSV: a single day, or a whole pay-period range with per-employee totals
- `js/archives.js` — renders combined completed/archived history, grouped by month, with PDF and CSV download on each
- `js/authform.js` — wires up the login/signup form on `index.html`
- `js/employee.js` — the clock in/out + notes logic on `index.html`
- `js/admin.js` — the admin dashboard on `admin.html`
- `js/register-sw.js` — registers the service worker below
- `sw.js` — caches the app's own files for offline/instant loading (leaves Firebase and CDN requests alone)
- `manifest.json` — makes the site installable ("Add to Home Screen" on iOS, "Install app" on desktop)
- `icons/` — the app icon at the sizes iOS/Android/desktop each expect
- `firestore.rules` — security rules (each user's own data, admin override, read-only archives, and append-only audit records)
- `firestore.indexes.json` — the one composite index the "Past days" query needs
- `scripts/archive-daily.js` — the nightly archive job, run by GitHub Actions
- `.github/workflows/archive-daily.yml` — schedules the after-midnight archive and lets you trigger it manually to test or refresh a date

## Recent additions

- **Cleaner employee Log screen** — the daily log and total appear first,
  manual punch corrections are tucked into a collapsible control, and work
  notes and to-dos follow underneath.
- **One admin History tab** — the older Past Days Logs and Archives screens
  are combined. Admins can filter by employee and month, review any day,
  and download PDF or CSV copies without editing historical records.
- **Separate Employees tab** — role/access controls no longer compete with
  today's time records.
- **Audit Log** — clock changes, manual punches, note/completed-task edits,
  deletions, and administrator access changes are recorded with actor,
  employee, date, details, and timestamp.
- **Central Time everywhere** — the live clock, punch editors, history,
  exports, and Audit Log all use `America/Chicago`, including automatic
  daylight-saving changes.

- **Renamed to OnClock**, with a new green-and-yellow clock icon
  (`icons/`). Every title, header, and the manifest now say OnClock
  instead of Punch — if you already deployed the old version, your
  existing Firebase data is untouched by this, it's a visual/name
  change only.
- **Installable on iOS and desktop.** On an iPhone, open the site in
  Safari → Share → **Add to Home Screen** — it launches full-screen
  with its own icon, no Safari address bar. On desktop Chrome or Edge,
  look for an **Install** icon in the address bar. Both use
  `manifest.json` and the icons in `icons/` (regenerate those if you
  ever want different branding — they're plain PNGs). A small service
  worker (`sw.js`) caches the app's own files so it opens instantly
  and still loads with no connection; it never touches Firebase or
  font/CDN requests, so live data always comes straight from the
  network when there is one.
- **iOS polish** — every text field is set to at least 16px, which
  stops Safari's "auto-zoom on tap" behavior; padding around the edges
  respects the iPhone's notch/Dynamic Island/home-indicator when
  running as an installed app; buttons get a subtle hover highlight on
  desktop (skipped on touchscreens, so tapping doesn't leave a stuck
  highlight).
- **Re-archiving a specific date** — the manual GitHub Actions trigger
  now takes an optional `date` input, so a correction to an
  already-archived day's punches can be reflected in its saved PDF by
  re-running the workflow for that date. The admin dashboard also
  flags when a day being edited is already archived, as a reminder.
- **Forgot password** — a link on the sign-in screen sends a reset
  email via Firebase Auth. No setup needed; it just works once
  Email/Password sign-in is enabled (step 1). For the reset emails to
  not look like spam, consider customizing the sender name/template
  later under **Authentication > Templates** in the Firebase console.
- **Pay Period tab (admin)** — pick a date range (defaults to this
  week, Monday through today), see each employee's total hours across
  it, and download the whole thing as one CSV.
- **CSV downloads** — alongside every PDF button (an employee's own
  day, an admin viewing an employee's day, and each row in Archives),
  there's now a CSV option too — better for pulling numbers into a
  spreadsheet than a PDF is.
- **Offline persistence** — the app now queues clock-ins/notes locally
  if wifi drops and syncs them once the connection's back, instead of
  silently failing. (If a device has two tabs of the app open at once,
  only one gets persistence — Firestore's own limitation — but neither
  tab breaks, they just fall back to needing a live connection.)

## Data model

- `users/{uid}` — `{ name, email, role: "employee" | "admin" }`
- `entries/{uid}_{YYYY-MM-DD}` — `{ uid, name, date, sessions: [{clockIn, clockOut}], notes: [{time, text}] }` — today's live, editable log
- `archives/{uid}_{YYYY-MM-DD}` — `{ uid, name, date, month, sessions, notes, totalMinutes, archivedAt }` — a frozen copy of a completed day, normally written shortly after midnight
- `auditLogs/{autoId}` — append-only `{ actorUid, actorName, targetUid, targetName, date, action, detail, createdAt }` change history

## How the two kinds of PDF differ

Both are generated the same way — in the browser, with jsPDF, from
whatever's in Firestore — nothing is ever stored as an actual PDF
file. The difference is just which data feeds it:

- **Download as PDF (up to now)** — on each employee's own page, and
  on each employee's row in the admin dashboard. Builds a PDF from
  today's *live* entry, whatever's logged so far.
- **Archives "View PDF"** — builds the same kind of PDF, but from the
  *frozen* copy saved after the day ends. Grouped by month under
  the **Archives** tab (admin) or **My archived logs** (employee).

## Notes

- Everything here — Firestore, Auth, and GitHub Actions — stays on
  free tiers. No billing account needed anywhere.
- GitHub automatically disables a scheduled workflow if a repo goes
  60 days with no commits at all. If that happens, the Actions tab
  will show it as disabled with a one-click **Enable workflow**
  button — worth remembering if logs stop showing up in Archives
  after a long quiet stretch.
- If you ever want to remove someone's access, delete their row from
  **Authentication > Users** in the Firebase console (their Firestore
  data stays, in case you need old timesheets).
- The `.json` service account key is a real credential — never commit
  it to the repo. It only ever lives in the GitHub secret.
