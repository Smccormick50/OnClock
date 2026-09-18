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
  trips = (trips || []).filter(function (t) {
    return t && t.endOdometer !== "" && t.endOdometer !== null && typeof t.endOdometer !== "undefined";
  });
  if (trips.length === 0) {
    alert("Finish at least one trip by entering its ending mileage before exporting.");
    return;
  }
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

// Creates a letter-size PDF that mirrors McCoy's Bulk Mileage
// Reimbursement Form. The logo is read from the existing Excel template,
// so the website does not need another image asset.
async function exportMileagePdf(profile, trips) {
  trips = (trips || []).filter(function (t) {
    return t && t.endOdometer !== "" && t.endOdometer !== null && typeof t.endOdometer !== "undefined";
  });
  if (trips.length === 0) {
    alert("Finish at least one trip by entering its ending mileage before exporting.");
    return;
  }
  if (trips.length > MILEAGE_MAX_ROWS) {
    alert("This form only has " + MILEAGE_MAX_ROWS + " rows. Export/clear some trips first, then add the rest.");
    return;
  }

  var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) {
    alert("The PDF library didn't load - check your connection and try again.");
    return;
  }

  var doc = new jsPDFCtor({ unit: "pt", format: "letter", orientation: "portrait" });
  var pageW = 612;
  var left = 22;
  var right = 590;
  var black = [0, 0, 0];
  var green = [0, 82, 46];
  var yellow = [255, 232, 0];

  function setLine(width) {
    doc.setDrawColor(black[0], black[1], black[2]);
    doc.setLineWidth(width || 0.6);
  }

  function centeredText(text, x1, x2, y, opts) {
    opts = opts || {};
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 7);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text == null ? "" : text), (x1 + x2) / 2, y, { align: "center", baseline: "middle" });
  }

  function rightText(text, x, y, size, bold) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size || 7);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text == null ? "" : text), x, y, { align: "right", baseline: "middle" });
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    var p = dateStr.split("-");
    return Number(p[1]) + "/" + Number(p[2]) + "/" + p[0];
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function formatMoney(value) {
    return "$" + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Outer form and identity section.
  setLine(1.1);
  doc.rect(left, 24, right - left, 624);

  // Reuse the official logo embedded in the Excel template.
  try {
    if (typeof JSZip !== "undefined") {
      var templateResponse = await fetch(MILEAGE_TEMPLATE_URL);
      if (templateResponse.ok) {
        var templateZip = await JSZip.loadAsync(await templateResponse.arrayBuffer());
        var logoFile = templateZip.file("xl/media/image1.png");
        if (logoFile) {
          var logoBase64 = await logoFile.async("base64");
          doc.addImage("data:image/png;base64," + logoBase64, "PNG", 25, 27, 118, 58, undefined, "FAST");
        }
      }
    }
  } catch (logoErr) {
    console.warn("Mileage PDF logo could not be loaded", logoErr);
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("McCOY CORPORATION - BULK MILEAGE REIMBURSEMENT FORM", 365, 42, { align: "center" });
  setLine(0.8);
  doc.line(205, 46, 525, 46);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("EMPLOYEE'S LAST NAME, FIRST NAME:", 210, 63);
  doc.line(353, 67, right, 67);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(profile.name || "", 470, 62, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("EMPLOYEE #:", 210, 91);
  doc.line(257, 95, 355, 95);
  doc.text("EMPLOYEE'S DEPT / STORE #:", 430, 91);
  doc.line(548, 95, right, 95);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(String(profile.employeeNumber || ""), 306, 90, { align: "center" });
  doc.text(String(profile.deptStore || ""), 569, 90, { align: "center" });

  doc.setFillColor(yellow[0], yellow[1], yellow[2]);
  doc.rect(382, 103, right - 382, 12, "F");
  centeredText("*Use this form for miles driven ON or AFTER August 1st, 2026*", 382, right, 109, { size: 6.4, bold: true });

  // Mileage table heading.
  setLine(0.8);
  doc.line(left, 115, right, 115);
  doc.line(left, 126, right, 126);
  centeredText("MILEAGE", left, right, 120.5, { size: 7, bold: true });

  var xs = [left, 88, 154, 318, 384, 442, 500, 528, right];
  var headerTop = 126;
  var headerBottom = 178;
  var rowHeight = 9.3;
  var rowBottom = headerBottom + MILEAGE_MAX_ROWS * rowHeight;
  xs.forEach(function (x) { doc.line(x, headerTop, x, rowBottom); });
  doc.line(left, headerBottom, right, headerBottom);

  centeredText("MILEAGE BEGIN", xs[0], xs[1], 143, { size: 6.5, bold: true });
  centeredText("DATE:", xs[0], xs[1], 153, { size: 6.5, bold: true });
  centeredText("MILEAGE END", xs[1], xs[2], 143, { size: 6.5, bold: true });
  centeredText("DATE:", xs[1], xs[2], 153, { size: 6.5, bold: true });
  centeredText("MILEAGE DESCRIPTION:", xs[2], xs[3], 148, { size: 6.5, bold: true });
  centeredText("MILEAGE FOR", xs[3], xs[4], 140, { size: 6.1, bold: true });
  centeredText("DEPT/ STORE#?:", xs[3], xs[4], 150, { size: 6.1, bold: true });
  centeredText("BEGINNING", xs[4], xs[5], 142, { size: 6.1, bold: true });
  centeredText("ODOMETER", xs[4], xs[5], 152, { size: 6.1, bold: true });
  centeredText("ENDING", xs[5], xs[6], 142, { size: 6.1, bold: true });
  centeredText("ODOMETER", xs[5], xs[6], 152, { size: 6.1, bold: true });
  centeredText("TOTAL", xs[6], xs[7], 142, { size: 6.1, bold: true });
  centeredText("MILES", xs[6], xs[7], 152, { size: 6.1, bold: true });
  centeredText("$ AMOUNT", xs[7], xs[8], 134, { size: 6.5, bold: true });
  centeredText("@ $.73 / MILE", xs[7], xs[8], 149, { size: 6.2, bold: true });
  centeredText("(EFF 08/01/2026)", xs[7], xs[8], 163, { size: 5.8, bold: true });

  var totalMiles = 0;
  var totalAmount = 0;
  for (var i = 0; i < MILEAGE_MAX_ROWS; i++) {
    var y1 = headerBottom + i * rowHeight;
    var y2 = y1 + rowHeight;
    doc.line(left, y2, right, y2);
    var t = trips[i];
    if (!t) continue;
    var miles = Math.max(0, Number(t.endOdometer) - Number(t.beginOdometer));
    var amount = miles * 0.73;
    totalMiles += miles;
    totalAmount += amount;
    var cy = (y1 + y2) / 2;
    centeredText(formatDate(t.beginDate), xs[0], xs[1], cy, { size: 6.2 });
    centeredText(formatDate(t.endDate || t.beginDate), xs[1], xs[2], cy, { size: 6.2 });
    centeredText(t.description || "", xs[2], xs[3], cy, { size: (t.description || "").length > 32 ? 5.4 : 6.2 });
    centeredText(profile.deptStore || "", xs[3], xs[4], cy, { size: 6.3, bold: true });
    rightText(formatNumber(t.beginOdometer), xs[5] - 4, cy, 6.2, false);
    rightText(formatNumber(t.endOdometer), xs[6] - 4, cy, 6.2, false);
    rightText(formatNumber(miles), xs[7] - 3, cy, 6.2, false);
    rightText(formatMoney(amount), xs[8] - 3, cy, 6.2, false);
  }

  var totalsY = rowBottom + 10;
  doc.rect(350, totalsY, 240, 14);
  doc.line(500, totalsY, 500, totalsY + 14);
  doc.line(528, totalsY, 528, totalsY + 14);
  rightText("MILEAGE TOTALS:", 496, totalsY + 7, 6.5, true);
  rightText(formatNumber(totalMiles), 525, totalsY + 7, 6.5, true);
  rightText(formatMoney(totalAmount), 587, totalsY + 7, 6.5, true);

  var signatureY = totalsY + 34;
  doc.rect(255, signatureY, 335, 40);
  doc.line(319, signatureY, 319, signatureY + 40);
  centeredText("EMPLOYEE'S", 255, 319, signatureY + 15, { size: 6.3, bold: true });
  centeredText("SIGNATURE:", 255, 319, signatureY + 24, { size: 6.3, bold: true });

  var safeName = (profile.name || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save("mileage-log-" + safeName + "-" + localDateStr(new Date()) + ".pdf");
}
