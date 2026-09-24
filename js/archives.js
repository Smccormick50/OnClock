// Read-only history browser used by the admin dashboard. Live completed
// entries and frozen nightly archives are merged before they reach here.
function renderHistoryGroups(containerEl, docs, showName) {
  containerEl.innerHTML = "";

  var employeeSelect = document.getElementById("historyEmployee");
  var monthSelect = document.getElementById("historyMonth");
  var selectedUid = employeeSelect ? employeeSelect.value : "";
  var selectedMonth = monthSelect ? monthSelect.value : "";

  populateHistoryEmployees(employeeSelect, docs, selectedUid);
  populateHistoryMonths(monthSelect, docs, selectedMonth);
  selectedUid = employeeSelect ? employeeSelect.value : "";
  selectedMonth = monthSelect ? monthSelect.value : "";

  var visibleDocs = docs.filter(function (doc) {
    return (!selectedUid || doc.uid === selectedUid) &&
      (!selectedMonth || String(doc.date || "").slice(0, 7) === selectedMonth);
  });
  updateHistorySummary(visibleDocs, selectedUid, employeeSelect, selectedMonth);

  if (!visibleDocs.length) {
    containerEl.innerHTML = '<div class="archive-empty">No completed logs match those filters.</div>';
    return;
  }

  var byMonth = {};
  visibleDocs.forEach(function (doc) {
    var month = doc.month || String(doc.date || "").slice(0, 7) || "Unknown";
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(doc);
  });

  Object.keys(byMonth).sort().reverse().forEach(function (month, monthIndex) {
    var entries = byMonth[month].slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    });
    var monthMinutes = entries.reduce(function (sum, entry) { return sum + archiveMinutes(entry); }, 0);
    var group = document.createElement("details");
    group.className = "archive-month";
    group.open = monthIndex === 0;

    var summary = document.createElement("summary");
    summary.className = "archive-month-summary";
    var monthTitle = document.createElement("span");
    monthTitle.className = "archive-month-title";
    monthTitle.textContent = fmtMonthLabel(month);
    var monthStats = document.createElement("span");
    monthStats.className = "archive-month-stats";
    monthStats.textContent = entries.length + (entries.length === 1 ? " log" : " logs") + " · " + fmtDuration(monthMinutes);
    summary.appendChild(monthTitle);
    summary.appendChild(monthStats);
    group.appendChild(summary);

    var content = document.createElement("div");
    content.className = "archive-month-content";
    var monthTools = document.createElement("div");
    monthTools.className = "archive-month-tools";
    var monthCsvBtn = document.createElement("button");
    monthCsvBtn.className = "btn archive-month-download";
    monthCsvBtn.textContent = "Download CSV for " + fmtMonthLabel(month);
    monthCsvBtn.onclick = function () { exportHistoryMonthCsv(month, entries); };
    monthTools.appendChild(monthCsvBtn);
    content.appendChild(monthTools);

    var tableWrap = document.createElement("div");
    tableWrap.className = "archive-table-wrap";
    var table = document.createElement("table");
    table.className = "archive-table";
    table.innerHTML = '<thead><tr><th>Date</th>' + (showName ? '<th>Employee</th>' : '') +
      '<th>Status</th><th>Punches</th><th>Notes</th><th>Total</th><th>Actions</th></tr></thead>';
    var tbody = document.createElement("tbody");

    entries.forEach(function (entry) {
      var row = document.createElement("tr");
      addTextCell(row, fmtHeaderDate(entry.date), "archive-date-cell");
      if (showName) addTextCell(row, entry.name || "Employee");
      var statusCell = document.createElement("td");
      var status = document.createElement("span");
      status.className = "history-status " + (entry.recordStatus === "Archived" ? "archived" : "completed");
      status.textContent = entry.recordStatus || "Completed";
      statusCell.appendChild(status);
      row.appendChild(statusCell);
      addTextCell(row, String(archivePunchCount(entry)));
      addTextCell(row, String((entry.notes || []).length + (entry.completedTodos || []).length));
      addTextCell(row, fmtDuration(archiveMinutes(entry)), "archive-total-cell");

      var actionsCell = document.createElement("td");
      actionsCell.className = "archive-actions";
      var detailRow = document.createElement("tr");
      detailRow.className = "archive-detail-row";
      detailRow.hidden = true;
      var detailCell = document.createElement("td");
      detailCell.colSpan = showName ? 7 : 6;
      detailCell.appendChild(buildArchiveDayDetail(entry));
      detailRow.appendChild(detailCell);

      var viewBtn = makeArchiveAction("View", "primary");
      viewBtn.setAttribute("aria-expanded", "false");
      viewBtn.onclick = function () {
        var opening = detailRow.hidden;
        detailRow.hidden = !opening;
        viewBtn.textContent = opening ? "Close" : "View";
        viewBtn.setAttribute("aria-expanded", String(opening));
      };
      var pdfBtn = makeArchiveAction("PDF", "secondary");
      pdfBtn.onclick = function () { exportDayPdf(entry.name, entry.date, archiveDayData(entry)); };
      var csvBtn = makeArchiveAction("CSV", "secondary");
      csvBtn.onclick = function () { exportDayCsv(entry.name, entry.date, archiveDayData(entry)); };
      actionsCell.appendChild(viewBtn);
      actionsCell.appendChild(pdfBtn);
      actionsCell.appendChild(csvBtn);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
      tbody.appendChild(detailRow);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    content.appendChild(tableWrap);
    group.appendChild(content);
    containerEl.appendChild(group);
  });
}

