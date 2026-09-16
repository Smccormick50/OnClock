// Runs on a GitHub Actions schedule (see ../.github/workflows/archive-daily.yml).
// Copies today's `entries` doc for every employee who logged anything
// into the `archives` collection, using the Firestore Admin SDK — which
// authenticates with a service account and bypasses firestore.rules
// entirely (the rules only need to allow clients to *read* archives).
//
// No PDF is generated or stored here. The archive just freezes that
// day's sessions/notes as a Firestore document; the app builds an
// actual PDF in the browser, on the fly, whenever someone clicks
// "View PDF" — the same jsPDF code the on-demand download button uses.

const admin = require("firebase-admin");

// Change this if your team isn't in Central time — must be an IANA
// zone name, e.g. "America/New_York", "America/Denver".
const TIME_ZONE = "America/Chicago";

function tzDateStr(date, timeZone) {
  // en-CA gives YYYY-MM-DD, matching the date-string doc ids the app uses.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function tzHour(date, timeZone) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false, hourCycle: "h23" }).format(date));
}

function minutesBetween(startIso, endIso) {
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

function totalMinutesFor(data) {
  let total = 0;
  (data.sessions || []).forEach((s) => {
    if (s.clockOut) total += minutesBetween(s.clockIn, s.clockOut);
  });
  return total;
}

async function main() {
  const now = new Date();
  const isManualRun = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

  // The workflow runs hourly; only actually archive at the 11pm hour,
  // unless someone manually triggered it from the GitHub Actions tab
  // (to test, or to re-archive a specific date — see below).
  if (!isManualRun && tzHour(now, TIME_ZONE) !== 23) {
    console.log(`Not the 11pm hour in ${TIME_ZONE} (it's ${tzHour(now, TIME_ZONE)}:xx there) — skipping.`);
    return;
  }

  // A manual run can target a specific past date (e.g. after an admin
  // corrects a day's punches, to refresh that day's saved PDF) via the
  // workflow's "date" input. Falls back to today if left blank, or if
  // it's not a well-formed YYYY-MM-DD (so a typo can't silently no-op
  // against some unintended date).
  let dateStr = tzDateStr(now, TIME_ZONE);
  const requestedDate = (process.env.ARCHIVE_DATE || "").trim();
  if (requestedDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      dateStr = requestedDate;
    } else {
      console.warn(`"${requestedDate}" isn't a valid YYYY-MM-DD date — archiving today (${dateStr}) instead.`);
    }
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set.");
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection("entries").where("date", "==", dateStr).get();

  let archived = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const hasContent = (data.sessions && data.sessions.length) || (data.notes && data.notes.length);
    if (!hasContent) continue;

    const month = dateStr.slice(0, 7); // "YYYY-MM"
    await db.collection("archives").doc(`${data.uid}_${dateStr}`).set({
      uid: data.uid,
      name: data.name || "Employee",
      date: dateStr,
      month,
      sessions: data.sessions || [],
      notes: data.notes || [],
      totalMinutes: totalMinutesFor(data),
      archivedAt: new Date().toISOString(),
    });
    archived++;
  }

  console.log(`Archived ${archived} log(s) for ${dateStr}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
