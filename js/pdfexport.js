// Builds and downloads a one-page (or more, if needed) PDF report for
// a single day's data. `data` is { sessions: [...], notes: [...] }.
function exportDayPdf(personName, dateStr, data) {
  var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) return;
  personName = personName || "Employee";
  var doc = new jsPDFCtor({ unit: "pt", format: "letter" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 54;
  var y = margin;

  function ensureRoom() {
    if (y > pageHeight - margin) { doc.addPage(); y = margin; }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Work From Home — Daily Log", margin, y);
  y += 22;
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(personName + "  —  " + fmtHeaderDate(dateStr), margin, y);
  y += 10;
  doc.setDrawColor(150);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Clock In / Out", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  if (!data.sessions || data.sessions.length === 0) {
    doc.text("No punches recorded.", margin, y);
    y += 16;
  } else {
    data.sessions.forEach(function (s) {
      ensureRoom();
      var line = fmtTime(s.clockIn) + "  ->  " + (s.clockOut ? fmtTime(s.clockOut) : "(still clocked in)");
      if (s.clockOut) line += "   [" + fmtDuration(minutesBetween(s.clockIn, s.clockOut)) + "]";
      doc.text(line, margin, y);
      y += 16;
    });
  }
  y += 8;
  ensureRoom();
  doc.setFont("helvetica", "bold");
  doc.text("Total hours: " + fmtDuration(totalMinutesFor(data)), margin, y);
  y += 24;

  ensureRoom();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Notes", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  if (!data.notes || data.notes.length === 0) {
    ensureRoom();
    doc.text("No notes logged.", margin, y);
    y += 16;
  } else {
    var sortedNotes = data.notes.slice().sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    sortedNotes.forEach(function (n) {
      var prefix = fmtTime(n.time) + " - ";
      var wrapped = doc.splitTextToSize(prefix + n.text, pageWidth - margin * 2);
      wrapped.forEach(function (lineTxt) {
        ensureRoom();
        doc.text(lineTxt, margin, y);
        y += 15;
      });
    });
  }

  var safeName = personName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save("worklog-" + safeName + "-" + dateStr + ".pdf");
}
