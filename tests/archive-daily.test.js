// The nightly archive job once "succeeded" for over a week while
// archiving nothing. These tests pin down what it must actually do.
const test = require("node:test");
const assert = require("node:assert/strict");
const a = require("../scripts/archive-daily.js");

test("shiftDateStr handles month, year, and leap-year edges", () => {
  assert.equal(a.shiftDateStr("2026-09-22", -1), "2026-09-21");
  assert.equal(a.shiftDateStr("2026-03-01", -1), "2026-02-28");
  assert.equal(a.shiftDateStr("2028-03-01", -1), "2028-02-29");
  assert.equal(a.shiftDateStr("2026-01-01", -1), "2025-12-31");
  assert.equal(a.shiftDateStr("2026-12-31", 1), "2027-01-01");
});

test("dateRange is inclusive, crosses months, and is capped", () => {
  assert.deepEqual(a.dateRange("2026-09-20", "2026-09-20"), ["2026-09-20"]);
  assert.deepEqual(a.dateRange("2026-08-30", "2026-09-02"), ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.equal(a.dateRange("2020-01-01", "2030-01-01").length, 90);
});

test("wallTimeToUtcIso lands on the right instant on both sides of DST", () => {
  assert.equal(a.wallTimeToUtcIso("2026-09-17", 23, 59, 0), "2026-09-18T04:59:00.000Z"); // CDT
  assert.equal(a.wallTimeToUtcIso("2026-01-15", 23, 59, 0), "2026-01-16T05:59:00.000Z"); // CST
  assert.equal(a.wallTimeToUtcIso("2026-03-08", 23, 59, 0), "2026-03-09T04:59:00.000Z"); // day clocks spring forward
  assert.equal(a.wallTimeToUtcIso("2026-11-01", 23, 59, 0), "2026-11-02T05:59:00.000Z"); // day clocks fall back
});

// ---- which dates does a run archive? (the logic that silently broke) ----

test("a scheduled run archives YESTERDAY no matter how late it actually fires", () => {
  // The workflow fires after midnight Central, but GitHub has delayed
  // runs by 5-7 hours. The old code only worked if a run landed near
  // 11pm, so it skipped every night. Every hour from just after
  // midnight through evening must resolve to yesterday.
  for (const utc of ["2026-09-21T06:30:00Z", "2026-09-21T10:30:00Z", "2026-09-21T11:44:00Z", "2026-09-21T15:00:00Z", "2026-09-21T23:30:00Z"]) {
    const r = a.resolveTargetDates({ GITHUB_EVENT_NAME: "schedule" }, new Date(utc));
    assert.deepEqual(r.dates, ["2026-09-20"], `run at ${utc}`);
  }
});

test("the main cron time archives yesterday in winter too", () => {
  const r = a.resolveTargetDates({ GITHUB_EVENT_NAME: "schedule" }, new Date("2026-01-16T06:30:00Z")); // 12:30am CST
  assert.deepEqual(r.dates, ["2026-01-15"]);
});

test("scheduled run just after Central midnight still archives the day that just ended", () => {
  const r = a.resolveTargetDates({ GITHUB_EVENT_NAME: "schedule" }, new Date("2026-09-21T05:10:00Z")); // 12:10am CDT Sep 21
  assert.deepEqual(r.dates, ["2026-09-20"]);
});

test("manual run: a date range backfills every day in it", () => {
  const r = a.resolveTargetDates(
    { GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_DATE: "2026-09-15", ARCHIVE_END_DATE: "2026-09-18" },
    new Date("2026-09-22T15:00:00Z"));
  assert.deepEqual(r.dates, ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
});

test("manual run: a single date, or no date (yesterday)", () => {
  const now = new Date("2026-09-22T15:00:00Z");
  assert.deepEqual(a.resolveTargetDates({ GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_DATE: "2026-09-10" }, now).dates, ["2026-09-10"]);
  assert.deepEqual(a.resolveTargetDates({ GITHUB_EVENT_NAME: "workflow_dispatch" }, now).dates, ["2026-09-21"]);
});

test("manual run: nonsense input is rejected or falls back safely", () => {
  const now = new Date("2026-09-22T15:00:00Z");
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(a.resolveTargetDates({ GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_DATE: "9/15/2026" }, now).dates, ["2026-09-21"]);
  } finally { console.warn = originalWarn; }
  assert.throws(() => a.resolveTargetDates({ GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_DATE: "2026-09-18", ARCHIVE_END_DATE: "2026-09-15" }, now), /before start date/);
  assert.throws(() => a.resolveTargetDates({ GITHUB_EVENT_NAME: "workflow_dispatch", ARCHIVE_DATE: "2026-09-30" }, now), /future date/);
});

// ---- closing open sessions ----

test("closeOpenSessions closes open punches that started before the cutoff, and only those", () => {
  const data = { sessions: [
    { clockIn: "2026-09-20T13:00:00Z", clockOut: null },
    { clockIn: "2026-09-20T14:00:00Z", clockOut: "2026-09-20T15:00:00Z" },
    { clockIn: "2026-09-22T13:00:00Z", clockOut: null }, // starts after the cutoff
    { clockIn: null, clockOut: "2026-09-20T12:00:00Z" },  // orphan
  ] };
  const closed = a.closeOpenSessions(data, "2026-09-21T04:59:00.000Z");
  assert.equal(closed, 1);
  assert.equal(data.sessions[0].clockOut, "2026-09-21T04:59:00.000Z");
  assert.equal(data.sessions[1].clockOut, "2026-09-20T15:00:00Z");
  assert.equal(data.sessions[2].clockOut, null);
});

test("totalMinutesFor (archive copy) ignores open and orphan punches", () => {
  assert.equal(a.totalMinutesFor({ sessions: [
    { clockIn: "2026-09-20T13:00:00Z", clockOut: "2026-09-20T14:30:00Z" },
    { clockIn: "2026-09-20T15:00:00Z", clockOut: null },
    { clockIn: null, clockOut: "2026-09-20T16:00:00Z" },
  ] }), 90);
});

// ---- archiveOneDate against an in-memory fake Firestore ----

function fakeDb(entries) {
  const written = { archives: {}, entryWrites: [] };
  return {
    written,
    collection(name) {
      if (name === "entries") {
        return { where: () => ({ get: async () => ({ docs: entries.map((e) => ({
          data: () => e,
          ref: { set: async (value) => { written.entryWrites.push(value); } },
        })) }) }) };
      }
      if (name === "archives") return { doc: (id) => ({ set: async (value) => { written.archives[id] = value; } }) };
      throw new Error("unexpected collection " + name);
    },
  };
}

test("archiving a finished day auto-closes a forgotten clock-out at 11:59pm and saves it to the live entry too", async () => {
  const db = fakeDb([{ uid: "u1", name: "Sam", date: "2026-09-18", sessions: [{ clockIn: "2026-09-18T14:00:00Z", clockOut: null }], notes: [], completedTodos: [] }]);
  const result = await a.archiveOneDate(db, "2026-09-18", new Date("2026-09-19T15:00:00Z"));
  assert.deepEqual(result, { archived: 1, autoClocked: 1 });
  const archive = db.written.archives["u1_2026-09-18"];
  assert.equal(archive.sessions[0].clockOut, "2026-09-19T04:59:00.000Z");
  assert.equal(archive.totalMinutes, 899); // 9:00am to 11:59pm Central
  assert.equal(archive.isCurrentDaySnapshot, false);
  assert.equal(archive.month, "2026-09");
  assert.equal(db.written.entryWrites.length, 1);
  assert.equal(db.written.entryWrites[0].sessions[0].clockOut, "2026-09-19T04:59:00.000Z");
});

test("a manual snapshot of TODAY never touches the live open shift", async () => {
  const now = new Date("2026-09-19T15:00:00Z");
  const db = fakeDb([{ uid: "u1", name: "Sam", date: "2026-09-19", sessions: [{ clockIn: "2026-09-19T12:00:00Z", clockOut: null }], notes: [], completedTodos: [] }]);
  const result = await a.archiveOneDate(db, "2026-09-19", now);
  assert.deepEqual(result, { archived: 1, autoClocked: 0 });
  assert.equal(db.written.entryWrites.length, 0);
  const archive = db.written.archives["u1_2026-09-19"];
  assert.equal(archive.isCurrentDaySnapshot, true);
  assert.equal(archive.totalMinutes, 180);
});

test("days with nothing logged are not archived; already-complete days aren't rewritten", async () => {
  const db = fakeDb([
    { uid: "empty", name: "E", date: "2026-09-18", sessions: [], notes: [], completedTodos: [] },
    { uid: "done", name: "D", date: "2026-09-18", sessions: [{ clockIn: "2026-09-18T13:00:00Z", clockOut: "2026-09-18T21:00:00Z" }], notes: [], completedTodos: [] },
  ]);
  const result = await a.archiveOneDate(db, "2026-09-18", new Date("2026-09-19T15:00:00Z"));
  assert.deepEqual(result, { archived: 1, autoClocked: 0 });
  assert.deepEqual(Object.keys(db.written.archives), ["done_2026-09-18"]);
  assert.equal(db.written.entryWrites.length, 0);
  assert.equal(db.written.archives["done_2026-09-18"].totalMinutes, 480);
});
