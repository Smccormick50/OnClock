// Work weeks feed the approval workflow, so the Monday-Sunday math has
// to be right for every device, not just ones set to Central Time.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScripts, plain } = require("./helpers/loadBrowserScript");
const w = loadBrowserScripts(["js/timeutils.js", "js/weeklyapprovals.js"]);

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

inEachDeviceZone("mondayForWorkDate returns the Monday of any date's week", () => {
  assert.equal(w.mondayForWorkDate("2026-09-14"), "2026-09-14"); // a Monday
  assert.equal(w.mondayForWorkDate("2026-09-17"), "2026-09-14"); // Thursday
  assert.equal(w.mondayForWorkDate("2026-09-20"), "2026-09-14"); // Sunday belongs to the week before
  assert.equal(w.mondayForWorkDate("2026-09-21"), "2026-09-21");
});

inEachDeviceZone("shiftWorkDate moves by whole calendar days, across month/year/DST edges", () => {
  assert.equal(w.shiftWorkDate("2026-09-30", 1), "2026-10-01");
  assert.equal(w.shiftWorkDate("2026-12-31", 1), "2027-01-01");
  assert.equal(w.shiftWorkDate("2026-03-08", 1), "2026-03-09"); // clocks spring forward
  assert.equal(w.shiftWorkDate("2026-11-01", 1), "2026-11-02"); // clocks fall back
  assert.equal(w.shiftWorkDate("2026-09-14", -1), "2026-09-13");
});

inEachDeviceZone("datesForWorkWeek is seven consecutive days Monday to Sunday", () => {
  assert.deepEqual(plain(w.datesForWorkWeek("2026-09-28")), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
  assert.equal(w.sundayForWorkWeek("2026-09-14"), "2026-09-20");
});

test("weeklySnapshotTotal prefers a stored total, else computes from sessions", () => {
  assert.equal(w.weeklySnapshotTotal([
    { totalMinutes: 480 },
    { sessions: [{ clockIn: "2026-09-15T13:00:00Z", clockOut: "2026-09-15T15:00:00Z" }] },
  ]), 600);
  assert.equal(w.weeklySnapshotTotal(undefined), 0);
});

test("weeklySnapshotHasOpenPunch and HasWork", () => {
  const open = [{ sessions: [{ clockIn: "a", clockOut: null }] }];
  const closed = [{ sessions: [{ clockIn: "a", clockOut: "b" }] }];
  assert.equal(w.weeklySnapshotHasOpenPunch(open), true);
  assert.equal(w.weeklySnapshotHasOpenPunch(closed), false);
  assert.equal(w.weeklySnapshotHasWork([{ sessions: [], notes: [], completedTodos: [] }]), false);
  assert.equal(w.weeklySnapshotHasWork([{ sessions: [], notes: [{ text: "x" }], completedTodos: [] }]), true);
});
