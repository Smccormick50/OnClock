// Every date and time in the app is supposed to be pinned to Central
// Time no matter what timezone the *device* is set to. These tests run
// the same assertions while pretending the device is in several other
// zones, so a regression to "trust the browser's clock" fails loudly.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScripts, plain } = require("./helpers/loadBrowserScript");

const t = loadBrowserScripts(["js/timeutils.js"]);
const DEVICE_ZONES = ["America/Chicago", "Asia/Tokyo", "Pacific/Auckland", "America/Los_Angeles", "UTC"];
const ORIGINAL_TZ = process.env.TZ;

function inEachDeviceZone(name, fn) {
  for (const zone of DEVICE_ZONES) {
    test(`${name} [device timezone ${zone}]`, () => {
      process.env.TZ = zone;
      try { fn(); } finally {
        if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
      }
    });
  }
}

inEachDeviceZone("localDateStr buckets an instant into its Central calendar day (summer)", () => {
  assert.equal(t.localDateStr(new Date("2026-09-18T04:30:00Z")), "2026-09-17"); // 11:30pm CDT
  assert.equal(t.localDateStr(new Date("2026-09-18T05:30:00Z")), "2026-09-18"); // 12:30am CDT
});

inEachDeviceZone("localDateStr buckets an instant into its Central calendar day (winter)", () => {
  assert.equal(t.localDateStr(new Date("2026-01-16T05:30:00Z")), "2026-01-15"); // 11:30pm CST
  assert.equal(t.localDateStr(new Date("2026-01-16T06:30:00Z")), "2026-01-16"); // 12:30am CST
});

inEachDeviceZone("fmtTime shows Central wall-clock time", () => {
  assert.match(t.fmtTime("2026-09-17T13:05:00.000Z"), /^8:05[\s\u202f\u00a0]?AM$/);
  assert.match(t.fmtTime("2026-01-15T14:05:00.000Z"), /^8:05[\s\u202f\u00a0]?AM$/);
});

inEachDeviceZone("timeInputValue converts an instant to a Central HH:MM", () => {
  assert.equal(t.timeInputValue("2026-09-17T13:05:00.000Z"), "08:05");
  assert.equal(t.timeInputValue(""), "");
});

inEachDeviceZone("fromTimeInputValue reads a time box as Central, on both sides of DST", () => {
  assert.equal(t.fromTimeInputValue("2026-09-17", "08:05"), "2026-09-17T13:05:00.000Z"); // CDT, UTC-5
  assert.equal(t.fromTimeInputValue("2026-01-15", "08:05"), "2026-01-15T14:05:00.000Z"); // CST, UTC-6
});

inEachDeviceZone("fromTimeInputValue is correct on the days the clocks change", () => {
  assert.equal(t.fromTimeInputValue("2026-03-08", "12:00"), "2026-03-08T17:00:00.000Z"); // spring forward day: already CDT
  assert.equal(t.fromTimeInputValue("2026-03-08", "01:30"), "2026-03-08T07:30:00.000Z"); // before the jump: still CST
  assert.equal(t.fromTimeInputValue("2026-11-01", "12:00"), "2026-11-01T18:00:00.000Z"); // fall back day: CST
});

test("timeInputValue and fromTimeInputValue round-trip", () => {
  for (const [date, time] of [["2026-09-17", "00:00"], ["2026-09-17", "23:59"], ["2026-01-15", "12:34"], ["2026-03-08", "15:45"]]) {
    assert.equal(t.timeInputValue(t.fromTimeInputValue(date, time)), time);
  }
});

test("fmtDuration rounds to whole minutes and pads", () => {
  assert.equal(t.fmtDuration(0), "0h 00m");
  assert.equal(t.fmtDuration(90), "1h 30m");
  assert.equal(t.fmtDuration(59.6), "1h 00m");
  assert.equal(t.fmtDuration(605), "10h 05m");
});

test("minutesBetween never goes negative", () => {
  assert.equal(t.minutesBetween("2026-09-17T13:00:00Z", "2026-09-17T14:30:00Z"), 90);
  assert.equal(t.minutesBetween("2026-09-17T14:30:00Z", "2026-09-17T13:00:00Z"), 0);
});

test("totalMinutesFor sums closed sessions", () => {
  const day = { sessions: [
    { clockIn: "2026-09-17T13:00:00Z", clockOut: "2026-09-17T17:00:00Z" },
    { clockIn: "2026-09-17T18:00:00Z", clockOut: "2026-09-17T20:30:00Z" },
  ] };
  assert.equal(t.totalMinutesFor(day), 390);
});

test("a stale open punch on a PAST day adds no phantom hours", () => {
  // This is the bug behind the '23h 50m' log: a forgotten clock-out kept
  // counting up to 'now' forever.
  const day = { sessions: [{ clockIn: "2026-09-17T02:41:00.000Z", clockOut: null }] };
  assert.equal(t.totalMinutesFor(day), 0);
});

test("a clock-out with no clock-in adds no time", () => {
  assert.equal(t.totalMinutesFor({ sessions: [{ clockIn: null, clockOut: "2026-09-17T17:00:00Z" }] }), 0);
});

test("an open punch from TODAY counts elapsed time", () => {
  const clockIn = new Date(Date.now() - 60 * 1000).toISOString();
  if (t.localDateStr(new Date(clockIn)) !== t.localDateStr(new Date())) return; // ran within a minute of Central midnight
  const minutes = t.totalMinutesFor({ sessions: [{ clockIn, clockOut: null }] });
  assert.ok(minutes >= 0.9 && minutes <= 2, `expected about 1 minute, got ${minutes}`);
});

test("currentOpenSession finds an open punch anywhere in the list, ignoring orphans", () => {
  const open = { clockIn: "2026-09-17T13:00:00Z", clockOut: null };
  const day = { sessions: [
    open,
    { clockIn: "2026-09-17T15:00:00Z", clockOut: "2026-09-17T16:00:00Z" }, // a backfilled later punch
    { clockIn: null, clockOut: "2026-09-17T12:00:00Z" },                    // orphan clock-out
  ] };
  assert.equal(t.currentOpenSession(day), open);
  assert.equal(t.currentOpenSession({ sessions: [{ clockIn: "a", clockOut: "b" }] }), null);
  assert.equal(t.currentOpenSession({ sessions: [] }), null);
});

test("emptyDay includes every list the app expects", () => {
  assert.deepEqual(plain(t.emptyDay()), { sessions: [], notes: [], completedTodos: [] });
});
