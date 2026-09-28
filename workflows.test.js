const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { ROOT, readRepoFile } = require("./helpers/loadBrowserScript");

const WORKFLOW_DIR = ".github/workflows";
const workflows = fs.readdirSync(path.join(ROOT, WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f));

test("every workflow file is valid YAML with at least one job", () => {
  assert.ok(workflows.length >= 2);
  for (const file of workflows) {
    const doc = YAML.parse(readRepoFile(`${WORKFLOW_DIR}/${file}`));
    assert.ok(doc && doc.jobs && Object.keys(doc.jobs).length > 0, `${file} has no jobs`);
  }
});

test("the nightly archive workflow is scheduled, runnable by hand, and given its secret", () => {
  const doc = YAML.parse(readRepoFile(`${WORKFLOW_DIR}/archive-daily.yml`));
  const on = doc.on || doc[true]; // some YAML parsers read the key `on` as boolean true
  assert.ok(on.schedule && on.schedule.length >= 1, "no schedule");
  for (const entry of on.schedule) assert.match(entry.cron, /^\d+ \d+ \* \* \*$/, "expected a daily cron");
  assert.ok(on.workflow_dispatch, "can't be run manually");
  assert.ok(on.workflow_dispatch.inputs.date && on.workflow_dispatch.inputs.endDate, "manual date range inputs missing");

  const step = doc.jobs.archive.steps.find((s) => /archive-daily\.js/.test(s.run || ""));
  assert.ok(step, "no step runs archive-daily.js");
  assert.equal(step["working-directory"], "scripts");
  assert.match(step.env.FIREBASE_SERVICE_ACCOUNT, /secrets\.FIREBASE_SERVICE_ACCOUNT/);
  assert.match(step.env.ARCHIVE_DATE, /inputs\.date/);
  assert.match(step.env.ARCHIVE_END_DATE, /inputs\.endDate/);
  assert.ok(fs.existsSync(path.join(ROOT, "scripts", "archive-daily.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "scripts", "package.json")), "the job runs npm install in scripts/");
});

test("every scheduled archive run fires AFTER midnight Central, in both summer and winter time", () => {
  // Each run archives "yesterday", so a run before midnight Central
  // would archive the day BEFORE the one that's ending. A cron is in
  // UTC; Central is UTC-5 in summer (CDT) and UTC-6 in winter (CST).
  const doc = YAML.parse(readRepoFile(`${WORKFLOW_DIR}/archive-daily.yml`));
  const on = doc.on || doc[true];
  for (const { cron } of on.schedule) {
    const [minute, hour] = cron.split(" ").map(Number);
    for (const offset of [5, 6]) {
      const centralMinutes = ((hour - offset + 24) % 24) * 60 + minute;
      assert.ok(centralMinutes >= 0 && centralMinutes < 12 * 60,
        `cron "${cron}" fires at ${Math.floor(centralMinutes / 60)}:${String(centralMinutes % 60).padStart(2, "0")} Central when Central is UTC-${offset} — that's not safely after midnight`);
    }
  }
});
