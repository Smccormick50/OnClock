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
    if (s.clockIn && s.clockOut) total += minutesBetween(s.clockIn, s.clockOut);
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
    if (sessions[i].clockIn && !sessions[i].clockOut) {
      sessions[i].clockOut = wallTimeToUtcIso(dateStr, 23, 59, 0);
      return true;
    }
  }
  return false;
}

// Shifts a YYYY-MM-DD string by a number of days, as pure calendar
// math (no timezone conversion involved) — safe from any DST edge case.
function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Archives one date. Returns { archived, autoClocked } counts.
async function archiveOneDate(db, dateStr) {
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

  console.log(`  ${dateStr}: archived ${archived} log(s), auto-clocked-out ${autoClocked} still-open session(s).`);
  return { archived, autoClocked };
}

// Builds the inclusive list of YYYY-MM-DD dates from start to end.
// Capped at 90 days as a sanity check against a typo'd date sending
// this off into a years-long loop.
function dateRange(startStr, endStr) {
  const dates = [];
  let cursor = startStr;
  let guard = 0;
  while (cursor <= endStr && guard < 90) {
    dates.push(cursor);
    cursor = shiftDateStr(cursor, 1);
    guard++;
  }
  return dates;
}

async function main() {
  const now = new Date();
  const isManualRun = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

  // GitHub Actions does not guarantee scheduled workflows fire at the
  // requested time — in practice, runs on this repo have landed 5-7
  // hours late (11:59pm CDT scheduled, but actually executing around
  // 5am). Trying to detect "is it currently near midnight" and skip
  // otherwise meant the script almost always skipped, since by the
  // time it actually ran, it was already well into the next morning —
  // so nothing ever got archived, despite the workflow showing green.
  //
  // So a scheduled run no longer checks the clock at all. It simply
  // always archives "yesterday" (Chicago calendar date, relative to
  // whenever this happens to execute). That's correct no matter how
  // late the run lands: even six hours late, the day that ended at
  // midnight is still "yesterday". This is also fully idempotent
  // (same Firestore doc ID, full overwrite each time), so if both
  // scheduled cron entries fire on the same day, or a run repeats,
  // it just re-saves the same result — harmless either way.
  let dates;
  if (isManualRun) {
    const requestedDate = (process.env.ARCHIVE_DATE || "").trim();
    const requestedEndDate = (process.env.ARCHIVE_END_DATE || "").trim();
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate);
    const validEndDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedEndDate);

    if (validDate && validEndDate) {
      if (requestedEndDate < requestedDate) {
        throw new Error(`End date (${requestedEndDate}) is before start date (${requestedDate}).`);
      }
      dates = dateRange(requestedDate, requestedEndDate);
    } else if (validDate) {
      dates = [requestedDate];
    } else {
      if (requestedDate) console.warn(`"${requestedDate}" isn't a valid YYYY-MM-DD date — archiving today instead.`);
      dates = [tzDateStr(now, TIME_ZONE)];
    }
  } else {
    dates = [shiftDateStr(tzDateStr(now, TIME_ZONE), -1)];
  }

  console.log(`Running at ${tzHour(now, TIME_ZONE)}:xx ${TIME_ZONE} (isManualRun=${isManualRun}), targeting: ${dates.join(", ")}.`);
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set.");
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  let totalArchived = 0;
  let totalAutoClocked = 0;
  for (const dateStr of dates) {
    const result = await archiveOneDate(db, dateStr);
    totalArchived += result.archived;
    totalAutoClocked += result.autoClocked;
  }

  console.log(`Done. ${totalArchived} log(s) archived across ${dates.length} day(s), ${totalAutoClocked} auto-clocked-out.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
