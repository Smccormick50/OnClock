var APP_TIME_ZONE = "America/Chicago";
var APP_TIME_ZONE_LABEL = "Central Time (CT)";

function zonedParts(date, includeTime) {
  var options = { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" };
  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.second = "2-digit";
    options.hourCycle = "h23";
  }
  var result = {};
  new Intl.DateTimeFormat("en-US", options).formatToParts(date).forEach(function (part) {
    if (part.type !== "literal") result[part.type] = part.value;
  });
  return result;
}

function localDateStr(d) {
  var parts = zonedParts(d, false);
  return parts.year + "-" + parts.month + "-" + parts.day;
}
function parseLocalDate(dateStr) {
  var parts = dateStr.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}
function fmtHeaderDate(dateStr) {
  var d = parseLocalDate(dateStr);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { timeZone: APP_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}
function fmtTimeSec(d) {
  return d.toLocaleTimeString(undefined, { timeZone: APP_TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit" });
}
function fmtDateTimeCentral(iso) {
  if (!iso) return "Pending sync";
  var date = iso && typeof iso.toDate === "function" ? iso.toDate() : new Date(iso);
  if (Number.isNaN(date.getTime())) return "Pending sync";
  return date.toLocaleString(undefined, {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }) + " CT";
}
function timeInputValue(iso) {
  if (!iso) return "";
  var parts = zonedParts(new Date(iso), true);
  return parts.hour + ":" + parts.minute;
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

// Convert a Central Time wall-clock value into a UTC ISO instant.
// Iterating against Intl keeps daylight-saving changes accurate.
function fromTimeInputValue(dateStr, timeVal) {
  var dateParts = dateStr.split("-").map(Number);
  var timeParts = timeVal.split(":").map(Number);
  var desiredUtc = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], 0, 0);
  var guess = desiredUtc;
  for (var i = 0; i < 4; i++) {
    var actual = zonedParts(new Date(guess), true);
    var actualAsUtc = Date.UTC(
      Number(actual.year), Number(actual.month) - 1, Number(actual.day),
      Number(actual.hour), Number(actual.minute), Number(actual.second)
    );
    var difference = desiredUtc - actualAsUtc;
    guess += difference;
    if (difference === 0) break;
  }
  return new Date(guess).toISOString();
}
function totalMinutesFor(data) {
  var total = 0;
  (data.sessions || []).forEach(function (s) {
    if (s.clockIn && s.clockOut) {
      total += minutesBetween(s.clockIn, s.clockOut);
    } else if (s.clockIn && localDateStr(new Date(s.clockIn)) === localDateStr(new Date())) {
      total += minutesBetween(s.clockIn, new Date().toISOString());
    }
  });
  return total;
}
function currentOpenSession(data) {
  if (!data.sessions || data.sessions.length === 0) return null;
  for (var i = data.sessions.length - 1; i >= 0; i--) {
    if (data.sessions[i].clockIn && !data.sessions[i].clockOut) return data.sessions[i];
  }
  return null;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function emptyDay() { return { sessions: [], notes: [], completedTodos: [] }; }
function entryId(uid, dateStr) { return uid + "_" + dateStr; }
