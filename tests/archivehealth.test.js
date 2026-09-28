const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScripts, plain } = require("./helpers/loadBrowserScript");
const h = loadBrowserScripts(["js/archivehealth.js"]);

const work = { sessions: [{ clockIn: "x", clockOut: "y" }], notes: [], completedTodos: [] };

test("healthShiftDate is calendar math", () => {
  assert.equal(h.healthShiftDate("2026-09-27", -1), "2026-09-26");
  assert.equal(h.healthShiftDate("2026-09-27", -8), "2026-09-19");
  assert.equal(h.healthShiftDate("2026-03-02", -2), "2026-02-28");
});

test("everything archived means no warning", () => {
  const entries = [{ uid: "a", date: "2026-09-20", ...work }];
  const archives = [{ uid: "a", date: "2026-09-20" }];
  assert.deepEqual(plain(h.findMissingArchives(entries, archives, "2026-09-26")), []);
  assert.equal(h.archiveHealthMessage([]), "");
});

test("an old day with content and no archive is flagged", () => {
  const missing = plain(h.findMissingArchives([{ uid: "a", name: "Sam", date: "2026-09-20", ...work }], [], "2026-09-26"));
  assert.deepEqual(missing, [{ uid: "a", name: "Sam", date: "2026-09-20" }]);
  assert.match(h.archiveHealthMessage(missing), /1 daily log\(s\) \(2026-09-20\)/);
});

test("days on or after the cutoff get slack (the nightly job can run hours late)", () => {
  const entries = [{ uid: "a", date: "2026-09-26", ...work }, { uid: "a", date: "2026-09-27", ...work }];
  assert.deepEqual(plain(h.findMissingArchives(entries, [], "2026-09-26")), []);
});

test("days with nothing logged never need an archive", () => {
  assert.deepEqual(plain(h.findMissingArchives([{ uid: "a", date: "2026-09-20", sessions: [], notes: [], completedTodos: [] }], [], "2026-09-26")), []);
});

test("a mid-day manual snapshot does not count as the nightly archive", () => {
  const entries = [{ uid: "a", date: "2026-09-20", ...work }];
  const archives = [{ uid: "a", date: "2026-09-20", isCurrentDaySnapshot: true }];
  assert.equal(h.findMissingArchives(entries, archives, "2026-09-26").length, 1);
});

test("archives are matched per person, not just per date", () => {
  const entries = [{ uid: "a", date: "2026-09-20", ...work }, { uid: "b", date: "2026-09-20", ...work }];
  const missing = plain(h.findMissingArchives(entries, [{ uid: "a", date: "2026-09-20" }], "2026-09-26"));
  assert.deepEqual(missing.map((m) => m.uid), ["b"]);
});

test("the message summarises long gaps as a range", () => {
  const missing = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"].map((date) => ({ uid: "a", name: "Sam", date }));
  assert.match(h.archiveHealthMessage(missing), /2026-09-19 to 2026-09-22/);
});
