// The app's browser scripts are plain <script> files (no modules). To
// unit test them we run them, in order, inside a Node "vm" context —
// which is what a browser page effectively is — and read the
// functions back off it. Only `console` is provided; anything else a
// script needs (Firebase, the DOM) simply isn't there, so tests can
// only reach the pure logic, which is the point.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");

function loadBrowserScripts(files, extraGlobals) {
  const sandbox = Object.assign({ console }, extraGlobals || {});
  vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(source, sandbox, { filename: file });
  }
  return sandbox;
}

function readRepoFile(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

// Objects created inside the vm sandbox are not "the same kind" of
// object as ones created in the test file, so deep-equality checks
// between them fail on a technicality. Round-tripping through JSON
// gives plain host-realm data to compare.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadBrowserScripts, readRepoFile, plain, ROOT };
