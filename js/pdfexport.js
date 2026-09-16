// Builds and downloads a branded, one-or-more-page PDF report for a
// single day's data. `data` is { sessions: [...], notes: [...] }.
// Styled to match the McCoy's / OnClock invoice-style look: a green
// header band, gold accent stripe, boxed total callout, and
// green-headed tables.

var PDF_GREEN = [31, 59, 46];
var PDF_GOLD = [244, 196, 33];
var PDF_INK = [38, 34, 27];
var PDF_INK_SOFT = [110, 104, 90];
var PDF_ROW_TINT = [235, 240, 233];
var PDF_LINE = [210, 202, 180];
var PDF_WHITE = [255, 255, 255];

function exportDayPdf(personName, dateStr, data) {
  var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) return;
  personName = personName || "Employee";

  var doc = new jsPDFCtor({ unit: "pt", format: "letter" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 46;
  var contentW = pageWidth - margin * 2;
  var y;
  var rowCounter = 0; // tracks alternating row shading across a whole table

  function setFill(c) { doc.setFillColor(c[0], c[1], c[2]); }
  function setText(c) { doc.setTextColor(c[0], c[1], c[2]); }
  function setDraw(c) { doc.setDrawColor(c[0], c[1], c[2]); }

  function ensureRoom(need) {
    if (y + need > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function drawHeader() {
    setFill(PDF_GREEN);
    doc.rect(0, 0, pageWidth, 64, "F");
    setText(PDF_GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("OnClock", margin, 40);

    setText(PDF_WHITE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("McCoy's Building Supply", pageWidth - margin, 27, { align: "right" });
    doc.setFontSize(9);
    doc.text("Facilities Department", pageWidth - margin, 40, { align: "right" });

    setFill(PDF_GOLD);
    doc.rect(0, 64, pageWidth, 5, "F");

    y = 64 + 5 + 34;
    setText(PDF_GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("DAILY TIME LOG", margin, y);
  }

  function drawInfoAndTotal() {
    var boxW = 150, boxH = 62;
    var boxX = pageWidth - margin - boxW;
    var boxY = y + 22;

    setText(PDF_INK_SOFT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("EMPLOYEE", margin, boxY + 8);
    doc.text("DATE", margin, boxY + 30);

    setText(PDF_INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(personName, margin + 74, boxY + 8);
    doc.setFont("helvetica", "normal");
    doc.text(fmtHeaderDate(dateStr), margin + 74, boxY + 30);

    setFill(PDF_GREEN);
    doc.rect(boxX, boxY, boxW, 18, "F");
    setText(PDF_GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("TOTAL HOURS", boxX + boxW / 2, boxY + 12.5, { align: "center" });

    setDraw(PDF_GREEN);
    doc.setLineWidth(1);
    doc.rect(boxX, boxY + 18, boxW, boxH - 18, "S");
    setText(PDF_GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.text(fmtDuration(totalMinutesFor(data)), boxX + boxW / 2, boxY + 18 + (boxH - 18) / 2 + 6, { align: "center" });

    y = boxY + boxH + 26;
  }

  function sectionLabel(text) {
    ensureRoom(24);
    setText(PDF_GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(text, margin, y);
    y += 14;
  }

  function tableHeader(cols) {
    ensureRoom(24);
    setFill(PDF_GREEN);
    doc.rect(margin, y, contentW, 20, "F");
    setText(PDF_GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    cols.forEach(function (c) { doc.text(c.label, margin + c.x, y + 13.5); });
    y += 20;
    rowCounter = 0;
  }

  // Draws one table row: cells = [{text, x}], rowH defaults to 20.
  function tableRow(cells, rowH) {
    rowH = rowH || 20;
    ensureRoom(rowH);
    if (rowCounter % 2 === 1) {
      setFill(PDF_ROW_TINT);
      doc.rect(margin, y, contentW, rowH, "F");
    }
    setText(PDF_INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    cells.forEach(function (cell) {
      var lines = Array.isArray(cell.text) ? cell.text : [cell.text];
      lines.forEach(function (lineTxt, li) {
        doc.text(lineTxt, margin + cell.x, y + 13.5 + li * 13);
      });
    });
    y += rowH;
    rowCounter++;
  }

  function emptyRow(text) {
    tableRow([{ text: text, x: 10 }]);
  }

  // ---------- build the document ----------
  drawHeader();
  drawInfoAndTotal();

  sectionLabel("Clock In / Out");
  tableHeader([
    { label: "TIME", x: 10 },
    { label: "EVENT", x: 130 },
    { label: "DURATION", x: 300 }
  ]);

  if (!data.sessions || data.sessions.length === 0) {
    emptyRow("No punches recorded.");
  } else {
    data.sessions.forEach(function (s) {
      tableRow([
        { text: fmtTime(s.clockIn), x: 10 },
        { text: "Clocked in", x: 130 }
      ]);
      tableRow([
        { text: s.clockOut ? fmtTime(s.clockOut) : "—", x: 10 },
        { text: s.clockOut ? "Clocked out" : "Still clocked in", x: 130 },
        { text: s.clockOut ? fmtDuration(minutesBetween(s.clockIn, s.clockOut)) : "", x: 300 }
      ]);
    });
  }

  y += 22;

  sectionLabel("Notes");
  tableHeader([
    { label: "TIME", x: 10 },
    { label: "NOTE", x: 130 }
  ]);

  if (!data.notes || data.notes.length === 0) {
    emptyRow("No notes logged.");
  } else {
    var sortedNotes = data.notes.slice().sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    sortedNotes.forEach(function (n) {
      var wrapped = doc.splitTextToSize(n.text, contentW - 140);
      var rowH = Math.max(20, wrapped.length * 13 + 7);
      tableRow([
        { text: fmtTime(n.time), x: 10 },
        { text: wrapped, x: 130 }
      ], rowH);
    });
  }

  // Totals bar
  y += 16;
  ensureRoom(30);
  setFill(PDF_GREEN);
  doc.rect(margin, y, contentW, 28, "F");
  setText(PDF_GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL HOURS", margin + 12, y + 18.5);
  doc.setFontSize(15);
  doc.text(fmtDuration(totalMinutesFor(data)), pageWidth - margin - 12, y + 19.5, { align: "right" });
  y += 28;

  // Signature line
  y += 40;
  ensureRoom(30);
  setDraw(PDF_LINE);
  doc.setLineWidth(1);
  doc.line(margin, y, margin + 220, y);
  setText(PDF_INK_SOFT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Employee Signature", margin, y + 12);

  var safeName = personName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save("worklog-" + safeName + "-" + dateStr + ".pdf");
}
