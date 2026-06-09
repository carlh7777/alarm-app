const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const alarmListEl = document.getElementById("alarm-list");
const editorEl = document.getElementById("editor");
const editorTitleEl = document.getElementById("editor-title");
const formEl = document.getElementById("alarm-form");
const addBtn = document.getElementById("add-btn");
const cancelBtn = document.getElementById("cancel-btn");
const recurrenceEl = document.getElementById("alarm-recurrence");
const weeklyDaysEl = document.getElementById("weekly-days");
const enabledFieldEl = document.getElementById("enabled-field");

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function remindBeforeLabel(minutes) {
  if (!minutes || minutes.length === 0) return "";
  const parts = minutes.map((m) => `${m} min`);
  return `Notify ${parts.join(", ")} before`;
}

function recurrenceLabel(recurrence) {
  if (recurrence.type === "Once") return "Once";
  if (recurrence.type === "Daily") return "Daily";
  if (recurrence.type === "Weekdays") return "Weekdays";
  if (recurrence.type === "Weekly") {
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days = (recurrence.days || [])
      .map((d) => names[d])
      .filter(Boolean)
      .join(", ");
    return days ? `Weekly (${days})` : "Weekly";
  }
  return "Alarm";
}

function showEditor(mode = "create", alarm = null) {
  editorEl.classList.remove("hidden");
  editorTitleEl.textContent = mode === "edit" ? "Edit alarm" : "New alarm";
  document.getElementById("alarm-id").value = alarm?.id || "";
  document.getElementById("alarm-label").value = alarm?.label || "";
  document.getElementById("alarm-hour").value = alarm?.hour ?? 8;
  document.getElementById("alarm-minute").value = alarm?.minute ?? 0;
  document.getElementById("alarm-enabled").checked = alarm?.enabled ?? true;
  enabledFieldEl.classList.toggle("hidden", mode !== "edit");

  const type = alarm?.recurrence?.type || "Once";
  const map = { Once: "once", Daily: "daily", Weekdays: "weekdays", Weekly: "weekly" };
  recurrenceEl.value = map[type] || "once";
  weeklyDaysEl.classList.toggle("hidden", recurrenceEl.value !== "weekly");

  weeklyDaysEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = alarm?.recurrence?.days?.includes(Number(cb.value)) ?? false;
  });

  document.querySelectorAll('input[name="remind-before"]').forEach((cb) => {
    cb.checked = alarm?.remind_before?.includes(Number(cb.value)) ?? false;
  });
}

function hideEditor() {
  editorEl.classList.add("hidden");
  formEl.reset();
}

function buildRemindBefore() {
  return [...document.querySelectorAll('input[name="remind-before"]:checked')].map((cb) =>
    Number(cb.value),
  );
}

function buildRecurrence() {
  const value = recurrenceEl.value;
  if (value === "once") return { type: "Once" };
  if (value === "daily") return { type: "Daily" };
  if (value === "weekdays") return { type: "Weekdays" };
  const days = [...weeklyDaysEl.querySelectorAll('input[type="checkbox"]:checked')].map((cb) =>
    Number(cb.value),
  );
  return { type: "Weekly", days };
}

async function loadAlarms() {
  const alarms = await invoke("list_alarms");
  renderAlarms(alarms);
}

function renderAlarms(alarms) {
  if (!alarms.length) {
    alarmListEl.innerHTML = '<p class="empty">No alarms yet. Click "+ Add alarm" to create one.</p>';
    return;
  }

  alarmListEl.innerHTML = alarms
    .map(
      (alarm) => `
      <article class="alarm-item ${alarm.enabled ? "" : "disabled"}" data-id="${alarm.id}">
        <div class="alarm-main">
          <div class="alarm-time">${formatTime(alarm.hour, alarm.minute)}</div>
          <div class="alarm-meta">
            <div class="alarm-label">${escapeHtml(alarm.label)}</div>
            <div class="alarm-recurrence">${recurrenceLabel(alarm.recurrence)}</div>
            ${
              alarm.remind_before?.length
                ? `<div class="alarm-remind">${remindBeforeLabel(alarm.remind_before)}</div>`
                : ""
            }
          </div>
        </div>
        <div class="alarm-actions">
          <label class="toggle" title="Enable alarm">
            <input type="checkbox" class="toggle-input" ${alarm.enabled ? "checked" : ""} />
            <span class="toggle-slider"></span>
          </label>
          <button type="button" class="btn btn-small edit-btn">Edit</button>
          <button type="button" class="btn btn-small btn-danger delete-btn">Delete</button>
        </div>
      </article>
    `,
    )
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

alarmListEl.addEventListener("click", async (event) => {
  const item = event.target.closest(".alarm-item");
  if (!item) return;
  const id = item.dataset.id;

  if (event.target.classList.contains("delete-btn")) {
    await invoke("delete_alarm", { id });
    await loadAlarms();
    return;
  }

  if (event.target.classList.contains("edit-btn")) {
    const alarms = await invoke("list_alarms");
    const alarm = alarms.find((a) => a.id === id);
    if (alarm) showEditor("edit", alarm);
    return;
  }

  if (event.target.classList.contains("toggle-input")) {
    await invoke("toggle_alarm", { id });
    await loadAlarms();
  }
});

addBtn.addEventListener("click", () => showEditor("create"));
cancelBtn.addEventListener("click", hideEditor);

recurrenceEl.addEventListener("change", () => {
  weeklyDaysEl.classList.toggle("hidden", recurrenceEl.value !== "weekly");
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("alarm-id").value;
  const label = document.getElementById("alarm-label").value.trim();
  const hour = Number(document.getElementById("alarm-hour").value);
  const minute = Number(document.getElementById("alarm-minute").value);
  const recurrence = buildRecurrence();
  const remindBefore = buildRemindBefore();

  if (recurrence.type === "Weekly" && (!recurrence.days || recurrence.days.length === 0)) {
    alert("Select at least one day for a weekly alarm.");
    return;
  }

  if (id) {
    await invoke("update_alarm", {
      request: {
        id,
        label,
        hour,
        minute,
        recurrence,
        remindBefore,
        enabled: document.getElementById("alarm-enabled").checked,
      },
    });
  } else {
    await invoke("create_alarm", {
      request: { label, hour, minute, recurrence, remindBefore },
    });
  }

  hideEditor();
  await loadAlarms();
});

window.addEventListener("DOMContentLoaded", async () => {
  await loadAlarms();
  await listen("alarm-fired", () => loadAlarms());
  await listen("alarms-changed", () => loadAlarms());
});
