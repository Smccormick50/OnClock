// Cross-file consistency checks — the things that used to be verified
// by hand after every code sync, and that fail silently in a browser
// (a button that does nothing, a page that half-loads, a permission
// error nobody sees).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, readRepoFile } = require("./helpers/loadBrowserScript");

const PAGES = ["index.html", "admin.html"];
const scriptSrcs = (html) => [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
const idsIn = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const referencedIds = (js) => [...js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const dynamicIds = (js) => new Set([
  ...[...js.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...js.matchAll(/setAttribute\(\s*["']id["']\s*,\s*["']([^"']+)["']/g)].map((m) => m[1]),
]);

for (const page of PAGES) {
  test(`${page}: every script it loads exists on disk`, () => {
    for (const src of scriptSrcs(readRepoFile(page))) {
      assert.ok(fs.existsSync(path.join(ROOT, src)), `${page} loads ${src}, which doesn't exist`);
    }
  });

  test(`${page}: every element ID its scripts look up actually exists`, () => {
    const html = readRepoFile(page);
    const present = idsIn(html);
    const problems = [];
    for (const src of scriptSrcs(html)) {
      const js = readRepoFile(src);
      const created = dynamicIds(js);
      for (const id of new Set(referencedIds(js))) {
        if (!present.has(id) && !created.has(id)) problems.push(`${src} looks up #${id}, which ${page} doesn't have`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test(`${page}: no duplicate element IDs`, () => {
    const all = [...readRepoFile(page).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepEqual([...new Set(dupes)], []);
  });
}

test("service worker precache list: every file exists (one missing file breaks the whole offline cache)", () => {
  const sw = readRepoFile("sw.js");
  const list = sw.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\]/)[1];
  const files = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(files.length > 5);
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, []);
});

test("service worker precaches every local script the pages load", () => {
  const sw = readRepoFile("sw.js");
  const cached = new Set([...sw.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const allowed = new Set(["js/register-sw.js"]); // the file that registers the service worker itself
  const missing = new Set();
  for (const page of PAGES) for (const src of scriptSrcs(readRepoFile(page))) if (!cached.has(src) && !allowed.has(src)) missing.add(src);
  assert.deepEqual([...missing], []);
});

test("every JS file parses (a syntax error would blank the whole page)", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f),
    ...fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".js")).map((f) => "scripts/" + f),
    "sw.js",
  ];
  for (const file of files) {
    assert.doesNotThrow(() => new vm.Script(readRepoFile(file), { filename: file }), `${file} has a syntax error`);
  }
});

test("every Firestore collection the browser code uses has a security rule", () => {
  const rules = readRepoFile("firestore.rules");
  const ruled = new Set([...rules.matchAll(/match\s+\/([A-Za-z0-9_]+)\/\{/g)].map((m) => m[1]));
  const used = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"))) {
    for (const m of readRepoFile("js/" + file).matchAll(/\.collection\(\s*["']([A-Za-z0-9_]+)["']\s*\)/g)) {
      if (!used.has(m[1])) used.set(m[1], file);
    }
  }
  assert.ok(used.size > 5, "expected to find the app's collections");
  const unruled = [...used].filter(([name]) => !ruled.has(name)).map(([name, file]) => `${name} (used in js/${file})`);
  assert.deepEqual(unruled, [], "Firestore denies everything not covered by a rule");
});

test("firestore.rules has balanced braces and parentheses", () => {
  const rules = readRepoFile("firestore.rules").replace(/\/\/.*$/gm, "");
  for (const [open, close] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
    assert.equal(rules.split(open).length, rules.split(close).length, `unbalanced ${open}${close}`);
  }
});

test("the CSS has balanced braces", () => {
  const css = readRepoFile("css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(css.split("{").length, css.split("}").length);
});
