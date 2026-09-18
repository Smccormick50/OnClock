(function () {
  "use strict";

  var currentUser = null;
  var currentProfile = null;
  var todayStr = localDateStr(new Date());
  var viewedDate = todayStr;
  var docCache = {}; // dateStr -> {sessions, notes, completedTodos}
  var unsubViewed = null;
  var unsubHistory = null;
  var unsubArchives = null;
  var unsubTodos = null;
  var todoItems = []; // the running, not-date-scoped to-do list
  var unsubMileage = null;
  var mileageTrips = []; // pending, not-yet-exported mileage trips
  var editingTripIndex = null;

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
      notes: data.notes,
      completedTodos: data.completedTodos || []
    });
  }

  // ---------- to-do list (separate doc, not tied to a date) ----------
  function todosRef() {
    return db.collection("todos").doc(currentUser.uid);
  }
  function subscribeTodos() {
    unsubTodos = todosRef().onSnapshot(function (snap) {
      todoItems = (snap.exists && snap.data().items) || [];
      renderTodos();
    }, function (err) { console.error("todos snapshot error", err); });
  }
  function saveTodos(items) {
    return todosRef().set({ items: items });
  }
  function doAddTodo(text) {
    text = text.trim();
    if (!text) return;
    var items = clone(todoItems);
    items.push({ text: text, createdAt: new Date().toISOString() });
    saveTodos(items);
  }
  function doDeleteTodo(idx) {
    var items = clone(todoItems);
    items.splice(idx, 1);
    saveTodos(items);
  }
  function doEditTodo(idx, newText) {
    newText = newText.trim();
    if (!newText) return;
    var items = clone(todoItems);
    var item = items[idx];
    if (!item) return;
    item.text = newText;
    saveTodos(items);
  }
  function doCompleteTodo(idx) {
    var items = clone(todoItems);
    var item = items[idx];
    if (!item) return;
    items.splice(idx, 1);
    saveTodos(items);

    // Log the completion, timestamped, into today's log.
    var data = clone(getDayData(todayStr));
    data.completedTodos = data.completedTodos || [];
    data.completedTodos.push({ text: item.text, completedAt: new Date().toISOString() });
    saveDay(todayStr, data);
  }
  function doDeleteCompletedTodo(dateStr, idx) {
    var data = clone(getDayData(dateStr));
    (data.completedTodos || []).splice(idx, 1);
    saveDay(dateStr, data);
  }
  function doEditCompletedTodo(dateStr, idx, newText, timeVal) {
    var data = clone(getDayData(dateStr));
    var ct = (data.completedTodos || [])[idx];
    if (!ct) return;
    newText = newText.trim();
    if (newText) ct.text = newText;
    if (timeVal) ct.completedAt = fromTimeInputValue(dateStr, timeVal);
    saveDay(dateStr, data);
  }

  function renderTodos() {
    var listEl = document.getElementById("todoList");
    listEl.innerHTML = "";
    if (todoItems.length === 0) {
      listEl.innerHTML = '<li class="log-empty">Nothing on your list.</li>';
      return;
    }
    todoItems.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.className = "todo-row";

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = false;
      checkbox.onchange = function () { doCompleteTodo(idx); };

      var textSpan = document.createElement("span");
      textSpan.className = "todo-text";
      textSpan.textContent = item.text;

      var editLink = document.createElement("button");
      editLink.className = "edit-link";
      editLink.textContent = "edit";
      editLink.onclick = function () {
        var input = document.createElement("input");
        input.type = "text";
        input.value = item.text;
        input.style.flex = "1";
        input.style.minWidth = "140px";
        input.style.fontFamily = "'Source Sans 3', sans-serif";
        input.style.fontSize = "16px";
        input.style.padding = "3px 6px";
        input.style.border = "1px solid var(--line)";
        input.style.borderRadius = "4px";
        input.style.background = "var(--paper)";
        input.style.color = "var(--ink)";
        var saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        var box = document.createElement("div");
        saveBtn.onclick = function () {
          doEditTodo(idx, input.value);
          textSpan.textContent = input.value.trim() || item.text;
          li.replaceChild(textSpan, box);
          editLink.disabled = false;
        };
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") saveBtn.click();
        });
        box.className = "edit-inline";
        box.style.flex = "1";
        box.appendChild(input);
        box.appendChild(saveBtn);
        li.replaceChild(box, textSpan);
        editLink.disabled = true;
      };

      var del = document.createElement("button");
      del.className = "del";
      del.title = "Remove without completing";
      del.textContent = "\u2715";
      del.onclick = function () { doDeleteTodo(idx); };

      li.appendChild(checkbox);
      li.appendChild(textSpan);
      li.appendChild(editLink);
      li.appendChild(del);
      listEl.appendChild(li);
    });
  }

  // ---------- mileage log (separate doc, not tied to a date) ----------
  function mileageRef() {
    return db.collection("mileage").doc(currentUser.uid);
  }
  function subscribeMileage() {
    unsubMileage = mileageRef().onSnapshot(function (snap) {
      mileageTrips = (snap.exists && snap.data().trips) || [];
      renderMileage();
    }, function (err) { console.error("mileage snapshot error", err); });
  }
  function saveMileageTrips(trips) {
    return mileageRef().set({ trips: trips });
  }

  function tripIsComplete(t) {
    return t && t.endOdometer !== "" && t.endOdometer !== null && typeof t.endOdometer !== "undefined";
  }

  function tripMiles(t) {
    if (!tripIsComplete(t)) return 0;
    return Math.max(0, (Number(t.endOdometer) || 0) - (Number(t.beginOdometer) || 0));
  }
  function tripAmount(t) {
    return tripMiles(t) * 0.73;
  }

  function saveEmployeeInfo(field, value) {
    var update = {};
    update[field] = value;
    db.collection("users").doc(currentUser.uid).update(update).then(function () {
      currentProfile[field] = value; // keep the in-memory copy in sync
    }).catch(function (err) { console.error("save employee info error", err); });
  }

  function resetTripForm() {
    document.getElementById("tripBeginDate").value = todayStr;
    document.getElementById("tripEndDate").value = "";
    document.getElementById("tripDescription").value = "";
    document.getElementById("tripBeginOdo").value = "";
    document.getElementById("tripEndOdo").value = "";
    editingTripIndex = null;
    document.getElementById("tripAddBtn").textContent = "Save Mileage";
  }

  function doAddOrUpdateTrip() {
    var trip = {
      beginDate: document.getElementById("tripBeginDate").value,
      endDate: document.getElementById("tripEndDate").value,
      description: document.getElementById("tripDescription").value.trim(),
      beginOdometer: document.getElementById("tripBeginOdo").value,
      endOdometer: document.getElementById("tripEndOdo").value
    };
    if (!trip.beginDate || !trip.description || trip.beginOdometer === "") {
      alert("Enter the start date, location, and starting mileage before saving.");
      return;
    }
    if (!Number.isFinite(Number(trip.beginOdometer)) || Number(trip.beginOdometer) < 0) {
      alert("Enter a valid starting mileage.");
      return;
    }
    // A same-day trip does not need a separate ending date. Most importantly,
    // ending mileage can stay blank until the employee finishes the day.
    trip.endDate = trip.endDate || trip.beginDate;
    if (tripIsComplete(trip) && (!Number.isFinite(Number(trip.endOdometer)) || Number(trip.endOdometer) < Number(trip.beginOdometer))) {
      alert("Ending odometer should be greater than or equal to the beginning odometer.");
      return;
    }
    var trips = clone(mileageTrips);
    if (editingTripIndex !== null) {
      trips[editingTripIndex] = trip;
    } else {
      if (trips.length >= MILEAGE_MAX_ROWS) {
        alert("This form only holds " + MILEAGE_MAX_ROWS + " trips. Export and clear the list before adding more.");
        return;
      }
      trips.push(trip);
    }
    saveMileageTrips(trips);
    resetTripForm();
  }

  function doEditTripStart(idx) {
    var t = mileageTrips[idx];
    if (!t) return;
    document.getElementById("tripBeginDate").value = t.beginDate;
    document.getElementById("tripEndDate").value = t.endDate || t.beginDate || "";
    document.getElementById("tripDescription").value = t.description;
    document.getElementById("tripBeginOdo").value = t.beginOdometer;
    document.getElementById("tripEndOdo").value = tripIsComplete(t) ? t.endOdometer : "";
    editingTripIndex = idx;
    document.getElementById("tripAddBtn").textContent = tripIsComplete(t) ? "Save Changes" : "Finish & Save";
    if (!tripIsComplete(t)) document.getElementById("tripEndOdo").focus();
    document.getElementById("tripBeginDate").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function doDeleteTrip(idx) {
    var trips = clone(mileageTrips);
    trips.splice(idx, 1);
    saveMileageTrips(trips);
    if (editingTripIndex === idx) resetTripForm();
  }

  function doClearMileage() {
    if (mileageTrips.length === 0) return;
    var completedCount = mileageTrips.filter(tripIsComplete).length;
    if (completedCount === 0) {
      alert("There are no completed trips to clear. Your in-progress trip is still saved.");
      return;
    }
    if (!confirm("Clear " + completedCount + " completed trip(s)? Any in-progress trip will stay saved.")) return;
    saveMileageTrips(mileageTrips.filter(function (t) { return !tripIsComplete(t); }));
    resetTripForm();
  }

  function doExportMileage() {
    var completedTrips = mileageTrips.filter(tripIsComplete);
    var inProgressCount = mileageTrips.length - completedTrips.length;
    if (completedTrips.length === 0) {
      alert("Finish at least one trip by entering its ending mileage before exporting.");
      return;
    }
    if (inProgressCount > 0) {
      alert(inProgressCount + " in-progress trip(s) will stay saved and will not be included in this export.");
    }
    exportMileageLog({
      name: currentProfile.name,
      employeeNumber: currentProfile.employeeNumber || "",
      deptStore: currentProfile.deptStore || ""
    }, completedTrips);
  }

  function doExportMileagePdf() {
    var completedTrips = mileageTrips.filter(tripIsComplete);
    var inProgressCount = mileageTrips.length - completedTrips.length;
    if (completedTrips.length === 0) {
      alert("Finish at least one trip by entering its ending mileage before exporting.");
      return;
    }
    if (inProgressCount > 0) {
      alert(inProgressCount + " in-progress trip(s) will stay saved and will not be included in this PDF.");
    }
    exportMileagePdf({
      name: currentProfile.name,
      employeeNumber: currentProfile.employeeNumber || "",
      deptStore: currentProfile.deptStore || ""
    }, completedTrips);
  }

  function renderMileage() {
    var listEl = document.getElementById("mileageList");
    listEl.innerHTML = "";
    var totalMiles = 0, totalAmount = 0;

    if (mileageTrips.length === 0) {
      listEl.innerHTML = '<li class="log-empty">No trips logged yet.</li>';
    } else {
      mileageTrips.forEach(function (t, idx) {
        var isComplete = tripIsComplete(t);
        var miles = tripMiles(t);
        var amount = tripAmount(t);
        totalMiles += miles;
        totalAmount += amount;

        var li = document.createElement("li");
        li.className = "mileage-trip-row";
        if (!isComplete) li.className += " in-progress";

        var main = document.createElement("div");
        main.className = "mileage-trip-main";
        var descDiv = document.createElement("div");
        descDiv.className = "trip-desc";
        descDiv.textContent = t.description;
        var metaDiv = document.createElement("div");
        metaDiv.className = "trip-meta";
        var dateRange = !t.endDate || t.beginDate === t.endDate ? fmtHeaderDate(t.beginDate) : fmtHeaderDate(t.beginDate) + " \u2192 " + fmtHeaderDate(t.endDate);
        metaDiv.textContent = isComplete
          ? dateRange + " \u2022 " + t.beginOdometer + " \u2192 " + t.endOdometer + " mi"
          : dateRange + " \u2022 Starting: " + t.beginOdometer + " mi";
        main.appendChild(descDiv);
        main.appendChild(metaDiv);

        var amountDiv = document.createElement("div");
        amountDiv.className = "mileage-trip-amount";
        amountDiv.textContent = isComplete ? miles + " mi \u2014 $" + amount.toFixed(2) : "In progress";
        if (!isComplete) amountDiv.className += " is-pending";

        var editBtn = document.createElement("button");
        editBtn.className = "edit-link";
        editBtn.textContent = isComplete ? "edit" : "finish";
        editBtn.onclick = function () { doEditTripStart(idx); };

        var delBtn = document.createElement("button");
        delBtn.className = "del";
        delBtn.title = "Delete this trip";
        delBtn.textContent = "\u2715";
        delBtn.onclick = function () { doDeleteTrip(idx); };

        li.appendChild(main);
        li.appendChild(amountDiv);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        listEl.appendChild(li);
      });
    }

    document.getElementById("mileageTotal").textContent = totalMiles + " mi \u2014 $" + totalAmount.toFixed(2);
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
  function doEditNote(dateStr, idx, newText, timeVal) {
    var data = clone(getDayData(dateStr));
    var note = data.notes[idx];
    if (!note) return;
    newText = newText.trim();
    if (newText) note.text = newText;
    if (timeVal) note.time = fromTimeInputValue(dateStr, timeVal);
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
    (data.completedTodos || []).forEach(function (ct, idx) {
      rows.push({ t: ct.completedAt, type: "todo", idx: idx, text: ct.text });
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
        } else if (r.type === "todo") {
          bodyDiv.classList.add("todo-done");
          bodyDiv.textContent = "\u2713 " + r.text;
          li.appendChild(bodyDiv);
          li.appendChild(makeTodoEditControls(viewedDate, r.idx, r.text, r.t));
        } else {
          bodyDiv.textContent = r.text;
          li.appendChild(bodyDiv);
          li.appendChild(makeNoteEditControls(viewedDate, r.idx, r.text, r.t));
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
      var box = document.createElement("div");
      saveBtn.onclick = function () {
        doEditSession(dateStr, idx, field, input.value);
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

  function makeNoteEditControls(dateStr, idx, currentText, currentTimeIso) {
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
    delBtn.onclick = function () { doDeleteNote(dateStr, idx); };

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
        doEditNote(dateStr, idx, input.value, timeInput.value);
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

  // Lets you correct a completed to-do's text and/or the time it was
  // completed, in one inline editor — same pattern as note editing.
  function makeTodoEditControls(dateStr, idx, currentText, currentTimeIso) {
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
    delBtn.onclick = function () { doDeleteCompletedTodo(dateStr, idx); };

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
        doEditCompletedTodo(dateStr, idx, textInput.value, timeInput.value);
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
      row.style.flexWrap = "wrap";
      row.style.gap = "6px";
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
      right.style.flexWrap = "wrap";
      var total = document.createElement("span");
      total.style.fontFamily = "'Space Mono', monospace";
      total.style.color = "var(--ink-soft)";
      total.textContent = fmtDuration(totalMinutesFor(e.data));
      var viewBtn = document.createElement("button");
      viewBtn.className = "btn secondary";
      viewBtn.style.padding = "4px 10px";
      viewBtn.style.fontSize = "14px";
      var isActive = e.id === viewedDate;
      viewBtn.textContent = isActive ? "Close" : "View";
      viewBtn.onclick = function () { switchToDate(isActive ? todayStr : e.id); };
      right.appendChild(total);
      right.appendChild(viewBtn);

      var archived = archivesByDate[e.id];
      if (archived) {
        var pdfBtn = document.createElement("button");
        pdfBtn.className = "btn secondary";
        pdfBtn.style.padding = "4px 10px";
        pdfBtn.style.fontSize = "14px";
        pdfBtn.title = "The saved PDF snapshot from 11:59pm that night";
        pdfBtn.textContent = "PDF";
        pdfBtn.onclick = function () {
          exportDayPdf(archived.name, archived.date, {
            sessions: archived.sessions || [],
            notes: archived.notes || [],
            completedTodos: archived.completedTodos || []
          });
        };
        right.appendChild(pdfBtn);
      }
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });
  }

  function switchToDate(dateStr) {
    viewedDate = dateStr;
    subscribeToDay(dateStr);
    renderViewed();
    renderHistoryList(lastHistoryEntries);
    document.getElementById("logTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  var lastHistoryEntries = [];

  function subscribeToDay(dateStr) {
    if (unsubViewed) { unsubViewed(); unsubViewed = null; }
    unsubViewed = entryRef(dateStr).onSnapshot(function (snap) {
      var data = snap.exists ? snap.data() : emptyDay();
      docCache[dateStr] = { sessions: data.sessions || [], notes: data.notes || [], completedTodos: data.completedTodos || [] };
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
          docCache[data.date] = { sessions: data.sessions || [], notes: data.notes || [], completedTodos: data.completedTodos || [] };
          if (data.date !== todayStr) entries.push({ id: data.date, data: docCache[data.date] });
        });
        lastHistoryEntries = entries;
        renderHistoryList(entries);
      }, function (err) { console.error("history snapshot error", err); });
  }

  function exportPdf() {
    var pending = viewedDate === todayStr ? todoItems : null;
    exportDayPdf(currentProfile.name, viewedDate, getDayData(viewedDate), pending);
  }

  function exportCsv() {
    var pending = viewedDate === todayStr ? todoItems : null;
    exportDayCsv(currentProfile.name, viewedDate, getDayData(viewedDate), pending);
  }

  var archivesByDate = {};

  function subscribeArchives() {
    unsubArchives = db.collection("archives").where("uid", "==", currentUser.uid).onSnapshot(function (snap) {
      archivesByDate = {};
      snap.docs.forEach(function (d) {
        var data = d.data();
        archivesByDate[data.date] = data;
      });
      renderHistoryList(lastHistoryEntries);
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
    document.getElementById("todoAddBtn").onclick = function () {
      var input = document.getElementById("todoInput");
      doAddTodo(input.value);
      input.value = "";
    };
    document.getElementById("todoInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") document.getElementById("todoAddBtn").click();
    });
    document.getElementById("todoExportPdfBtn").onclick = function () {
      exportTodoListPdf(currentProfile.name, todoItems);
    };
    document.getElementById("todoExportCsvBtn").onclick = function () {
      exportTodoListCsv(currentProfile.name, todoItems);
    };
    document.getElementById("mileageEmpNum").addEventListener("change", function (e) {
      saveEmployeeInfo("employeeNumber", e.target.value.trim());
    });
    document.getElementById("mileageDeptStore").addEventListener("change", function (e) {
      saveEmployeeInfo("deptStore", e.target.value.trim());
    });
    var endDateInput = document.getElementById("tripEndDate");
    var endOdoInput = document.getElementById("tripEndOdo");
    endDateInput.removeAttribute("required");
    endOdoInput.removeAttribute("required");
    endOdoInput.placeholder = "Enter at end of day";
    document.getElementById("tripAddBtn").onclick = doAddOrUpdateTrip;
    var mileageExcelBtn = document.getElementById("mileageExportBtn");
    mileageExcelBtn.onclick = doExportMileage;
    var mileagePdfBtn = document.getElementById("mileageExportPdfBtn");
    if (!mileagePdfBtn) {
      mileagePdfBtn = document.createElement("button");
      mileagePdfBtn.type = "button";
      mileagePdfBtn.id = "mileageExportPdfBtn";
      mileagePdfBtn.className = mileageExcelBtn.className;
      mileagePdfBtn.textContent = "Export Mileage Log (PDF)";
      mileagePdfBtn.title = "Download the completed mileage reimbursement form as a PDF";
      mileageExcelBtn.insertAdjacentElement("afterend", mileagePdfBtn);
    }
    mileagePdfBtn.onclick = doExportMileagePdf;
    document.getElementById("mileageClearBtn").onclick = doClearMileage;
    document.getElementById("mileageClearBtn").textContent = "Clear Completed";
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
    document.getElementById("mileageEmpNum").value = profile.employeeNumber || "";
    document.getElementById("mileageDeptStore").value = profile.deptStore || "";
    resetTripForm();
    subscribeToDay(todayStr);
    subscribeHistory();
    subscribeArchives();
    subscribeTodos();
    subscribeMileage();
  }

  function showAuth() {
    currentUser = null;
    currentProfile = null;
    if (unsubViewed) { unsubViewed(); unsubViewed = null; }
    if (unsubHistory) { unsubHistory(); unsubHistory = null; }
    if (unsubArchives) { unsubArchives(); unsubArchives = null; }
    if (unsubTodos) { unsubTodos(); unsubTodos = null; }
    if (unsubMileage) { unsubMileage(); unsubMileage = null; }
    docCache = {};
    todoItems = [];
    mileageTrips = [];
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
