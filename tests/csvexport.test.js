const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScripts } = require("./helpers/loadBrowserScript");
const c = loadBrowserScripts(["js/timeutils.js", "js/csvexport.js"]);

test("csvField quotes commas, quotes, and line breaks, and doubles inner quotes", () => {
  assert.equal(c.csvField("plain"), "plain");
  assert.equal(c.csvField("a,b"), '"a,b"');
  assert.equal(c.csvField('say "hi"'), '"say ""hi"""');
  assert.equal(c.csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(c.csvField(null), "");
  assert.equal(c.csvField(undefined), "");
  assert.equal(c.csvField(0), "0");
});

test("toCsvString starts with a BOM (so Excel reads UTF-8) and uses CRLF rows", () => {
  const out = c.toCsvString([["Name", "Note"], ["Sam", "Trip — 5 mi, round"]]);
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.equal(out.slice(1), 'Name,Note\r\nSam,"Trip — 5 mi, round"');
});
