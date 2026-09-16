(function () {
  "use strict";

  var currentUser = null;
  var currentProfile = null;
  var selectedDate = localDateStr(new Date());
  var users = []; // {id, name, email, role}
  var entriesByUid = {}; // uid -> {sessions, notes}
  var openUid = null; // which employee row is expanded
  var unsubUsers = null;
  var unsubEntries = null;
  var unsubArchives = null;
  var archiveDocs = [];

  function usersCol() { return db.collection("users"); }
  function entryRefFor(uid, dateStr) { return db.collection("entries").doc(entryId(uid, dateStr)); }

  function subscribeUsers() {
    unsubUsers = usersCol().onSnapshot(function (snap) {
      users = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      users.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      render();
    }, function (err) { console.error("users snapshot error", err); });
  }

  function subscribeEntriesForDate(dateStr) {
    if (unsubEntries) { unsubEntries(); unsubEntries = null; }
    entriesByUid = {};
    unsubEntries = db.collection("entries").where("date", "==", dateStr).onSnapshot(function (snap) {
      entriesByUid = {};
      snap.docs.forEach(function (d) {
        var data = d.data();
        entriesByUid[data.uid] = { sessions: data.sessions || [], notes: data.notes || [] };
      });
      render();
    }, function (err) { console.error("entries snapshot error", err); });
  }

  function getEntry(uid) { return entriesByUid[uid] || emptyDay(); }

  // ---------- has this day already been archived? ----------
  // Used to warn admins that editing a day after it's been archived
  // won't update the saved PDF on its own — they'd need to re-run the
  // archive workflow for that date. Cached per uid+date for the
  // session so re-renders don't re-fetch on every keystroke/snapshot.
  var archivedCheckCache = {};
  function checkArchived(uid, dateStr, callback) {
    var key = entryId(uid, dateStr);
    if (key in archivedCheckCache) { callback(archivedCheckCache[key]); return; }
    db.collection("archives").doc(key).get().then(function (snap) {
      archivedCheckCache[key] = snap.exists;
      callback(snap.exists);
    }).catch(function (err) { console.error("archived check error", err); });
  }

  // ---------- archives tab ----------
  function subscribeArchives() {
    unsubArchives = db.collection("archives").onSnapshot(function (snap) {
      archiveDocs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderArchiveGroups(document.getElementById("archivesList"), archiveDocs, true);
    }, function (err) { console.error("archives snapshot error", err); });
  }

  function switchTab(tab) {
    var panels = {
      today: document.getElementById("todayTab"),
      payperiod: document.getElementById("payPeriodTab"),
      archives: document.getElementById("archivesTab")
    };
    var buttons = {
      today: document.getElementById("tabTodayBtn"),
      payperiod: document.getElementById("tabPayPeriodBtn"),
      archives: document.getElementById("tabArchivesBtn")
    };
    Object.keys(panels).forEach(function (key) {
      panels[key].style.display = key === tab ? "block" : "none";
      buttons[key].classList.toggle("active", key === tab);
    });
    if (tab === "archives" && !unsubArchives) subscribeArchives();
  }

  // ---------- pay period tab ----------
  var lastPeriodRows = null;
  var lastPeriodRange = null;

  function defaultPeriodRange() {
    // Monday through today, this week.
    var today = new Date();
    var day = today.getDay(); // 0 = Sunday
    var diffToMonday = day === 0 ? 6 : day - 1;
    var monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    return { start: localDateStr(monday), end: localDateStr(today) };
  }

  function calcPayPeriod() {
    var start = document.getElementById("periodStart").value;
    var end = document.getElementById("periodEnd").value;
    var listEl = document.getElementById("payPeriodList");
    var csvBtn = document.getElementById("periodCsvBtn");
    if (!start || !end || start > end) {
      listEl.innerHTML = '<div class="log-empty">Pick a valid start and end date.</div>';
      csvBtn.style.display = "none";
      return;
    }
    listEl.innerHTML = '<div class="log-empty">Calculating…</div>';
    db.collection("entries").where("date", ">=", start).where("date", "<=", end).get()
      .then(function (snap) {
        var dayRows = []; // {name, date, totalMinutes, notes}
        snap.docs.forEach(function (d) {
          var data = d.data();
          var mins = totalMinutesFor({ sessions: data.sessions || [] });
          var notesJoined = (data.notes || []).map(function (n) { return n.text; }).join(" / ");
          dayRows.push({ name: data.name || "Employee", date: data.date, totalMinutes: mins, notes: notesJoined });
        });
        renderPayPeriod(dayRows, start, end);
      })
      .catch(function (err) {
        console.error("pay period query error", err);
        listEl.innerHTML = '<div class="log-empty">Something went wrong loading that range.</div>';
        csvBtn.style.display = "none";
      });
  }

  function renderPayPeriod(dayRows, start, end) {
    lastPeriodRows = dayRows;
    lastPeriodRange = { start: start, end: end };
    var listEl = document.getElementById("payPeriodList");
    var csvBtn = document.getElementById("periodCsvBtn");
    listEl.innerHTML = "";

    if (dayRows.length === 0) {
      listEl.innerHTML = '<div class="log-empty">Nobody logged anything in that range.</div>';
      csvBtn.style.display = "none";
      return;
    }

    var totalsByName = {};
    dayRows.forEach(function (r) {
      totalsByName[r.name] = (totalsByName[r.name] || 0) + r.totalMinutes;
    });

    Object.keys(totalsByName).sort().forEach(function (name) {
      var row = document.createElement("div");
      row.className = "history-row";
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px dashed var(--line)";
      var left = document.createElement("span");
      left.style.fontFamily = "'Barlow Condensed', sans-serif";
      left.style.fontWeight = "600";
      left.style.fontSize = "16px";
      left.textContent = name;
      var right = document.createElement("span");
      right.style.fontFamily = "'Space Mono', monospace";
      right.textContent = fmtDuration(totalsByName[name]);
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });

    csvBtn.style.display = "inline-block";
  }

  function downloadPeriodCsv() {
    if (!lastPeriodRows || !lastPeriodRange) return;
    exportRangeCsv(lastPeriodRows, lastPeriodRange.start, lastPeriodRange.end);
  }

  // ---------- role management ----------
  function toggleRole(user) {
    var newRole = user.role === "admin" ? "employee" : "admin";
    if (user.id === currentUser.uid && newRole === "employee") {
      if (!confirm("Remove your own admin access? You'll lose access to this dashboard.")) return;
    }
    usersCol().doc(user.id).update({ role: newRole });
  }

  // ---------- editing an employee's entry (admin correction) ----------
  function saveEntry(uid, name, dateStr, data) {
    return entryRefFor(uid, dateStr).set({ uid: uid, name: name, date: dateStr, sessions: data.sessions, notes: data.notes });
  }
  function doDeleteNote(user, idx) {
    var data = clone(getEntry(user.id));
    data.notes.splice(idx, 1);
    saveEntry(user.id, user.name, selectedDate, data);
  }
  function doDeleteSession(user, idx) {
    var data = clone(getEntry(user.id));
    data.sessions.splice(idx, 1);
    saveEntry(user.id, user.name, selectedDate, data);
  }
  function doEditSession(user, idx, field, timeVal) {
    var data = clone(getEntry(user.id));
    var sess = data.sessions[idx];
    if (!sess) return;
    sess[field] = fromTimeInputValue(selectedDate, timeVal);
    saveEntry(user.id, user.name, selectedDate, data);
  }

  // ---------- rendering ----------
  function render() {
    var listEl = document.getElementById("employeeList");
    listEl.innerHTML = "";
    if (users.length === 0) {
      listEl.innerHTML = '<div class="log-empty">No employees yet.</div>';
      return;
    }
    users.forEach(function (user) {
      var data = getEntry(user.id);
      var row = document.createElement("div");
      row.className = "employee-row";
      row.onclick = function (e) {
        if (e.target.closest("button")) return;
        openUid = openUid === user.id ? null : user.id;
        render();
      };

      var left = document.createElement("div");
      var nameLine = document.createElement("div");
      nameLine.className = "ename";
      nameLine.textContent = user.name;
      if (user.role === "admin") {
        var tag = document.createElement("span");
        tag.className = "role-tag";
        tag.textContent = "Admin";
        nameLine.appendChild(tag);
      }
      var emailLine = document.createElement("div");
      emailLine.className = "eemail";
      emailLine.textContent = user.email || "";
      left.appendChild(nameLine);
      left.appendChild(emailLine);

      var right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "12px";
      var total = document.createElement("span");
      total.className = "etotal";
      total.textContent = fmtDuration(totalMinutesFor(data));
      var roleBtn = document.createElement("button");
      roleBtn.className = "btn secondary";
      roleBtn.style.padding = "5px 10px";
      roleBtn.style.fontSize = "13px";
      roleBtn.textContent = user.role === "admin" ? "Remove admin" : "Make admin";
      roleBtn.onclick = function () { toggleRole(user); };
      right.appendChild(total);
      right.appendChild(roleBtn);

      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);

      var detail = document.createElement("div");
      detail.className = "detail-panel" + (openUid === user.id ? " open" : "");
      if (openUid === user.id) {
        detail.appendChild(renderDetail(user, data));
      }
      listEl.appendChild(detail);
    });
  }

  function renderDetail(user, data) {
    var container = document.createElement("div");

    var archivedNote = document.createElement("div");
    archivedNote.className = "archived-note";
    archivedNote.style.display = "none";
    container.appendChild(archivedNote);
    checkArchived(user.id, selectedDate, function (isArchived) {
      if (isArchived) {
        archivedNote.style.display = "block";
        archivedNote.textContent = "This day was already archived. Changes made here won't update the saved PDF — re-run \"Archive daily logs\" for " + selectedDate + " from the GitHub Actions tab (with that date entered) to refresh it.";
      }
    });

    var rows = [];
    (data.sessions || []).forEach(function (s, idx) {
      rows.push({ t: s.clockIn, type: "in", idx: idx, sess: s });
      if (s.clockOut) rows.push({ t: s.clockOut, type: "out", idx: idx, sess: s });
    });
    (data.notes || []).forEach(function (n, idx) {
      rows.push({ t: n.time, type: "note", idx: idx, text: n.text });
    });
    rows.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });

    var list = document.createElement("ul");
    list.className = "log-list";
    if (rows.length === 0) {
      list.innerHTML = '<li class="log-empty">No entries for this day.</li>';
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
          li.appendChild(makeSessionEditControls(user, r.idx, "clockIn"));
        } else if (r.type === "out") {
          bodyDiv.classList.add("session-out");
          var dur = document.createElement("span");
          dur.className = "dur";
          dur.textContent = "(" + fmtDuration(minutesBetween(r.sess.clockIn, r.sess.clockOut)) + ")";
          bodyDiv.textContent = "Clocked out";
          bodyDiv.appendChild(dur);
          li.appendChild(bodyDiv);
          li.appendChild(makeSessionEditControls(user, r.idx, "clockOut"));
        } else {
          bodyDiv.textContent = r.text;
          li.appendChild(bodyDiv);
          var del = document.createElement("button");
          del.className = "del";
          del.title = "Delete note";
          del.textContent = "\u2715";
          del.onclick = function () { doDeleteNote(user, r.idx); };
          li.appendChild(del);
        }
        list.appendChild(li);
      });
    }
    container.appendChild(list);

    var exportRow = document.createElement("div");
    exportRow.className = "export-row";
    var exportBtn = document.createElement("button");
    exportBtn.className = "btn secondary";
    exportBtn.textContent = "Export " + user.name + "'s day as PDF";
    exportBtn.onclick = function () { exportDayPdf(user.name, selectedDate, getEntry(user.id)); };
    var exportCsvBtn = document.createElement("button");
    exportCsvBtn.className = "btn secondary";
    exportCsvBtn.textContent = "Export as CSV";
    exportCsvBtn.onclick = function () { exportDayCsv(user.name, selectedDate, getEntry(user.id)); };
    exportRow.appendChild(exportBtn);
    exportRow.appendChild(exportCsvBtn);
    container.appendChild(exportRow);

    return container;
  }

  function makeSessionEditControls(user, idx, field) {
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
    delBtn.onclick = function () { doDeleteSession(user, idx); };

    editLink.onclick = function () {
      var data = getEntry(user.id);
      var sess = data.sessions[idx];
      var currentIso = sess[field];
      var input = document.createElement("input");
      input.type = "time";
      input.value = currentIso ? new Date(currentIso).toTimeString().slice(0, 5) : "";
      var saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.onclick = function () { doEditSession(user, idx, field, input.value); };
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

  function wireHandlers() {
    var datePicker = document.getElementById("datePicker");
    datePicker.value = selectedDate;
    datePicker.onchange = function () {
      selectedDate = datePicker.value;
      openUid = null;
      subscribeEntriesForDate(selectedDate);
    };
    document.getElementById("todayBtn").onclick = function () {
      selectedDate = localDateStr(new Date());
      datePicker.value = selectedDate;
      openUid = null;
      subscribeEntriesForDate(selectedDate);
    };
    document.getElementById("signOutBtn").onclick = function () { signOutUser(); };
    document.getElementById("tabTodayBtn").onclick = function () { switchTab("today"); };
    document.getElementById("tabPayPeriodBtn").onclick = function () { switchTab("payperiod"); };
    document.getElementById("tabArchivesBtn").onclick = function () { switchTab("archives"); };

    var defaults = defaultPeriodRange();
    document.getElementById("periodStart").value = defaults.start;
    document.getElementById("periodEnd").value = defaults.end;
    document.getElementById("calcPeriodBtn").onclick = calcPayPeriod;
    document.getElementById("periodCsvBtn").onclick = downloadPeriodCsv;
  }

  function showDashboard(user, profile) {
    currentUser = user;
    currentProfile = profile;
    document.getElementById("notAdminScreen").style.display = "none";
    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("dashboardScreen").style.display = "block";
    document.getElementById("welcomeName").textContent = profile.name;
    subscribeUsers();
    subscribeEntriesForDate(selectedDate);
  }

  function showNotAdmin() {
    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("dashboardScreen").style.display = "none";
    document.getElementById("notAdminScreen").style.display = "block";
  }

  window.addEventListener("DOMContentLoaded", function () {
    wireHandlers();
    onAuthReady(function (user, profile) {
      if (!user) {
        window.location.href = "index.html";
        return;
      }
      if (profile.role !== "admin") {
        showNotAdmin();
        return;
      }
      showDashboard(user, profile);
    });
  });
})();
