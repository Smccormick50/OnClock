// Shared Monday-Sunday work-week approval helpers.
// Loaded by both the employee and administrator pages.

function shiftWorkDate(dateStr, deltaDays) {
  var date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + deltaDays);
  return localDateStr(date);
}

function mondayForWorkDate(dateStr) {
  var date = parseLocalDate(dateStr);
  var weekday = date.getDay(); // 0 = Sunday
  var daysBack = weekday === 0 ? 6 : weekday - 1;
  date.setDate(date.getDate() - daysBack);
  return localDateStr(date);
}

function sundayForWorkWeek(mondayStr) {
  return shiftWorkDate(mondayStr, 6);
}

function datesForWorkWeek(mondayStr) {
  var dates = [];
  for (var i = 0; i < 7; i++) dates.push(shiftWorkDate(mondayStr, i));
  return dates;
}

function workWeekLabel(mondayStr) {
  return fmtHeaderDate(mondayStr) + " – " + fmtHeaderDate(sundayForWorkWeek(mondayStr));
}

function weeklySnapshotTotal(snapshot) {
  return (snapshot || []).reduce(function (sum, day) {
    if (typeof day.totalMinutes === "number") return sum + day.totalMinutes;
    return sum + totalMinutesFor(day);
  }, 0);
}

function weeklySnapshotHasOpenPunch(snapshot) {
  return (snapshot || []).some(function (day) {
    return (day.sessions || []).some(function (session) { return session.clockIn && !session.clockOut; });
  });
}

function weeklySnapshotHasWork(snapshot) {
  return (snapshot || []).some(function (day) {
    return (day.sessions || []).length || (day.notes || []).length || (day.completedTodos || []).length;
  });
}

function weeklyApprovalEventRows(day) {
  var rows = [];
  (day.sessions || []).forEach(function (session) {
    if (session.clockIn) rows.push({ time: session.clockIn, kind: "Clock in", detail: "Clocked in" });
    if (session.clockOut) {
      rows.push({
        time: session.clockOut,
        kind: "Clock out",
        detail: session.clockIn ? "Clocked out — " + fmtDuration(minutesBetween(session.clockIn, session.clockOut)) : "Clocked out without a matching clock-in"
      });
    }
  });
  (day.notes || []).forEach(function (note) {
    rows.push({ time: note.time, kind: "Note", detail: note.text || "(blank note)" });
  });
  (day.completedTodos || []).forEach(function (task) {
    rows.push({ time: task.completedAt, kind: "Completed task", detail: task.text || "(blank task)" });
  });
  rows.sort(function (a, b) {
    var aTime = new Date(a.time || 0).getTime();
    var bTime = new Date(b.time || 0).getTime();
    return aTime - bTime;
  });
  return rows;
}

function buildWeeklyApprovalLog(snapshot) {
  var wrap = document.createElement("div");
  wrap.className = "week-log";
  (snapshot || []).forEach(function (day) {
    var card = document.createElement("div");
    card.className = "week-day-card";
    var heading = document.createElement("div");
    heading.className = "week-day-heading";
    var title = document.createElement("strong");
    title.textContent = fmtHeaderDate(day.date);
    var total = document.createElement("span");
    total.textContent = fmtDuration(typeof day.totalMinutes === "number" ? day.totalMinutes : totalMinutesFor(day));
    heading.appendChild(title);
    heading.appendChild(total);
    card.appendChild(heading);

    var events = weeklyApprovalEventRows(day);
    if (!events.length) {
      var empty = document.createElement("div");
      empty.className = "week-day-empty";
      empty.textContent = "No work logged.";
      card.appendChild(empty);
    } else {
      events.forEach(function (event) {
        var row = document.createElement("div");
        row.className = "week-event-row";
        var time = document.createElement("span");
        time.className = "week-event-time";
        time.textContent = event.time ? fmtTime(event.time) : "—";
        var body = document.createElement("span");
        var kind = document.createElement("strong");
        kind.textContent = event.kind;
        var detail = document.createElement("span");
        detail.textContent = event.detail;
        body.appendChild(kind);
        body.appendChild(document.createTextNode(" — "));
        body.appendChild(detail);
        row.appendChild(time);
        row.appendChild(body);
        card.appendChild(row);
      });
    }
    wrap.appendChild(card);
  });
  return wrap;
}

