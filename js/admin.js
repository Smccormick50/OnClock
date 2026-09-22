(function () {
  "use strict";

  var currentUser = null;
  var currentProfile = null;
  var selectedDate = localDateStr(new Date());
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var pastSelectedDate = localDateStr(yesterday);
  var users = []; // {id, name, email, role}
  var entriesByUid = {}; // uid -> {sessions, notes}
  var pastEntriesByUid = {};
  var openUid = null; // which employee row is expanded
  var pastOpenUid = null;
  var unsubUsers = null;
  var unsubEntries = null;
  var unsubPastEntries = null;
  var unsubArchives = null;
  var archiveDocs = [];

  function usersCol() { return db.collection("users"); }
  function entryRefFor(uid, dateStr) { return db.collection("entries").doc(entryId(uid, dateStr)); }

  function subscribeUsers() {
    unsubUsers = usersCol().onSnapshot(function (snap) {
      users = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      users.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      render();
      populatePeriodEmployeeDropdown();
      populatePastEmployeeDropdown();
      renderPastDays();
    }, function (err) { console.error("users snapshot error", err); });
  }

  function populatePeriodEmployeeDropdown() {
    var select = document.getElementById("periodEmployee");
    if (!select) return;
    var previousValue = select.value;
    select.innerHTML = '<option value="">All employees</option>';
    users.forEach(function (user) {
      var opt = document.createElement("option");
      opt.value = user.id;
      opt.textContent = user.name;
      select.appendChild(opt);
    });
    // Keep whatever was selected, if that person still exists in the list.
    if (previousValue && users.some(function (u) { return u.id === previousValue; })) {
      select.value = previousValue;
    }
  }

  function populatePastEmployeeDropdown() {
    var select = document.getElementById("pastEmployee");
    if (!select) return;
    var previousValue = select.value;
    select.innerHTML = '<option value="">All employees</option>';
    users.forEach(function (user) {
      var opt = document.createElement("option");
      opt.value = user.id;
      opt.textContent = user.name;
      select.appendChild(opt);
    });
    if (previousValue && users.some(function (u) { return u.id === previousValue; })) {
      select.value = previousValue;
    }
  }

  function subscribeEntriesForDate(dateStr) {
    if (unsubEntries) { unsubEntries(); unsubEntries = null; }
    entriesByUid = {};
    unsubEntries = db.collection("entries").where("date", "==", dateStr).onSnapshot(function (snap) {
      entriesByUid = {};
      snap.docs.forEach(function (d) {
        var data = d.data();
        entriesByUid[data.uid] = { sessions: data.sessions || [], notes: data.notes || [], completedTodos: data.completedTodos || [] };
      });
      render();
    }, function (err) { console.error("entries snapshot error", err); });
  }

  function getEntry(uid) { return entriesByUid[uid] || emptyDay(); }

  function subscribePastEntriesForDate(dateStr) {
    if (unsubPastEntries) { unsubPastEntries(); unsubPastEntries = null; }
    pastEntriesByUid = {};
    pastOpenUid = null;
    var listEl = document.getElementById("pastEmployeeList");
    if (listEl) listEl.innerHTML = '<div class="log-empty">Loading…</div>';
    unsubPastEntries = db.collection("entries").where("date", "==", dateStr).onSnapshot(function (snap) {
      pastEntriesByUid = {};
      snap.docs.forEach(function (d) {
        var data = d.data();
        pastEntriesByUid[data.uid] = { sessions: data.sessions || [], notes: data.notes || [], completedTodos: data.completedTodos || [] };
      });
      renderPastDays();
    }, function (err) {
      console.error("past entries snapshot error", err);
      if (listEl) listEl.innerHTML = '<div class="log-empty">Something went wrong loading that date.</div>';
    });
  }

  function getPastEntry(uid) { return pastEntriesByUid[uid] || emptyDay(); }

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
    }, function (err) {
      console.error("archives snapshot error", err);
      var listEl = document.getElementById("archivesList");
      if (listEl) listEl.innerHTML = '<div class="log-empty">Something went wrong loading the archives.</div>';
    });
  }

  function switchTab(tab) {
    var panels = {
      today: document.getElementById("todayTab"),
      pastdays: document.getElementById("pastDaysTab"),
      payperiod: document.getElementById("payPeriodTab"),
      archives: document.getElementById("archivesTab")
    };
    var buttons = {
      today: document.getElementById("tabTodayBtn"),
      pastdays: document.getElementById("tabPastDaysBtn"),
      payperiod: document.getElementById("tabPayPeriodBtn"),
      archives: document.getElementById("tabArchivesBtn")
    };
    Object.keys(panels).forEach(function (key) {
      panels[key].style.display = key === tab ? "block" : "none";
      buttons[key].classList.toggle("active", key === tab);
    });
    if (tab === "pastdays" && !unsubPastEntries) subscribePastEntriesForDate(pastSelectedDate);
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
    var selectedUid = document.getElementById("periodEmployee").value;
    var listEl = document.getElementById("payPeriodList");
    var csvBtn = document.getElementById("periodCsvBtn");
    if (!start || !end || start > end) {
      listEl.innerHTML = '<div class="log-empty">Pick a valid start and end date.</div>';
      csvBtn.style.display = "none";
      return;
    }
    listEl.innerHTML = '<div class="log-empty">Calculating…</div>';
    // Fetched unfiltered by employee (date range only) so this never
    // needs its own composite index — narrowing to one person, if
    // requested, happens client-side just below.
    db.collection("entries").where("date", ">=", start).where("date", "<=", end).get()
      .then(function (snap) {
        var dayRows = []; // {uid, name, date, totalMinutes, notes}
        snap.docs.forEach(function (d) {
          var data = d.data();
          if (selectedUid && data.uid !== selectedUid) return;
          var mins = totalMinutesFor({ sessions: data.sessions || [] });
          var notesJoined = (data.notes || []).map(function (n) { return n.text; }).join(" / ");
          dayRows.push({ uid: data.uid, name: data.name || "Employee", date: data.date, totalMinutes: mins, notes: notesJoined });
        });
        renderPayPeriod(dayRows, start, end, selectedUid);
      })
      .catch(function (err) {
        console.error("pay period query error", err);
        listEl.innerHTML = '<div class="log-empty">Something went wrong loading that range.</div>';
        csvBtn.style.display = "none";
      });
  }

  function renderPayPeriod(dayRows, start, end, selectedUid) {
    lastPeriodRows = dayRows;
    lastPeriodRange = { start: start, end: end };
    var listEl = document.getElementById("payPeriodList");
    var csvBtn = document.getElementById("periodCsvBtn");
    listEl.innerHTML = "";

    if (dayRows.length === 0) {
      listEl.innerHTML = selectedUid
        ? '<div class="log-empty">That employee logged nothing in that range.</div>'
        : '<div class="log-empty">Nobody logged anything in that range.</div>';
      csvBtn.style.display = "none";
      return;
    }

    function addRow(left, right, bold) {
      var row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px dashed var(--line)";
      var leftEl = document.createElement("span");
      leftEl.style.fontFamily = "'Barlow Condensed', sans-serif";
      leftEl.style.fontWeight = bold ? "700" : "600";
      leftEl.style.fontSize = bold ? "17px" : "16px";
      leftEl.style.color = bold ? "var(--pine)" : "var(--ink)";
      leftEl.textContent = left;
      var rightEl = document.createElement("span");
      rightEl.style.fontFamily = "'Space Mono', monospace";
      rightEl.style.fontWeight = bold ? "700" : "400";
      rightEl.textContent = right;
      row.appendChild(leftEl);
      row.appendChild(rightEl);
      listEl.appendChild(row);
    }

    if (selectedUid) {
      // One employee selected: show a day-by-day breakdown instead of
      // a single aggregate row, since that's the more useful view
      // when you've already narrowed down to one person.
      var sorted = dayRows.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      var total = 0;
      sorted.forEach(function (r) {
        addRow(fmtHeaderDate(r.date), fmtDuration(r.totalMinutes), false);
        total += r.totalMinutes;
      });
      addRow("Total — " + sorted[0].name, fmtDuration(total), true);
    } else {
      var totalsByName = {};
      dayRows.forEach(function (r) {
        totalsByName[r.name] = (totalsByName[r.name] || 0) + r.totalMinutes;
      });
      Object.keys(totalsByName).sort().forEach(function (name) {
        addRow(name, fmtDuration(totalsByName[name]), false);
      });
    }

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
    return entryRefFor(uid, dateStr).set({ uid: uid, name: name, date: dateStr, sessions: data.sessions, notes: data.notes, completedTodos: data.completedTodos || [] });
  }
  function doDeleteNote(user, idx) {
    var data = clone(getEntry(user.id));
    data.notes.splice(idx, 1);
    saveEntry(user.id, user.name, selectedDate, data);
  }
  function doEditNote(user, idx, newText, timeVal) {
    var data = clone(getEntry(user.id));
    var note = data.notes[idx];
    if (!note) return;
    newText = newText.trim();
    if (newText) note.text = newText;
    if (timeVal) note.time = fromTimeInputValue(selectedDate, timeVal);
    saveEntry(user.id, user.name, selectedDate, data);
  }
  function doDeleteCompletedTodo(user, idx) {
    var data = clone(getEntry(user.id));
    (data.completedTodos || []).splice(idx, 1);
    saveEntry(user.id, user.name, selectedDate, data);
  }
  function doEditCompletedTodo(user, idx, newText, timeVal) {
    var data = clone(getEntry(user.id));
    var ct = (data.completedTodos || [])[idx];
    if (!ct) return;
    newText = newText.trim();
    if (newText) ct.text = newText;
    if (timeVal) ct.completedAt = fromTimeInputValue(selectedDate, timeVal);
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
        detail.appendChild(renderDetail(user, data, false, selectedDate));
      }
      listEl.appendChild(detail);
    });
  }

  function renderPastDays() {
    var listEl = document.getElementById("pastEmployeeList");
    var employeeSelect = document.getElementById("pastEmployee");
    if (!listEl || !employeeSelect) return;
    listEl.innerHTML = "";

    var selectedUid = employeeSelect.value;
    var visibleUsers = selectedUid
      ? users.filter(function (user) { return user.id === selectedUid; })
      : users;

    if (visibleUsers.length === 0) {
      listEl.innerHTML = '<div class="log-empty">No employees found.</div>';
      return;
    }

    visibleUsers.forEach(function (user) {
      var data = getPastEntry(user.id);
      var hasEntries = (data.sessions && data.sessions.length) || (data.notes && data.notes.length) || (data.completedTodos && data.completedTodos.length);
      var row = document.createElement("div");
      row.className = "employee-row";
      row.onclick = function (e) {
        if (e.target.closest("button")) return;
        pastOpenUid = pastOpenUid === user.id ? null : user.id;
        renderPastDays();
      };

      var left = document.createElement("div");
      var nameLine = document.createElement("div");
      nameLine.className = "ename";
      nameLine.textContent = user.name;
      var emailLine = document.createElement("div");
      emailLine.className = "eemail";
      emailLine.textContent = user.email || "";
      left.appendChild(nameLine);
      left.appendChild(emailLine);

      var total = document.createElement("span");
      total.className = "etotal";
      total.textContent = hasEntries ? fmtDuration(totalMinutesFor(data)) : "No entries";

      row.appendChild(left);
      row.appendChild(total);
      listEl.appendChild(row);

      var detail = document.createElement("div");
      detail.className = "detail-panel" + (pastOpenUid === user.id ? " open" : "");
      if (pastOpenUid === user.id) {
        detail.appendChild(renderDetail(user, data, true, pastSelectedDate));
      }
      listEl.appendChild(detail);
    });
  }

  function renderDetail(user, data, readOnly, dateStr) {
    var container = document.createElement("div");

    if (readOnly) {
      var readOnlyNote = document.createElement("div");
      readOnlyNote.className = "read-only-note";
      readOnlyNote.textContent = "Read only — this past log cannot be edited or deleted from Admin.";
      container.appendChild(readOnlyNote);
    } else {
      var archivedNote = document.createElement("div");
      archivedNote.className = "archived-note";
      archivedNote.style.display = "none";
      container.appendChild(archivedNote);
      checkArchived(user.id, dateStr, function (isArchived) {
        if (isArchived) {
          archivedNote.style.display = "block";
          archivedNote.textContent = "This day was already archived. Changes made here won't update the saved PDF — re-run \"Archive daily logs\" for " + dateStr + " from the GitHub Actions tab (with that date entered) to refresh it.";
        }
      });
    }

    var rows = [];
    (data.sessions || []).forEach(function (s, idx) {
      if (s.clockIn) rows.push({ t: s.clockIn, type: "in", idx: idx, sess: s });
      if (s.clockOut) rows.push({ t: s.clockOut, type: "out", idx: idx, sess: s });
    });
    (data.notes || []).forEach(function (n, idx) {
      rows.push({ t: n.time, type: "note", idx: idx, text: n.text });
    });
    (data.completedTodos || []).forEach(function (ct, idx) {
      rows.push({ t: ct.completedAt, type: "todo", idx: idx, text: ct.text });
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
          if (!readOnly) li.appendChild(makeSessionEditControls(user, r.idx, "clockIn"));
        } else if (r.type === "out") {
          bodyDiv.classList.add("session-out");
          bodyDiv.textContent = "Clocked out";
          if (r.sess.clockIn) {
            var dur = document.createElement("span");
            dur.className = "dur";
            dur.textContent = "(" + fmtDuration(minutesBetween(r.sess.clockIn, r.sess.clockOut)) + ")";
            bodyDiv.appendChild(dur);
          }
          li.appendChild(bodyDiv);
          if (!readOnly) li.appendChild(makeSessionEditControls(user, r.idx, "clockOut"));
        } else if (r.type === "todo") {
          bodyDiv.classList.add("todo-done");
          bodyDiv.textContent = "\u2713 " + r.text;
          li.appendChild(bodyDiv);
          if (!readOnly) li.appendChild(makeTodoEditControls(user, r.idx, r.text, r.t));
        } else {
          bodyDiv.textContent = r.text;
          li.appendChild(bodyDiv);
          if (!readOnly) li.appendChild(makeNoteEditControls(user, r.idx, r.text, r.t));
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
    exportBtn.onclick = function () { exportDayPdf(user.name, dateStr, data); };
    var exportCsvBtn = document.createElement("button");
    exportCsvBtn.className = "btn secondary";
    exportCsvBtn.textContent = "Export as CSV";
    exportCsvBtn.onclick = function () { exportDayCsv(user.name, dateStr, data); };
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
      var box = document.createElement("div");
      saveBtn.onclick = function () {
        doEditSession(user, idx, field, input.value);
        box.remove();
        editLink.disabled = false;
      };
      var row = wrap.parentElement;
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

  function makeNoteEditControls(user, idx, currentText, currentTimeIso) {
    var wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "2px";

    var editLink = document.createElement("button");
    editLink.className = "edit-link";
    editLink.textContent = "edit";
    var delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.title = "Delete this note";
    delBtn.textContent = "\u2715";
    delBtn.onclick = function () { doDeleteNote(user, idx); };

    editLink.onclick = function () {
      var input = document.createElement("input");
      input.type = "text";
      input.value = currentText;
      input.style.flex = "1";
      input.style.minWidth = "140px";
      input.style.fontFamily = "'Source Sans 3', sans-serif";
      input.style.fontSize = "16px";
      input.style.padding = "3px 6px";
      input.style.border = "1px solid var(--line)";
      input.style.borderRadius = "4px";
      input.style.background = "var(--paper)";
      input.style.color = "var(--ink)";

      var timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = currentTimeIso ? new Date(currentTimeIso).toTimeString().slice(0, 5) : "";

      var saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      var box = document.createElement("div");
      saveBtn.onclick = function () {
        doEditNote(user, idx, input.value, timeInput.value);
        box.remove();
        editLink.disabled = false;
      };
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") saveBtn.click();
      });
      var row = wrap.parentElement;
      box.className = "edit-inline";
      box.style.flex = "1";
      box.appendChild(input);
      box.appendChild(timeInput);
      box.appendChild(saveBtn);
      row.appendChild(box);
      editLink.disabled = true;
    };

    wrap.appendChild(editLink);
    wrap.appendChild(delBtn);
    return wrap;
  }

  // Lets an admin correct a completed to-do's text and/or the time it
  // was completed, in one inline editor.
  function makeTodoEditControls(user, idx, currentText, currentTimeIso) {
    var wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "2px";

    var editLink = document.createElement("button");
    editLink.className = "edit-link";
    editLink.textContent = "edit";
    var delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.title = "Remove this from the log";
    delBtn.textContent = "\u2715";
    delBtn.onclick = function () { doDeleteCompletedTodo(user, idx); };

    editLink.onclick = function () {
      var textInput = document.createElement("input");
      textInput.type = "text";
      textInput.value = currentText;
      textInput.style.flex = "1";
      textInput.style.minWidth = "140px";
      textInput.style.fontFamily = "'Source Sans 3', sans-serif";
      textInput.style.fontSize = "16px";
      textInput.style.padding = "3px 6px";
      textInput.style.border = "1px solid var(--line)";
      textInput.style.borderRadius = "4px";
      textInput.style.background = "var(--paper)";
      textInput.style.color = "var(--ink)";

      var timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = currentTimeIso ? new Date(currentTimeIso).toTimeString().slice(0, 5) : "";

      var saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      var box = document.createElement("div");
      saveBtn.onclick = function () {
        doEditCompletedTodo(user, idx, textInput.value, timeInput.value);
        box.remove();
        editLink.disabled = false;
      };
      textInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") saveBtn.click();
      });

      var row = wrap.parentElement;
      box.className = "edit-inline";
      box.style.flex = "1";
      box.appendChild(textInput);
      box.appendChild(timeInput);
      box.appendChild(saveBtn);
      row.appendChild(box);
      editLink.disabled = true;
    };

    wrap.appendChild(editLink);
    wrap.appendChild(delBtn);
    return wrap;
  }

  function wireHandlers() {
    document.getElementById("todayDateLabel").textContent = fmtHeaderDate(selectedDate);

    var pastDatePicker = document.getElementById("pastDatePicker");
    pastDatePicker.value = pastSelectedDate;
    pastDatePicker.max = pastSelectedDate;
    pastDatePicker.onchange = function () {
      if (!pastDatePicker.value) return;
      if (pastDatePicker.value >= localDateStr(new Date())) {
        alert("Choose a date before today. Today's logs are on the Today tab.");
        pastDatePicker.value = pastSelectedDate;
        return;
      }
      pastSelectedDate = pastDatePicker.value;
      subscribePastEntriesForDate(pastSelectedDate);
    };
    document.getElementById("pastEmployee").onchange = function () {
      pastOpenUid = null;
      renderPastDays();
    };
    document.getElementById("signOutBtn").onclick = function () { signOutUser(); };
    document.getElementById("tabTodayBtn").onclick = function () { switchTab("today"); };
    document.getElementById("tabPastDaysBtn").onclick = function () { switchTab("pastdays"); };
    document.getElementById("tabPayPeriodBtn").onclick = function () { switchTab("payperiod"); };
    document.getElementById("tabArchivesBtn").onclick = function () { switchTab("archives"); };
    document.getElementById("archiveEmployee").onchange = function () {
      renderArchiveGroups(document.getElementById("archivesList"), archiveDocs, true);
    };

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
