// Archive health check — pure logic (no Firebase, no DOM) so it can be
// unit tested. The admin dashboard feeds it recent live entries and
// recent archives and shows a warning banner if days that should
// already be archived aren't.
//
// Why this exists: the nightly archive job once ran "successfully"
// for over a week while archiving nothing (a timing check made it
// skip every night, and its Firebase secret had never been set).
// Nothing failed loudly, so nobody noticed. GitHub's own failure
// emails only cover runs that *fail* — not a run that quietly does
// nothing, and not a schedule GitHub has disabled (it does that after
// 60 days with no repo activity). This catches both from the app side.

function healthShiftDate(dateStr, deltaDays) {
  var p = dateStr.split("-").map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + deltaDays));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

function entryHasContent(entry) {
  return !!((entry.sessions && entry.sessions.length) ||
            (entry.notes && entry.notes.length) ||
            (entry.completedTodos && entry.completedTodos.length));
}

// entries:  [{ uid, name, date, sessions, notes, completedTodos }]
// archives: [{ uid, date, isCurrentDaySnapshot }]
// cutoffDateStr: live entries dated strictly BEFORE this are expected
//   to already have a nightly archive.
// A manual mid-day "snapshot" archive doesn't count — it's a partial
// day, so it would otherwise hide a failed nightly run.
function findMissingArchives(entries, archives, cutoffDateStr) {
  var archived = {};
  (archives || []).forEach(function (a) {
    if (!a.isCurrentDaySnapshot) archived[a.uid + "_" + a.date] = true;
  });
  return (entries || []).filter(function (e) {
    return e.date < cutoffDateStr && entryHasContent(e) && !archived[e.uid + "_" + e.date];
  }).map(function (e) {
    return { uid: e.uid, name: e.name || "Employee", date: e.date };
  });
}

// Empty string means "all good".
function archiveHealthMessage(missing) {
  if (!missing || missing.length === 0) return "";
  var dates = [];
  missing.forEach(function (m) { if (dates.indexOf(m.date) < 0) dates.push(m.date); });
  dates.sort();
  var label = dates.length <= 3 ? dates.join(", ") : dates[0] + " to " + dates[dates.length - 1];
  return "Nightly archive looks behind: " + missing.length + " daily log(s) (" + label +
    ") have no saved archive. On GitHub, check Actions \u2192 \u201CArchive daily logs\u201D, " +
    "and re-run it with a date range to catch up.";
}
