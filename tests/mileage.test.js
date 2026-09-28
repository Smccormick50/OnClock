// The mileage export fills accounting's exact Excel form by editing the
// worksheet XML directly (so fonts, borders, the logo, and the $.73
// formulas stay byte-for-byte untouched). These tests run that fill
// against the real template file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { loadBrowserScripts, ROOT } = require("./helpers/loadBrowserScript");

const m = loadBrowserScripts(["js/timeutils.js", "js/mileageexport.js"]);
const TEMPLATE = path.join(ROOT, "assets", "mileage-template.xlsx");

async function templateSheetXml() {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  return zip.file("xl/worksheets/sheet1.xml").async("string");
}
const cell = (xml, ref) => (xml.match(new RegExp('<c r="' + ref + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)')) || [""])[0];

test("excelDateSerial matches Excel's date numbers", () => {
  assert.equal(m.excelDateSerial("2026-09-10"), 46275);
  assert.equal(m.excelDateSerial("2026-01-01"), 46023);
  assert.equal(m.excelDateSerial("1900-03-01"), 61);
});

test("xmlEscape escapes the five XML special characters", () => {
  assert.equal(m.xmlEscape(`A & B <c> "d" 'e'`), "A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;");
});

test("mileageNameLastFirst puts the last name first", () => {
  assert.match(m.mileageNameLastFirst("Steven McCormick"), /^McCormick,? Steven$/);
  assert.match(m.mileageNameLastFirst("Mary Ann Smith"), /^Smith,? Mary Ann$/);
  assert.equal(m.mileageNameLastFirst("Madonna"), "Madonna");
  assert.equal(m.mileageNameLastFirst(""), "");
});

test("setCellValue keeps the cell's style and never confuses M5 with M50", () => {
  const xml = '<row><c r="M50" s="1"/><c r="M5" s="112"/><c r="M51" s="3"/></row>';
  const out = m.setCellValue(xml, "M5", "text", "Sam & Co");
  assert.equal(out, '<row><c r="M50" s="1"/><c r="M5" s="112" t="inlineStr"><is><t xml:space="preserve">Sam &amp; Co</t></is></c><c r="M51" s="3"/></row>');
  assert.equal(m.setCellValue(xml, "M5", "number", 42), '<row><c r="M50" s="1"/><c r="M5" s="112"><v>42</v></c><c r="M51" s="3"/></row>');
});

test("filling the real template: header, trip rows, totals", async () => {
  const before = await templateSheetXml();
  const profile = { name: "Steven McCormick", employeeNumber: "10452", deptStore: "730" };
  const trips = [
    { beginDate: "2026-09-10", endDate: "2026-09-10", description: "Travel to 039 Longview", beginOdometer: "45210", endOdometer: "45355" },
    { beginDate: "2026-09-11", endDate: "2026-09-11", description: "Travel to 049 Tyler & back", beginOdometer: "45355", endOdometer: "45480" },
  ];
  const after = m.fillMileageSheetXml(before, profile, trips);

  assert.match(cell(after, "M5"), /McCormick,? Steven/);
  assert.match(cell(after, "I8"), />10452</);
  assert.match(cell(after, "P8"), /<v>730<\/v>/);
  assert.match(cell(after, "B17"), /<v>46275<\/v>/);
  assert.match(cell(after, "F18"), /Travel to 049 Tyler &amp; back/);
  assert.match(cell(after, "M17"), /<v>45210<\/v>/);
  assert.match(cell(after, "N18"), /<v>45480<\/v>/);

  // cached formula results: 145 mi + 125 mi = 270 mi; $105.85 + $91.25 = $197.10
  assert.match(cell(after, "O17"), /<v>145<\/v>/);
  assert.match(cell(after, "P17"), /<v>105\.85<\/v>/);
  assert.match(cell(after, "O55"), /<v>270<\/v>/);
  assert.match(cell(after, "P55"), /<v>197\.1<\/v>/);

  // the formulas themselves must survive untouched
  for (const ref of ["K17", "O17", "P17", "O55", "P55"]) {
    assert.match(cell(after, ref), /<f[ >]/, `${ref} lost its formula`);
  }
  assert.equal(cell(after, "P17").match(/<f[^>]*>([^<]*)<\/f>/)[1], cell(before, "P17").match(/<f[^>]*>([^<]*)<\/f>/)[1]);

  // structure outside the filled cells is byte-identical
  const block = (xml, tag) => (xml.match(new RegExp("<" + tag + "[\\s\\S]*?</" + tag + ">")) || [""])[0];
  for (const tag of ["mergeCells", "cols", "pageMargins"]) {
    assert.equal(block(after, tag), block(before, tag), `${tag} changed`);
  }
  // every cell we touched kept its original style index
  for (const ref of ["M5", "I8", "P8", "B17", "D17", "F17", "M17", "N17", "B18"]) {
    const styleOf = (xml) => (cell(xml, ref).match(/ s="(\d+)"/) || [])[1];
    assert.equal(styleOf(after), styleOf(before), `${ref} lost its style`);
  }
});

test("the template still has every cell the export writes to", async () => {
  const xml = await templateSheetXml();
  const refs = ["M5", "I8", "P8", "O55", "P55"];
  for (let r = 17; r <= 53; r++) refs.push("B" + r, "D" + r, "F" + r, "K" + r, "M" + r, "N" + r, "O" + r, "P" + r);
  const missing = refs.filter((ref) => !cell(xml, ref));
  assert.deepEqual(missing, [], "the template changed — the export would silently skip these cells");
});

test("a filled sheet still round-trips through zip/unzip", async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.file("xl/worksheets/sheet1.xml", m.fillMileageSheetXml(xml, { name: "A B", employeeNumber: "1", deptStore: "2" }, []));
  const rezipped = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
  assert.ok(rezipped.file("xl/media/image1.png"), "the McCoy's logo must survive");
  assert.ok(rezipped.file("xl/styles.xml"));
});
