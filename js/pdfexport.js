// Builds and downloads a branded, one-or-more-page PDF report for a
// single day's data. `data` is { sessions: [...], notes: [...],
// completedTodos: [...] }. `pendingTodos` (optional) is the current
// not-yet-done to-do list — only ever available for "today," from
// the person's own live list, so admin exports and past-day exports
// simply omit that section (there's nothing per-day to show there).
// Styled to match the McCoy's / OnClock invoice-style look: a green
// header band, gold accent stripe, boxed total callout, and a single
// continuous log table (same order everything appears in the app),
// so there are no artificial time-gaps from splitting it into
// separate tables.

var PDF_GREEN = [31, 59, 46];
var PDF_GOLD = [244, 196, 33];
var PDF_BRASS = [169, 122, 46];
var PDF_PUNCH_RED = [156, 64, 48];
var PDF_INK = [38, 34, 27];
var PDF_INK_SOFT = [110, 104, 90];
var PDF_ROW_TINT = [235, 240, 233];
var PDF_LINE = [210, 202, 180];
var PDF_WHITE = [255, 255, 255];

function exportDayPdf(personName, dateStr, data, pendingTodos) {
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

  // One row of the merged, continuous daily log. `kind` picks the
  // color/weight/label treatment, matching how the app itself colors
  // clock-ins (brass), clock-outs (red), notes (plain), and completed
  // to-dos (brass with a checkmark) — so the PDF reads the same way
  // the in-app log does.
  function logRow(timeStr, kind, mainText, extraText) {
    var wrapped = doc.splitTextToSize(mainText, contentW - 140 - (extraText ? 70 : 0));
    var rowH = Math.max(20, wrapped.length * 13 + 7);
    ensureRoom(rowH);
    if (rowCounter % 2 === 1) {
      setFill(PDF_ROW_TINT);
      doc.rect(margin, y, contentW, rowH, "F");
    }

    setText(PDF_INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(timeStr, margin + 10, y + 13.5);

    var mainColor = PDF_INK, mainFont = "normal";
    if (kind === "in" || kind === "todo") { mainColor = PDF_BRASS; mainFont = "bold"; }
    else if (kind === "out") { mainColor = PDF_PUNCH_RED; mainFont = "bold"; }

    setText(mainColor);
    doc.setFont("helvetica", mainFont);
    wrapped.forEach(function (lineTxt, li) {
      doc.text(lineTxt, margin + 130, y + 13.5 + li * 13);
    });

    if (extraText) {
      var mainWidth = doc.getTextWidth(wrapped[0]);
      setText(PDF_INK_SOFT);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(extraText, margin + 130 + mainWidth + 8, y + 13.5);
      doc.setFontSize(10);
    }

    y += rowH;
    rowCounter++;
  }

  function emptyLogRow(text) {
    ensureRoom(20);
    if (rowCounter % 2 === 1) {
      setFill(PDF_ROW_TINT);
      doc.rect(margin, y, contentW, 20, "F");
    }
    setText(PDF_INK_SOFT);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text(text, margin + 10, y + 13.5);
    y += 20;
    rowCounter++;
  }

  // ---------- build the document ----------
  drawHeader();
  drawInfoAndTotal();

  // Merge everything into one time-ordered log, same as the app does.
  var rows = [];
  (data.sessions || []).forEach(function (s) {
    if (s.clockIn) rows.push({ t: s.clockIn, kind: "in", text: "Clocked in" });
    if (s.clockOut) {
      rows.push({ t: s.clockOut, kind: "out", text: "Clocked out", extra: s.clockIn ? "(" + fmtDuration(minutesBetween(s.clockIn, s.clockOut)) + ")" : "" });
    }
  });
  (data.notes || []).forEach(function (n) {
    rows.push({ t: n.time, kind: "note", text: n.text });
  });
  (data.completedTodos || []).forEach(function (ct) {
    rows.push({ t: ct.completedAt, kind: "todo", text: "[x] " + ct.text });
  });
  rows.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });

  sectionLabel("Daily Log");
  tableHeader([
    { label: "TIME", x: 10 },
    { label: "ENTRY", x: 130 }
  ]);
  if (rows.length === 0) {
    emptyLogRow("Nothing logged for this day.");
  } else {
    rows.forEach(function (r) {
      logRow(fmtTime(r.t), r.kind, r.text, r.extra);
    });
  }

  // Pending to-dos — only shown when the caller passes today's live
  // list (see note at the top of this file).
  if (pendingTodos && pendingTodos.length > 0) {
    y += 22;
    sectionLabel("Pending To-Dos");
    tableHeader([{ label: "NOT YET DONE", x: 10 }]);
    pendingTodos.forEach(function (item, idx) {
      var wrapped = doc.splitTextToSize("[ ] " + item.text, contentW - 20);
      var rowH = Math.max(20, wrapped.length * 13 + 7);
      ensureRoom(rowH);
      if (idx % 2 === 1) { setFill(PDF_ROW_TINT); doc.rect(margin, y, contentW, rowH, "F"); }
      setText(PDF_INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      wrapped.forEach(function (lineTxt, li) {
        doc.text(lineTxt, margin + 10, y + 13.5 + li * 13);
      });
      y += rowH;
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

// Builds a standalone PDF of someone's current open to-do list — a
// snapshot of what's not yet done, meant for sharing with someone
// else, not tied to any particular day's time log.
function exportTodoListPdf(personName, items) {
  var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) return;
  personName = personName || "Employee";
  items = items || [];

  var doc = new jsPDFCtor({ unit: "pt", format: "letter" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 46;
  var contentW = pageWidth - margin * 2;
  var y;
  var rowCounter = 0;

  function setFill(c) { doc.setFillColor(c[0], c[1], c[2]); }
  function setText(c) { doc.setTextColor(c[0], c[1], c[2]); }

  function ensureRoom(need) {
    if (y + need > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // Header band, same as the daily log.
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
  doc.text("TO-DO LIST", margin, y);

  y += 22;
  setText(PDF_INK_SOFT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("FROM", margin, y);
  doc.text("AS OF", margin + 220, y);
  y += 15;
  setText(PDF_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(personName, margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }), margin + 220, y);

  y += 30;
  ensureRoom(24);
  setFill(PDF_GREEN);
  doc.rect(margin, y, contentW, 20, "F");
  setText(PDF_GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("NOT YET DONE", margin + 10, y + 13.5);
  y += 20;

  if (items.length === 0) {
    ensureRoom(20);
    setText(PDF_INK_SOFT);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("Nothing on the list.", margin + 10, y + 13.5);
    y += 20;
  } else {
    items.forEach(function (item) {
      var wrapped = doc.splitTextToSize("[ ] " + item.text, contentW - 20);
      var rowH = Math.max(20, wrapped.length * 13 + 7);
      ensureRoom(rowH);
      if (rowCounter % 2 === 1) {
        setFill(PDF_ROW_TINT);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      setText(PDF_INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      wrapped.forEach(function (lineTxt, li) {
        doc.text(lineTxt, margin + 10, y + 13.5 + li * 13);
      });
      y += rowH;
      rowCounter++;
    });
  }

  var safeName = personName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  var safeDate = localDateStr(new Date());
  doc.save("todo-list-" + safeName + "-" + safeDate + ".pdf");
}
