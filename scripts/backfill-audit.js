// One-time audit-history backfill.
//
// Reconstructs clock-ins, clock-outs, notes, and completed tasks from saved
// entries/archives. It deliberately does not invent old login events, edits,
// deletions, or the person who originally performed an action because those
// facts were not stored before the Audit Log existed.

const TIME_ZONE = "America/Chicago";
const DEFAULT_START_DATE = "2026-09-16";
const DEFAULT_END_DATE = "2026-09-23";
const MAX_DAYS = 366;
const MAX_BATCH_WRITES = 400;

function isDateStr(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value + "T12:00:00Z"));
}

function shiftDateStr(dateStr, deltaDays) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateRange(startDate, endDate) {
  if (!isDateStr(startDate) || !isDateStr(endDate)) {
    throw new Error("Start and end dates must use YYYY-MM-DD format.");
  }
  if (endDate < startDate) {
    throw new Error(`End date (${endDate}) is before start date (${startDate}).`);
  }

  const result = [];
  let cursor = startDate;
  while (cursor <= endDate && result.length < MAX_DAYS) {
    result.push(cursor);
    cursor = shiftDateStr(cursor, 1);
  }
  if (cursor <= endDate) throw new Error(`The requested range exceeds ${MAX_DAYS} days.`);
  return result;
}

// Converts a Central wall-clock time to its UTC instant while honoring DST.
function wallTimeToUtcIso(dateStr, hour, minute, second) {
  const [year, month, day] = dateStr.split("-").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(guess);
    const values = {};
    parts.forEach((part) => { values[part.type] = part.value; });
    const shownAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    );
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const difference = wantedAsUtc - shownAsUtc;
    if (difference === 0) break;
    guess = new Date(guess.getTime() + difference);
  }
  return guess.toISOString();
}

function toValidIso(value, fallbackIso) {
  if (value && typeof value.toDate === "function") value = value.toDate();
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? fallbackIso : date.toISOString();
}

function fmtCentralTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function itemText(item) {
  if (typeof item === "string") return item;
  return item && typeof item.text === "string" ? item.text : "";
}

function buildHistoricalEvents(log, dateStr) {
  const events = [];
  const fallbackBase = wallTimeToUtcIso(dateStr, 12, 0, 0);
  const fallbackAt = (offsetMinutes) => new Date(new Date(fallbackBase).getTime() + offsetMinutes * 60000).toISOString();

  (log.sessions || []).forEach((session, index) => {
    if (session && session.clockIn) {
      const iso = toValidIso(session.clockIn, fallbackAt(index * 2));
      events.push({
        key: `session_${String(index).padStart(3, "0")}_in`,
        action: "clock_in",
        detail: `Clocked in at ${fmtCentralTime(iso)} CT. (Historical import from saved log.)`,
        iso,
      });
    }
    if (session && session.clockOut) {
      const iso = toValidIso(session.clockOut, fallbackAt(index * 2 + 1));
      events.push({
        key: `session_${String(index).padStart(3, "0")}_out`,
        action: "clock_out",
        detail: `Clocked out at ${fmtCentralTime(iso)} CT. (Historical import from saved log.)`,
        iso,
      });
    }
  });

  (log.notes || []).forEach((note, index) => {
    const text = itemText(note);
    const iso = toValidIso(note && note.time, fallbackAt(120 + index));
    events.push({
      key: `note_${String(index).padStart(3, "0")}`,
      action: "note_added",
      detail: `Added note: ${text || "(blank note)"} (Historical import from saved log.)`,
      iso,
    });
  });

  (log.completedTodos || []).forEach((task, index) => {
    const text = itemText(task);
    const iso = toValidIso(task && task.completedAt, fallbackAt(240 + index));
    events.push({
      key: `task_${String(index).padStart(3, "0")}`,
      action: "completed_task_added",
      detail: `Completed task: ${text || "(blank task)"} (Historical import from saved log.)`,
      iso,
    });
  });

  return events.sort((a, b) => a.iso.localeCompare(b.iso));
}

function safeDocPart(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
}

async function loadLogsForDate(db, dateStr) {
  const [archiveSnap, entrySnap] = await Promise.all([
    db.collection("archives").where("date", "==", dateStr).get(),
    db.collection("entries").where("date", "==", dateStr).get(),
  ]);
  const byUid = new Map();

  // Start with frozen archives, then let the current entry replace the same
  // employee/date if both exist because entries contain the latest saved copy.
  archiveSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.uid) byUid.set(data.uid, { ...data, sourceCollection: "archives" });
  });
  entrySnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.uid) byUid.set(data.uid, { ...data, sourceCollection: "entries" });
  });
  return Array.from(byUid.values());
}

async function backfill(db, admin, dates) {
  let batch = db.batch();
  let pendingWrites = 0;
  let totalWrites = 0;
  let totalLogs = 0;

  async function flush() {
    if (!pendingWrites) return;
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  }

  for (const dateStr of dates) {
    const logs = await loadLogsForDate(db, dateStr);
    let dateWrites = 0;
    for (const log of logs) {
      const uid = log.uid;
      if (!uid) continue;
      const targetName = log.name || "Employee";
      const events = buildHistoricalEvents(log, dateStr);
      if (events.length) totalLogs++;

      for (const event of events) {
        const docId = ["historical", safeDocPart(uid), dateStr, event.key].join("_");
        const ref = db.collection("auditLogs").doc(docId);
        batch.set(ref, {
          actorUid: "historical-import",
          actorName: "Historical import",
          targetUid: uid,
          targetName,
          date: dateStr,
          action: event.action,
          detail: event.detail,
          createdAt: admin.firestore.Timestamp.fromDate(new Date(event.iso)),
          createdAtIso: event.iso,
          historicalImport: true,
          sourceCollection: log.sourceCollection,
          sourceEventKey: event.key,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        pendingWrites++;
        totalWrites++;
        dateWrites++;
        if (pendingWrites >= MAX_BATCH_WRITES) await flush();
      }
    }
    console.log(`${dateStr}: ${logs.length} saved log(s), ${dateWrites} historical audit event(s).`);
  }

  await flush();
  return { totalLogs, totalWrites };
}

async function main() {
  const startDate = (process.env.AUDIT_START_DATE || DEFAULT_START_DATE).trim();
  const endDate = (process.env.AUDIT_END_DATE || DEFAULT_END_DATE).trim();
  const dates = dateRange(startDate, endDate);
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set.");

  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
  }
  const db = admin.firestore();
  console.log(`Backfilling audit history from ${startDate} through ${endDate}.`);
  const result = await backfill(db, admin, dates);
  console.log(`Done. Rebuilt ${result.totalWrites} event(s) from ${result.totalLogs} employee-day log(s).`);
  console.log("Old sign-ins, edits, and deletions were not invented because they were not stored in the source logs.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildHistoricalEvents,
  dateRange,
  shiftDateStr,
  wallTimeToUtcIso,
};
