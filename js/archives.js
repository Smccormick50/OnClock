// Admin archive browser. Records are grouped by month, newest first.
// The newest month opens automatically; every archived day remains read-only.
function renderArchiveGroups(containerEl, docs, showName) {
  containerEl.innerHTML = "";
  if (!docs.length) {
    containerEl.innerHTML = '<div class="archive-empty">No archived logs yet. The first archive is saved automatically at the end of the day.</div>';
    return;
  }

  var employeeSelect = document.getElementById("archiveEmployee");
  var selectedUid = employeeSelect ? employeeSelect.value : "";
  if (employeeSelect) {
    var employeesByUid = {};
    docs.forEach(function (doc) {
      if (doc.uid) employeesByUid[doc.uid] = doc.name || "Employee";
    });
    employeeSelect.innerHTML = '<option value="">All employees</option>';
    Object.keys(employeesByUid).sort(function (a, b) {
      return employeesByUid[a].localeCompare(employeesByUid[b]);
    }).forEach(function (uid) {
      var option = document.createElement("option");
      option.value = uid;
      option.textContent = employeesByUid[uid];
      employeeSelect.appendChild(option);
    });
    if (selectedUid && employeesByUid[selectedUid]) employeeSelect.value = selectedUid;
    else selectedUid = "";
  }

  var visibleDocs = selectedUid ? docs.filter(function (doc) { return doc.uid === selectedUid; }) : docs;
  var filterSummary = document.getElementById("archiveFilterSummary");
  if (filterSummary) {
    var selectedName = employeeSelect && employeeSelect.selectedIndex >= 0
      ? employeeSelect.options[employeeSelect.selectedIndex].textContent
      : "All employees";
    filterSummary.textContent = selectedUid
      ? "Showing " + selectedName + " — " + visibleDocs.length + (visibleDocs.length === 1 ? " archived day" : " archived days")
      : "Showing all employees — " + visibleDocs.length + (visibleDocs.length === 1 ? " archived day" : " archived days");
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
    var monthMinutes = entries.reduce(function (sum, entry) {
      return sum + archiveMinutes(entry);
    }, 0);

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
    monthCsvBtn.onclick = function () { exportArchiveMonthCsv(month, entries); };
    monthTools.appendChild(monthCsvBtn);
    content.appendChild(monthTools);

    var tableWrap = document.createElement("div");
    tableWrap.className = "archive-table-wrap";
    var table = document.createElement("table");
    table.className = "archive-table";
    table.innerHTML = '<thead><tr><th>Date</th>' +
      (showName ? '<th>Employee</th>' : '') +
      '<th>Punches</th><th>Notes</th><th>Total</th><th>Actions</th></tr></thead>';
    var tbody = document.createElement("tbody");

    entries.forEach(function (entry) {
      var row = document.createElement("tr");
      var dateCell = document.createElement("td");
      dateCell.className = "archive-date-cell";
      dateCell.textContent = fmtHeaderDate(entry.date);
      row.appendChild(dateCell);

      if (showName) {
        var nameCell = document.createElement("td");
        nameCell.textContent = entry.name || "Employee";
        row.appendChild(nameCell);
      }

      var punchesCell = document.createElement("td");
      punchesCell.textContent = String(archivePunchCount(entry));
      row.appendChild(punchesCell);

      var notesCell = document.createElement("td");
      notesCell.textContent = String((entry.notes || []).length + (entry.completedTodos || []).length);
      row.appendChild(notesCell);

      var totalCell = document.createElement("td");
      totalCell.className = "archive-total-cell";
      totalCell.textContent = fmtDuration(archiveMinutes(entry));
      row.appendChild(totalCell);

      var actionsCell = document.createElement("td");
      actionsCell.className = "archive-actions";
      var detailRow = document.createElement("tr");
      detailRow.className = "archive-detail-row";
      detailRow.hidden = true;
      var detailCell = document.createElement("td");
      detailCell.colSpan = showName ? 6 : 5;
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
      pdfBtn.onclick = function () {
        exportDayPdf(entry.name, entry.date, archiveDayData(entry));
      };
      var csvBtn = makeArchiveAction("CSV", "secondary");
      csvBtn.onclick = function () {
        exportDayCsv(entry.name, entry.date, archiveDayData(entry));
      };

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

function archiveDayData(entry) {
  var archivedAtMs = entry.archivedAt ? new Date(entry.archivedAt).getTime() : NaN;
  return {
    // Older versions of the manual archive job could give a still-open
    // same-day session an 11:59pm clock-out. If that clock-out is later
    // than the moment the archive was actually created, cap the frozen
    // copy at archivedAt. This repairs the displayed total, PDF and CSV
    // without changing the employee's live entry.
    sessions: (entry.sessions || []).map(function (session) {
      var copy = { clockIn: session.clockIn || null, clockOut: session.clockOut || null };
      if (copy.clockOut && Number.isFinite(archivedAtMs) && new Date(copy.clockOut).getTime() > archivedAtMs) {
        copy.clockOut = entry.archivedAt;
      }
      return copy;
    }),
    notes: entry.notes || [],
    completedTodos: entry.completedTodos || []
  };
}

function archiveMinutes(entry) {
  // Recalculate from the normalized frozen sessions instead of trusting
  // an older stored total that may include a future 11:59pm clock-out.
  return totalMinutesFor(archiveDayData(entry));
}

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
    if (session.clockOut) {
      timeline.push({
        time: session.clockOut,
        type: "Clocked out",
        detail: session.clockIn ? fmtDuration(minutesBetween(session.clockIn, session.clockOut)) : ""
      });
    }
  });
  data.notes.forEach(function (note) {
    timeline.push({ time: note.time, type: "Note", detail: note.text || "" });
  });
  data.completedTodos.forEach(function (todo) {
    timeline.push({ time: todo.completedAt, type: "Completed", detail: todo.text || "" });
  });
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
    var time = document.createElement("span");
    time.className = "archive-timeline-time";
    time.textContent = item.time ? fmtTime(item.time) : "—";
    var type = document.createElement("span");
    type.className = "archive-timeline-type";
    type.textContent = item.type;
    var detail = document.createElement("span");
    detail.className = "archive-timeline-detail";
    detail.textContent = item.detail;
    line.appendChild(time);
    line.appendChild(type);
    line.appendChild(detail);
    panel.appendChild(line);
  });
  return panel;
}

function exportArchiveMonthCsv(month, entries) {
  var rows = [
    ["Archived Daily Logs"],
    ["Month", fmtMonthLabel(month)],
    [],
    ["Employee", "Date", "Punches", "Notes / Completed", "Total Hours"]
  ];
  entries.slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || "")) || String(a.date || "").localeCompare(String(b.date || ""));
  }).forEach(function (entry) {
    rows.push([
      entry.name || "Employee",
      fmtHeaderDate(entry.date),
      archivePunchCount(entry),
      (entry.notes || []).length + (entry.completedTodos || []).length,
      fmtDuration(archiveMinutes(entry))
    ]);
  });
  downloadCsvFile("archived-worklogs-" + month + ".csv", rows);
}

function fmtMonthLabel(monthStr) {
  var parts = monthStr.split("-").map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1] - 1, 1, 12));
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}
