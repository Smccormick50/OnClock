// Shared CSV builders. CSV downloads use a plain <a> + Blob URL —
// this is a normal static site, not a sandboxed artifact, so a direct
// download link works fine (no special download API needed).

function csvField(value) {
  var s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsvString(rows) {
  // Leading BOM helps Excel detect UTF-8 (so em dashes etc. render right).
  return "\uFEFF" + rows.map(function (row) {
    return row.map(csvField).join(",");
  }).join("\r\n");
}

function downloadCsvFile(filename, rows) {
  var csv = toCsvString(rows);
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// One day's detail — mirrors the PDF export, as a CSV.
function exportDayCsv(personName, dateStr, data) {
  personName = personName || "Employee";
  var rows = [];
  rows.push(["Employee", personName]);
  rows.push(["Date", fmtHeaderDate(dateStr)]);
  rows.push(["Total hours", fmtDuration(totalMinutesFor(data))]);
  rows.push([]);
  rows.push(["Time", "Type", "Detail"]);

  var entries = [];
  (data.sessions || []).forEach(function (s) {
    entries.push({ t: s.clockIn, type: "Clocked in", detail: "" });
    if (s.clockOut) {
      entries.push({ t: s.clockOut, type: "Clocked out", detail: fmtDuration(minutesBetween(s.clockIn, s.clockOut)) });
    }
  });
  (data.notes || []).forEach(function (n) {
    entries.push({ t: n.time, type: "Note", detail: n.text });
  });
  entries.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });
  entries.forEach(function (e) {
    rows.push([fmtTime(e.t), e.type, e.detail]);
  });

  var safeName = personName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  downloadCsvFile("worklog-" + safeName + "-" + dateStr + ".csv", rows);
}

// A date range across (possibly) many employees — one row per
// employee per day, plus a totals section. `dayRows` is
// [{ name, date, totalMinutes, notes }], one entry per employee-day
// that had anything logged.
function exportRangeCsv(dayRows, startStr, endStr) {
  var rows = [];
  rows.push(["Work From Home — Pay Period Report"]);
  rows.push(["From", fmtHeaderDate(startStr), "To", fmtHeaderDate(endStr)]);
  rows.push([]);
  rows.push(["Employee", "Date", "Total Hours", "Notes"]);

  var sorted = dayRows.slice().sort(function (a, b) {
    return a.name.localeCompare(b.name) || a.date.localeCompare(b.date);
  });
  sorted.forEach(function (r) {
    rows.push([r.name, fmtHeaderDate(r.date), fmtDuration(r.totalMinutes), r.notes || ""]);
  });

  rows.push([]);
  rows.push(["Employee", "Total Hours (Period)"]);
  var totalsByName = {};
  dayRows.forEach(function (r) {
    totalsByName[r.name] = (totalsByName[r.name] || 0) + r.totalMinutes;
  });
  Object.keys(totalsByName).sort().forEach(function (name) {
    rows.push([name, fmtDuration(totalsByName[name])]);
  });

  downloadCsvFile("pay-period-" + startStr + "-to-" + endStr + ".csv", rows);
}
