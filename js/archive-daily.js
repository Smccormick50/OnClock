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

// Converts a wall-clock time on a given date, in TIME_ZONE, to the
// correct UTC instant — accounting for whichever side of daylight
// saving that date falls on. Used to auto-clock-out anyone still
// clocked in at day's end, so an open session can't silently run
// away and rack up hours into the next day (or forever, if someone
// forgets to clock out and no one catches it).
function wallTimeToUtcIso(dateStr, hh, mm, ss) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss || 0));
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess);
    const map = {};
    parts.forEach((p) => { map[p.type] = p.value; });
    const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    const desiredUtc = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
    const diff = desiredUtc - asUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess.toISOString();
}

// If any session for the day has no clockOut, close it at 11:59:00pm
// that day (TIME_ZONE). Scans the whole array rather than assuming
// the open one is last — a backfilled punch could sit after it out
// of chronological order. Returns true if it changed anything.
function autoCloseOpenSession(data, dateStr) {
  const sessions = data.sessions || [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (!sessions[i].clockOut) {
      sessions[i].clockOut = wallTimeToUtcIso(dateStr, 23, 59, 0);
      return true;
    }
  }
  return false;
}

async function main() {
  const now = new Date();
  const isManualRun = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const chiHour = tzHour(now, TIME_ZONE);

  // The two scheduled runs target 11:59pm Chicago time directly (see
  // the workflow file), but GitHub Actions doesn't guarantee exact
  // timing — a run can land a little late. So the real window is
  // "the 11pm hour, or shortly after midnight" (a late run in that
  // grace period still means archiving *yesterday*, not the new day
  // that just started). Anything outside that, for a scheduled run,
  // is skipped; a manual run always proceeds regardless of the hour.
  let targetDate;
  if (chiHour === 23) {
    targetDate = tzDateStr(now, TIME_ZONE);
  } else if (chiHour === 0) {
    const anHourAgo = new Date(now.getTime() - 3600 * 1000);
    targetDate = tzDateStr(anHourAgo, TIME_ZONE);
  } else if (!isManualRun) {
    console.log(`Not the 11pm hour (or just after midnight) in ${TIME_ZONE} — it's ${chiHour}:xx there — skipping.`);
    return;
  } else {
    targetDate = tzDateStr(now, TIME_ZONE);
  }

  // A manual run can target a specific past date (e.g. after an admin
  // corrects a day's punches, to refresh that day's saved PDF) via the
  // workflow's "date" input. Falls back to the date resolved above if
  // left blank, or if it's not a well-formed YYYY-MM-DD (so a typo
  // can't silently no-op against some unintended date).
  let dateStr = targetDate;
  const requestedDate = (process.env.ARCHIVE_DATE || "").trim();
  if (requestedDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      dateStr = requestedDate;
    } else {
      console.warn(`"${requestedDate}" isn't a valid YYYY-MM-DD date — archiving ${dateStr} instead.`);
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
  let autoClocked = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    if (autoCloseOpenSession(data, dateStr)) {
      await docSnap.ref.set({
        uid: data.uid,
        name: data.name || "Employee",
        date: dateStr,
        sessions: data.sessions,
        notes: data.notes || [],
        completedTodos: data.completedTodos || [],
      });
      autoClocked++;
    }

    const hasContent = (data.sessions && data.sessions.length) || (data.notes && data.notes.length) || (data.completedTodos && data.completedTodos.length);
    if (!hasContent) continue;

    const month = dateStr.slice(0, 7); // "YYYY-MM"
    await db.collection("archives").doc(`${data.uid}_${dateStr}`).set({
      uid: data.uid,
      name: data.name || "Employee",
      date: dateStr,
      month,
      sessions: data.sessions || [],
      notes: data.notes || [],
      completedTodos: data.completedTodos || [],
      totalMinutes: totalMinutesFor(data),
      archivedAt: new Date().toISOString(),
    });
    archived++;
  }

  console.log(`Archived ${archived} log(s) for ${dateStr}. Auto-clocked-out ${autoClocked} still-open session(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
