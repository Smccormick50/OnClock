// Fills McCoy's exact "Bulk Mileage Reimbursement Form" template and
// triggers a download. This does NOT parse-and-rewrite the workbook
// through a spreadsheet library (those silently drop formatting on
// free/community tiers — fonts changed on a test round-trip). Instead
// it edits the handful of specific <c> (cell) elements inside the
// worksheet's raw XML directly, leaving every other byte — fonts,
// borders, the McCoy's logo, column widths, the $.73/mile formulas —
// completely untouched. JSZip just unpacks/repacks the .xlsx (which
// is a zip file); the actual editing is plain string surgery on one
// XML file inside it.

var MILEAGE_TEMPLATE_URL = "assets/mileage-template.xlsx";
var MILEAGE_FIRST_ROW = 17;
var MILEAGE_MAX_ROWS = 37; // rows 17–53 in the template

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelDateSerial(dateStr) {
  // dateStr is "YYYY-MM-DD" (what <input type="date"> gives you).
  var parts = dateStr.split("-").map(Number);
  var utcDate = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  var epoch = Date.UTC(1899, 11, 30); // Excel's (deliberately buggy) date epoch
  return Math.round((utcDate - epoch) / 86400000);
}

// Replaces one <c r="REF" .../> or <c r="REF" ...>...</c> element in
// the sheet's raw XML, preserving its existing style ("s") attribute
// and every other byte of the file, and setting only its value.
function setCellValue(xml, ref, type, value) {
  var re = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  var m = xml.match(re);
  if (!m) {
    console.warn("Mileage template: cell " + ref + " not found — template may have changed.");
    return xml;
  }
  var attrs = m[1].replace(/\st="[^"]*"/, "");
  var inner, tAttr;
  if (type === "text") {
    tAttr = ' t="inlineStr"';
    inner = "<is><t xml:space=\"preserve\">" + xmlEscape(value) + "</t></is>";
  } else {
    tAttr = "";
    inner = "<v>" + value + "</v>";
  }
  var newCell = '<c r="' + ref + '"' + attrs + tAttr + ">" + inner + "</c>";
  return xml.slice(0, m.index) + newCell + xml.slice(m.index + m[0].length);
}

// trips: [{ beginDate, endDate (YYYY-MM-DD), description, beginOdometer, endOdometer }]
// profile: { name, employeeNumber, deptStore }
async function exportMileageLog(profile, trips) {
  if (typeof JSZip === "undefined") {
    alert("The spreadsheet library didn't load — check your connection and try again.");
    return;
  }
  if (trips.length > MILEAGE_MAX_ROWS) {
    alert("This form only has " + MILEAGE_MAX_ROWS + " rows. Export/clear some trips first, then add the rest.");
    return;
  }

  var res = await fetch(MILEAGE_TEMPLATE_URL);
  if (!res.ok) {
    alert("Couldn't load the mileage form template.");
    return;
  }
  var buf = await res.arrayBuffer();
  var zip = await JSZip.loadAsync(buf);
  var xml = await zip.file("xl/worksheets/sheet1.xml").async("string");

  xml = setCellValue(xml, "M5", "text", profile.name || "");
  xml = setCellValue(xml, "I8", "text", profile.employeeNumber || "");
  xml = setCellValue(xml, "P8", "number", Number(profile.deptStore) || 0);

  trips.forEach(function (t, i) {
    var r = MILEAGE_FIRST_ROW + i;
    xml = setCellValue(xml, "B" + r, "number", excelDateSerial(t.beginDate));
    xml = setCellValue(xml, "D" + r, "number", excelDateSerial(t.endDate));
    xml = setCellValue(xml, "F" + r, "text", t.description || "");
    xml = setCellValue(xml, "M" + r, "number", Number(t.beginOdometer) || 0);
    xml = setCellValue(xml, "N" + r, "number", Number(t.endOdometer) || 0);
  });

  zip.file("xl/worksheets/sheet1.xml", xml);
  var out = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  var url = URL.createObjectURL(out);
  var link = document.createElement("a");
  var safeName = (profile.name || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  link.href = url;
  link.download = "mileage-log-" + safeName + "-" + localDateStr(new Date()) + ".xlsx";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