function exportWeeklyApprovalCsv(approval) {
  var rows = [
    ["OnClock Work Week Approval"],
    ["Employee", approval.employeeName || "Employee"],
    ["Week", fmtHeaderDate(approval.weekStart), "through", fmtHeaderDate(approval.weekEnd)],
    ["Total hours", fmtDuration(approval.totalMinutes || weeklySnapshotTotal(approval.snapshot))],
    ["Approver", approval.approvedByName || approval.approverName || ""],
    ["Status", approval.status || ""],
    ["Approval time", approval.approvedAt || approval.approvedAtIso ? fmtDateTimeCentral(approval.approvedAt || approval.approvedAtIso) : ""],
    [],
    ["Work date", "Time", "Type", "Details"]
  ];
  (approval.snapshot || []).forEach(function (day) {
    var events = weeklyApprovalEventRows(day);
    if (!events.length) rows.push([fmtHeaderDate(day.date), "", "No work logged", ""]);
    events.forEach(function (event) {
      rows.push([fmtHeaderDate(day.date), event.time ? fmtTime(event.time) : "", event.kind, event.detail]);
    });
  });
  var safeName = String(approval.employeeName || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  downloadCsvFile("work-week-approval-" + safeName + "-" + approval.weekStart + ".csv", rows);
}

function exportWeeklyApprovalPdf(approval) {
  var JsPdf = window.jspdf && window.jspdf.jsPDF;
  if (!JsPdf) return;
  var doc = new JsPdf({ unit: "pt", format: "letter" });
  var width = doc.internal.pageSize.getWidth();
  var height = doc.internal.pageSize.getHeight();
  var margin = 44;
  var y = 0;

  function header() {
    doc.setFillColor(31, 59, 46);
    doc.rect(0, 0, width, 62, "F");
    doc.setTextColor(244, 196, 33);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.text("OnClock", margin, 39);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("WORK WEEK APPROVAL", width - margin, 37, { align: "right" });
    doc.setFillColor(244, 196, 33);
    doc.rect(0, 62, width, 5, "F");
    y = 96;
  }
  function room(needed) {
    if (y + needed > height - margin) { doc.addPage(); header(); }
  }
  function line(label, value) {
    room(20);
    doc.setTextColor(110, 104, 90);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label.toUpperCase(), margin, y);
    doc.setTextColor(38, 34, 27);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(String(value || ""), margin + 105, y);
    y += 19;
  }

  header();
  line("Employee", approval.employeeName || "Employee");
  line("Week", fmtHeaderDate(approval.weekStart) + " through " + fmtHeaderDate(approval.weekEnd));
  line("Total", fmtDuration(approval.totalMinutes || weeklySnapshotTotal(approval.snapshot)));
  line("Approved by", approval.approvedByName || approval.approverName || "");
  line("Approved", approval.approvedAt || approval.approvedAtIso ? fmtDateTimeCentral(approval.approvedAt || approval.approvedAtIso) : "");
  y += 8;

  (approval.snapshot || []).forEach(function (day) {
    var events = weeklyApprovalEventRows(day);
    room(42);
    doc.setFillColor(235, 240, 233);
    doc.rect(margin, y - 13, width - margin * 2, 25, "F");
    doc.setTextColor(31, 59, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(fmtHeaderDate(day.date), margin + 8, y + 4);
    doc.text(fmtDuration(typeof day.totalMinutes === "number" ? day.totalMinutes : totalMinutesFor(day)), width - margin - 8, y + 4, { align: "right" });
    y += 24;
    if (!events.length) {
      doc.setTextColor(110, 104, 90);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      doc.text("No work logged.", margin + 8, y);
      y += 18;
    } else {
      events.forEach(function (event) {
        var text = (event.time ? fmtTime(event.time) : "—") + "  " + event.kind + " — " + event.detail;
        var wrapped = doc.splitTextToSize(text, width - margin * 2 - 16);
        room(wrapped.length * 12 + 8);
        doc.setTextColor(38, 34, 27);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.text(wrapped, margin + 8, y);
        y += wrapped.length * 12 + 5;
      });
    }
    y += 7;
  });

  var safeName = String(approval.employeeName || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save("work-week-approval-" + safeName + "-" + approval.weekStart + ".pdf");
}
