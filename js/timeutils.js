function localDateStr(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}
function parseLocalDate(dateStr) {
  var parts = dateStr.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function fmtHeaderDate(dateStr) {
  var d = parseLocalDate(dateStr);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtTimeSec(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
function minutesBetween(startIso, endIso) {
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}
function fmtDuration(totalMinutes) {
  var m = Math.round(totalMinutes);
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return h + "h " + String(mm).padStart(2, "0") + "m";
}
function fromTimeInputValue(dateStr, timeVal) {
  var d = parseLocalDate(dateStr);
  var parts = timeVal.split(":").map(Number);
  d.setHours(parts[0], parts[1], 0, 0);
  return d.toISOString();
}
function totalMinutesFor(data) {
  var total = 0;
  (data.sessions || []).forEach(function (s) {
    if (s.clockOut) total += minutesBetween(s.clockIn, s.clockOut);
    else total += minutesBetween(s.clockIn, new Date().toISOString());
  });
  return total;
}
function currentOpenSession(data) {
  if (!data.sessions || data.sessions.length === 0) return null;
  // Scans all sessions, not just the last one — a backfilled punch
  // (added out of chronological order) could otherwise hide a
  // genuinely still-open session sitting earlier in the array.
  for (var i = data.sessions.length - 1; i >= 0; i--) {
    if (!data.sessions[i].clockOut) return data.sessions[i];
  }
  return null;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function emptyDay() { return { sessions: [], notes: [], completedTodos: [] }; }
function entryId(uid, dateStr) { return uid + "_" + dateStr; }
