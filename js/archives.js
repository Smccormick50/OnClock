// Renders a list of archive records (from the `archives` Firestore
// collection) into `containerEl`, grouped by month, newest first.
// `docs`: array of { id, uid, name, date, month, sessions, notes, totalMinutes }
// `showName`: true to show whose log it is on each row (admin view).
function renderArchiveGroups(containerEl, docs, showName) {
  containerEl.innerHTML = "";
  if (!docs.length) {
    containerEl.innerHTML = '<div class="log-empty">No archived logs yet — the first one is saved automatically at 11:59pm.</div>';
    return;
  }

  var byMonth = {};
  docs.forEach(function (d) {
    if (!byMonth[d.month]) byMonth[d.month] = [];
    byMonth[d.month].push(d);
  });
  var months = Object.keys(byMonth).sort().reverse();

  months.forEach(function (month, i) {
    var entries = byMonth[month].slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var details = document.createElement("details");
    details.open = i === 0;
    details.style.marginBottom = "10px";

    var summary = document.createElement("summary");
    summary.style.cursor = "pointer";
    summary.style.fontFamily = "'Barlow Condensed', sans-serif";
    summary.style.fontWeight = "600";
    summary.style.fontSize = "17px";
    summary.style.color = "var(--pine)";
    summary.style.padding = "6px 0";
    summary.textContent = fmtMonthLabel(month) + " (" + entries.length + ")";
    details.appendChild(summary);

    var list = document.createElement("div");
    entries.forEach(function (e) {
      var row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "7px 0";
      row.style.borderBottom = "1px dashed var(--line)";

      var left = document.createElement("span");
      left.style.fontSize = "14px";
      left.textContent = fmtHeaderDate(e.date) + (showName ? "  —  " + e.name : "");

      var right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "10px";
      var total = document.createElement("span");
      total.style.fontFamily = "'Space Mono', monospace";
      total.style.fontSize = "13px";
      total.style.color = "var(--ink-soft)";
      total.textContent = fmtDuration(e.totalMinutes || 0);
      var viewBtn = document.createElement("button");
      viewBtn.className = "btn secondary";
      viewBtn.style.padding = "4px 12px";
      viewBtn.style.fontSize = "13px";
      viewBtn.textContent = "View PDF";
      viewBtn.onclick = function () {
        exportDayPdf(e.name, e.date, { sessions: e.sessions || [], notes: e.notes || [], completedTodos: e.completedTodos || [] });
      };
      var csvBtn = document.createElement("button");
      csvBtn.className = "btn secondary";
      csvBtn.style.padding = "4px 12px";
      csvBtn.style.fontSize = "13px";
      csvBtn.textContent = "CSV";
      csvBtn.onclick = function () {
        exportDayCsv(e.name, e.date, { sessions: e.sessions || [], notes: e.notes || [], completedTodos: e.completedTodos || [] });
      };

      right.appendChild(total);
      right.appendChild(viewBtn);
      right.appendChild(csvBtn);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });
    details.appendChild(list);
    containerEl.appendChild(details);
  });
}

function fmtMonthLabel(monthStr) {
  var parts = monthStr.split("-").map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1] - 1, 1, 12));
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}
