(function () {
  "use strict";

  var currentUser = null;
  var currentProfile = null;
  var todayStr = localDateStr(new Date());
  var viewedDate = todayStr;
  var docCache = {}; // dateStr -> {sessions, notes}
  var unsubViewed = null;
  var unsubHistory = null;
  var unsubArchives = null;

  function entryRef(dateStr) {
    return db.collection("entries").doc(entryId(currentUser.uid, dateStr));
  }

  function getDayData(dateStr) {
    return docCache[dateStr] || emptyDay();
  }

  function saveDay(dateStr, data) {
    return entryRef(dateStr).set({
      uid: currentUser.uid,
      name: currentProfile.name,
      date: dateStr,
      sessions: data.sessions,
      notes: data.notes
    });
  }

  // ---------- actions ----------
  function doClockIn() {
    var data = clone(getDayData(todayStr));
    if (currentOpenSession(data)) return;
    data.sessions.push({ clockIn: new Date().toISOString(), clockOut: null });
    setBtnBusy(true);
    saveDay(todayStr, data).finally(function () { setBtnBusy(false); });
  }
  function doClockOut() {
    var data = clone(getDayData(todayStr));
    var open = currentOpenSession(data);
    if (!open) return;
    open.clockOut = new Date().toISOString();
    setBtnBusy(true);
    saveDay(todayStr, data).finally(function () { setBtnBusy(false); });
  }
  function doAddNote(text) {
    text = text.trim();
    if (!text) return;
    var data = clone(getDayData(todayStr));
    data.notes.push({ time: new Date().toISOString(), text: text });
    saveDay(todayStr, data);
  }
  function doDeleteNote(dateStr, idx) {
    var data = clone(getDayData(dateStr));
    data.notes.splice(idx, 1);
    saveDay(dateStr, data);
  }
  function doDeleteSession(dateStr, idx) {
    var data = clone(getDayData(dateStr));
    data.sessions.splice(idx, 1);
    saveDay(dateStr, data);
  }
  function doEditSession(dateStr, idx, field, timeVal) {
    var data = clone(getDayData(dateStr));
    var sess = data.sessions[idx];
    if (!sess) return;
    sess[field] = fromTimeInputValue(dateStr, timeVal);
    saveDay(dateStr, data);
  }

  function setBtnBusy(busy) { document.getElementById("punchBtn").disabled = busy; }

  // ---------- rendering ----------
  function tickClock() {
    var now = new Date();
    document.getElementById("liveClock").textContent = fmtTimeSec(now);
    if (viewedDate === todayStr) {
      var data = getDayData(todayStr);
      var open = currentOpenSession(data);
      var statusEl = document.getElementById("clockStatus");
      if (open) statusEl.textContent = "Clocked in since " + fmtTime(open.clockIn);
      else if (data.sessions.length) statusEl.textContent = "Clocked out";
      else statusEl.textContent = "Not clocked in yet today";
      document.getElementById("totalTime").textContent = fmtDuration(totalMinutesFor(data));
      var runningEl = document.querySelector('[data-running="1"]');
      if (runningEl && open) runningEl.textContent = "(" + fmtDuration(minutesBetween(open.clockIn, now.toISOString())) + " so far)";
    }
  }

  function updatePunchButton() {
    var btn = document.getElementById("punchBtn");
    if (viewedDate !== todayStr) { btn.style.display = "none"; return; }
    btn.style.display = "inline-block";
    var open = currentOpenSession(getDayData(todayStr));
    if (open) { btn.className = "punch-btn out"; btn.textContent = "Clock Out"; }
    else { btn.className = "punch-btn in"; btn.textContent = "Clock In"; }
  }

  function renderViewed() {
    var data = getDayData(viewedDate);
    document.getElementById("logTitle").textContent = viewedDate === todayStr ? "Today's log" : fmtHeaderDate(viewedDate) + " log";
    document.getElementById("totalTime").textContent = fmtDuration(totalMinutesFor(data));
    updatePunchButton();

    var banner = document.getElementById("viewingBanner");
    if (viewedDate !== todayStr) {
      banner.style.display = "flex";
      document.getElementById("viewingText").textContent = "Viewing " + fmtHeaderDate(viewedDate);
    } else {
      banner.style.display = "none";
    }
    document.getElementById("addNotePanel").style.display = viewedDate === todayStr ? "block" : "none";

    var rows = [];
    (data.sessions || []).forEach(function (s, idx) {
      rows.push({ t: s.clockIn, type: "in", idx: idx, sess: s });
      if (s.clockOut) rows.push({ t: s.clockOut, type: "out", idx: idx, sess: s });
    });
    (data.notes || []).forEach(function (n, idx) {
      rows.push({ t: n.time, type: "note", idx: idx, text: n.text });
    });
    rows.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });

    var list = document.getElementById("logList");
    list.innerHTML = "";
    if (rows.length === 0) {
      list.innerHTML = '<li class="log-empty">No entries yet.</li>';
    } else {
      rows.forEach(function (r) {
        var li = document.createElement("li");
        li.className = "log-row";
        var timeDiv = document.createElement("div");
        timeDiv.className = "log-time";
        timeDiv.textContent = fmtTime(r.t);
        li.appendChild(timeDiv);

        var bodyDiv = document.createElement("div");
        bodyDiv.className = "log-body";

        if (r.type === "in") {
          bodyDiv.classList.add("session-in");
          bodyDiv.textContent = "Clocked in";
          li.appendChild(bodyDiv);
          li.appendChild(makeSessionEditControls(viewedDate, r.idx, "clockIn"));
        } else if (r.type === "out") {
          bodyDiv.classList.add("session-out");
          var dur = document.createElement("span");
          dur.className = "dur";
          if (!r.sess.clockOut) dur.setAttribute("data-running", "1");
          dur.textContent = "(" + fmtDuration(minutesBetween(r.sess.clockIn, r.sess.clockOut)) + ")";
          bodyDiv.textContent = "Clocked out";
          bodyDiv.appendChild(dur);
          li.appendChild(bodyDiv);
          li.appendChild(makeSessionEditControls(viewedDate, r.idx, "clockOut"));
        } else {
          bodyDiv.textContent = r.text;
          li.appendChild(bodyDiv);
          var del = document.createElement("button");
          del.className = "del";
          del.title = "Delete note";
          del.textContent = "\u2715";
          del.onclick = function () { doDeleteNote(viewedDate, r.idx); };
          li.appendChild(del);
        }
        list.appendChild(li);
      });
    }
  }

  function makeSessionEditControls(dateStr, idx, field) {
    var wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "2px";

    var editLink = document.createElement("button");
    editLink.className = "edit-link";
    editLink.textContent = "edit";
    var delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.title = "Delete this punch";
    delBtn.textContent = "\u2715";
    delBtn.onclick = function () { doDeleteSession(dateStr, idx); };

    editLink.onclick = function () {
      var data = getDayData(dateStr);
      var sess = data.sessions[idx];
      var currentIso = sess[field];
      var input = document.createElement("input");
      input.type = "time";
      input.value = currentIso ? new Date(currentIso).toTimeString().slice(0, 5) : "";
      var saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.onclick = function () { doEditSession(dateStr, idx, field, input.value); };
      var row = wrap.parentElement;
      var box = document.createElement("div");
      box.className = "edit-inline";
      box.appendChild(input);
      box.appendChild(saveBtn);
      row.appendChild(box);
      editLink.disabled = true;
    };

    wrap.appendChild(editLink);
    wrap.appendChild(delBtn);
    return wrap;
  }

  function renderHistoryList(entries) {
    var listEl = document.getElementById("historyList");
    listEl.innerHTML = "";
    if (entries.length === 0) {
      listEl.innerHTML = '<div class="log-empty">No past days logged yet.</div>';
      return;
    }
    entries.forEach(function (e) {
      var row = document.createElement("div");
      row.className = "history-row" + (e.id === viewedDate ? " active" : "");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px dashed var(--line)";
      var left = document.createElement("span");
      left.style.fontFamily = "'Barlow Condensed', sans-serif";
      left.style.fontWeight = "600";
      left.textContent = fmtHeaderDate(e.id);
      var right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "10px";
      right.style.alignItems = "center";
      var total = document.createElement("span");
      total.style.fontFamily = "'Space Mono', monospace";
      total.style.color = "var(--ink-soft)";
      total.textContent = fmtDuration(totalMinutesFor(e.data));
      var viewBtn = document.createElement("button");
      viewBtn.className = "btn secondary";
      viewBtn.style.padding = "4px 10px";
      viewBtn.style.fontSize = "14px";
      viewBtn.textContent = "View";
      viewBtn.onclick = function () { switchToDate(e.id); };
      right.appendChild(total);
      right.appendChild(viewBtn);
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });
  }

  function switchToDate(dateStr) {
    viewedDate = dateStr;
    subscribeToDay(dateStr);
    renderViewed();
  }

  function subscribeToDay(dateStr) {
    if (unsubViewed) { unsubViewed(); unsubViewed = null; }
    unsubViewed = entryRef(dateStr).onSnapshot(function (snap) {
      var data = snap.exists ? snap.data() : emptyDay();
      docCache[dateStr] = { sessions: data.sessions || [], notes: data.notes || [] };
      if (dateStr === viewedDate) renderViewed();
    }, function (err) { console.error("entry snapshot error", err); });
  }

  function subscribeHistory() {
    var since = localDateStr(new Date(Date.now() - 60 * 24 * 3600 * 1000));
    unsubHistory = db.collection("entries")
      .where("uid", "==", currentUser.uid)
      .where("date", ">=", since)
      .orderBy("date", "desc")
      .limit(60)
      .onSnapshot(function (snap) {
        var entries = [];
        snap.docs.forEach(function (d) {
          var data = d.data();
          docCache[data.date] = { sessions: data.sessions || [], notes: data.notes || [] };
          if (data.date !== todayStr) entries.push({ id: data.date, data: docCache[data.date] });
        });
        renderHistoryList(entries);
      }, function (err) { console.error("history snapshot error", err); });
  }

  function exportPdf() {
    exportDayPdf(currentProfile.name, viewedDate, getDayData(viewedDate));
  }

  function exportCsv() {
    exportDayCsv(currentProfile.name, viewedDate, getDayData(viewedDate));
  }

  function subscribeArchives() {
    unsubArchives = db.collection("archives").where("uid", "==", currentUser.uid).onSnapshot(function (snap) {
      var docs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderArchiveGroups(document.getElementById("archivesList"), docs, false);
    }, function (err) { console.error("archives snapshot error", err); });
  }

  function wireHandlers() {
    document.getElementById("punchBtn").onclick = function () {
      currentOpenSession(getDayData(todayStr)) ? doClockOut() : doClockIn();
    };
    document.getElementById("noteAddBtn").onclick = function () {
      var input = document.getElementById("noteInput");
      doAddNote(input.value);
      input.value = "";
    };
    document.getElementById("noteInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") document.getElementById("noteAddBtn").click();
    });
    document.getElementById("exportBtn").onclick = exportPdf;
    document.getElementById("exportCsvBtn").onclick = exportCsv;
    document.getElementById("backToToday").onclick = function () { switchToDate(todayStr); };
    document.getElementById("signOutBtn").onclick = function () { signOutUser(); };
  }

  function showApp(user, profile) {
    currentUser = user;
    currentProfile = profile;
    document.getElementById("authScreen").style.display = "none";
    document.getElementById("appScreen").style.display = "block";
    document.getElementById("welcomeName").textContent = profile.name;
    document.getElementById("adminLink").style.display = profile.role === "admin" ? "inline" : "none";
    document.getElementById("headerDate").textContent = fmtHeaderDate(todayStr);
    subscribeToDay(todayStr);
    subscribeHistory();
    subscribeArchives();
  }

  function showAuth() {
    currentUser = null;
    currentProfile = null;
    if (unsubViewed) { unsubViewed(); unsubViewed = null; }
    if (unsubHistory) { unsubHistory(); unsubHistory = null; }
    if (unsubArchives) { unsubArchives(); unsubArchives = null; }
    docCache = {};
    document.getElementById("authScreen").style.display = "block";
    document.getElementById("appScreen").style.display = "none";
  }

  window.addEventListener("DOMContentLoaded", function () {
    wireHandlers();
    setInterval(tickClock, 1000);
    tickClock();
    onAuthReady(function (user, profile) {
      if (user) showApp(user, profile); else showAuth();
    });
  });
})();