function populateHistoryEmployees(select, docs, previousValue) {
  if (!select) return;
  var employees = {};
  docs.forEach(function (doc) { if (doc.uid) employees[doc.uid] = doc.name || "Employee"; });
  select.innerHTML = '<option value="">All employees</option>';
  Object.keys(employees).sort(function (a, b) { return employees[a].localeCompare(employees[b]); }).forEach(function (uid) {
    var option = document.createElement("option");
    option.value = uid;
    option.textContent = employees[uid];
    select.appendChild(option);
  });
  if (previousValue && employees[previousValue]) select.value = previousValue;
}

function populateHistoryMonths(select, docs, previousValue) {
  if (!select) return;
  var months = {};
  docs.forEach(function (doc) { var month = String(doc.date || "").slice(0, 7); if (month) months[month] = true; });
  select.innerHTML = '<option value="">All months</option>';
  Object.keys(months).sort().reverse().forEach(function (month) {
    var option = document.createElement("option");
    option.value = month;
    option.textContent = fmtMonthLabel(month);
    select.appendChild(option);
  });
  if (previousValue && months[previousValue]) select.value = previousValue;
}

function updateHistorySummary(docs, selectedUid, employeeSelect, selectedMonth) {
  var summary = document.getElementById("historyFilterSummary");
  if (!summary) return;
  var who = "all employees";
  if (selectedUid && employeeSelect.selectedIndex >= 0) who = employeeSelect.options[employeeSelect.selectedIndex].textContent;
  summary.textContent = "Showing " + who + (selectedMonth ? " in " + fmtMonthLabel(selectedMonth) : "") +
    " — " + docs.length + (docs.length === 1 ? " day" : " days");
}

function addTextCell(row, text, className) {
  var cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  row.appendChild(cell);
}

function archiveDayData(entry) {
  var archivedAtMs = entry.archivedAt ? new Date(entry.archivedAt).getTime() : NaN;
  return {
    sessions: (entry.sessions || []).map(function (session) {
      var copy = { clockIn: session.clockIn || null, clockOut: session.clockOut || null };
      if (copy.clockOut && Number.isFinite(archivedAtMs) && new Date(copy.clockOut).getTime() > archivedAtMs) copy.clockOut = entry.archivedAt;
      return copy;
    }),
    notes: entry.notes || [],
    completedTodos: entry.completedTodos || []
  };
}
function archiveMinutes(entry) { return totalMinutesFor(archiveDayData(entry)); }
function archivePunchCount(entry) {
  return (entry.sessions || []).reduce(function (count, session) {
    return count + (session.clockIn ? 1 : 0) + (session.clockOut ? 1 : 0);
  }, 0);
}
function makeArchiveAction(label, kind) {
  var button = document.createElement("button");
  button.className = "archive-action " + kind;
  button.type = "button";
  button.textContent = label;
  return button;
}
function buildArchiveDayDetail(entry) {
  var panel = document.createElement("div");
  panel.className = "archive-day-detail";
  var title = document.createElement("div");
  title.className = "archive-day-detail-title";
  title.textContent = (entry.name || "Employee") + " — " + fmtHeaderDate(entry.date) + " — " + fmtDuration(archiveMinutes(entry));
  panel.appendChild(title);
  var data = archiveDayData(entry);
  var timeline = [];
  data.sessions.forEach(function (session) {
    if (session.clockIn) timeline.push({ time: session.clockIn, type: "Clocked in", detail: "" });
    if (session.clockOut) timeline.push({ time: session.clockOut, type: "Clocked out", detail: session.clockIn ? fmtDuration(minutesBetween(session.clockIn, session.clockOut)) : "" });
  });
  data.notes.forEach(function (note) { timeline.push({ time: note.time, type: "Note", detail: note.text || "" }); });
  data.completedTodos.forEach(function (todo) { timeline.push({ time: todo.completedAt, type: "Completed", detail: todo.text || "" }); });
  timeline.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
  if (!timeline.length) {
    var empty = document.createElement("div");
    empty.className = "archive-day-empty";
    empty.textContent = "No punches or notes were saved for this day.";
    panel.appendChild(empty);
    return panel;
  }
  timeline.forEach(function (item) {
    var line = document.createElement("div");
    line.className = "archive-timeline-row";
    addHistorySpan(line, item.time ? fmtTime(item.time) : "—", "archive-timeline-time");
    addHistorySpan(line, item.type, "archive-timeline-type");
    addHistorySpan(line, item.detail, "archive-timeline-detail");
    panel.appendChild(line);
  });
  return panel;
}
function addHistorySpan(parent, text, className) {
  var span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  parent.appendChild(span);
}
function exportHistoryMonthCsv(month, entries) {
  var rows = [["Employee History"], ["Month", fmtMonthLabel(month)], [], ["Employee", "Date", "Status", "Punches", "Notes / Completed", "Total Hours"]];
  entries.slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || "")) || String(a.date || "").localeCompare(String(b.date || ""));
  }).forEach(function (entry) {
    rows.push([entry.name || "Employee", fmtHeaderDate(entry.date), entry.recordStatus || "Completed", archivePunchCount(entry),
      (entry.notes || []).length + (entry.completedTodos || []).length, fmtDuration(archiveMinutes(entry))]);
  });
  downloadCsvFile("employee-history-" + month + ".csv", rows);
}
function fmtMonthLabel(monthStr) {
  var parts = monthStr.split("-").map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1] - 1, 1, 12));
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}
