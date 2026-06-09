function tauriInvoke(cmd, args) {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) throw new Error("Tauri API not available");
  return tauri.core.invoke(cmd, args);
}

function tauriListen(event, handler) {
  const tauri = window.__TAURI__;
  if (!tauri?.event?.listen) return Promise.resolve(() => {});
  return tauri.event.listen(event, handler);
}

const alarmListEl = document.getElementById("alarm-list");
const calendarGridEl = document.getElementById("calendar-grid");
const periodLabelEl = document.getElementById("period-label");
const monthViewEl = document.getElementById("month-view");
const weekViewEl = document.getElementById("week-view");
const weekHeaderEl = document.getElementById("week-header");
const weekColumnsEl = document.getElementById("week-columns");
const timeGutterEl = document.getElementById("time-gutter");
const weekScrollEl = document.getElementById("week-scroll");
const nowIndicatorEl = document.getElementById("now-indicator");
const viewSelectEl = document.getElementById("view-select");
const editorBackdropEl = document.getElementById("editor-backdrop");
const editorTitleEl = document.getElementById("editor-title");
const formEl = document.getElementById("alarm-form");
const addBtn = document.getElementById("add-btn");
const cancelBtn = document.getElementById("cancel-btn");
const closeEditorBtn = document.getElementById("close-editor");
const recurrenceEl = document.getElementById("alarm-recurrence");
const weeklyDaysEl = document.getElementById("weekly-days");
const onceDateFieldEl = document.getElementById("once-date-field");
const enabledFieldEl = document.getElementById("enabled-field");
const prevPeriodBtn = document.getElementById("prev-period");
const nextPeriodBtn = document.getElementById("next-period");
const todayBtn = document.getElementById("today-btn");
const secondaryTzEl = document.getElementById("secondary-tz");

const TZ_STORAGE_KEY = "secondaryTimezone";
const PRIMARY_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const HOUR_HEIGHT = 48;
const HOURS = 24;
const GRID_HEIGHT = HOUR_HEIGHT * HOURS;
const EVENT_HEIGHT = 22;

let calendarView = "month";
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let viewWeekStart = startOfWeek(new Date());
let alarmsCache = [];
let secondaryTz = localStorage.getItem(TZ_STORAGE_KEY) || "America/Los_Angeles";

function tzAbbreviation(timeZone, instant = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value || timeZone.split("/").pop();
}

function hourInstant(dateStr, hour) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

function formatHourInTz(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: true,
  }).format(instant);
}

function formatLocalHourLabel(hour) {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function currentTimeTopPx() {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) * (HOUR_HEIGHT / 60);
}

function isTodayInViewWeek() {
  return getWeekDays(viewWeekStart).some((d) => dateToString(d) === todayString());
}

function updateNowIndicator() {
  if (!nowIndicatorEl) return;
  const todayIdx = getWeekDays(viewWeekStart).findIndex((d) => dateToString(d) === todayString());
  const show = calendarView === "week" && todayIdx >= 0;
  nowIndicatorEl.classList.toggle("hidden", !show);
  if (!show) return;

  const colPct = 100 / 7;
  nowIndicatorEl.style.top = `${currentTimeTopPx()}px`;
  nowIndicatorEl.style.left = `${todayIdx * colPct}%`;
  nowIndicatorEl.style.width = `${colPct}%`;

  const gutterDot = timeGutterEl?.querySelector(".now-gutter-dot");
  if (gutterDot) {
    gutterDot.style.top = `${currentTimeTopPx()}px`;
    gutterDot.classList.remove("hidden");
  }
}

function updateTodayNowMarker() {
  const todayCell = calendarGridEl?.querySelector(".cal-day.today .today-now-marker");
  if (!todayCell) return;
  const now = new Date();
  todayCell.textContent = `Now ${formatTime12(now.getHours(), now.getMinutes())}`;
}

let nowTimer = null;
function startNowTimer() {
  if (nowTimer) clearInterval(nowTimer);
  nowTimer = setInterval(() => {
    if (calendarView === "week") updateNowIndicator();
    else if (calendarView === "month") updateTodayNowMarker();
  }, 30000);
}

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatTime12(hour, minute) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  const m = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${h}${m} ${ampm}`;
}

function toDateString(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateString(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToString(date) {
  return toDateString(date.getFullYear(), date.getMonth(), date.getDate());
}

function todayString() {
  return dateToString(new Date());
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function remindBeforeLabel(minutes) {
  if (!minutes?.length) return "";
  return `Notify ${minutes.map((m) => `${m} min`).join(", ")} before`;
}

function recurrenceLabel(alarm) {
  const r = alarm.recurrence;
  if (r.type === "Once") return alarm.once_date ? `Once on ${alarm.once_date}` : "Once";
  if (r.type === "Daily") return "Daily";
  if (r.type === "Weekdays") return "Weekdays";
  if (r.type === "Weekly") {
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days = (r.days || []).map((d) => names[d]).filter(Boolean).join(", ");
    return days ? `Weekly (${days})` : "Weekly";
  }
  return "Alarm";
}

function mondayBasedDay(date) {
  return (date.getDay() + 6) % 7;
}

function alarmOccursOnDate(alarm, dateStr) {
  const date = parseDateString(dateStr);
  const r = alarm.recurrence;
  if (r.type === "Once") {
    if (alarm.once_date) return alarm.once_date === dateStr;
    return dateStr === todayString() && !alarm.last_fired_at;
  }
  if (r.type === "Daily") return true;
  if (r.type === "Weekdays") return mondayBasedDay(date) < 5;
  if (r.type === "Weekly") return (r.days || []).includes(mondayBasedDay(date));
  return false;
}

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function buildMonthInstances(alarms, year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDate = new Map();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateString(year, month, day);
    const instances = alarms
      .filter((a) => alarmOccursOnDate(a, dateStr))
      .map((alarm) => ({ alarm, dateStr }))
      .sort((a, b) => a.alarm.hour * 60 + a.alarm.minute - (b.alarm.hour * 60 + b.alarm.minute));
    byDate.set(dateStr, instances);
  }
  return byDate;
}

function buildWeekInstances(alarms, weekStart) {
  const byDate = new Map();
  for (const day of getWeekDays(weekStart)) {
    const dateStr = dateToString(day);
    const instances = alarms
      .filter((a) => alarmOccursOnDate(a, dateStr))
      .map((alarm) => ({ alarm, dateStr }))
      .sort((a, b) => a.alarm.hour * 60 + a.alarm.minute - (b.alarm.hour * 60 + b.alarm.minute));
    byDate.set(dateStr, instances);
  }
  return byDate;
}

function updatePeriodLabel() {
  if (calendarView === "month") {
    periodLabelEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    return;
  }
  const days = getWeekDays(viewWeekStart);
  const start = days[0];
  const end = days[6];
  if (start.getMonth() === end.getMonth()) {
    periodLabelEl.textContent = `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
  } else if (start.getFullYear() === end.getFullYear()) {
    periodLabelEl.textContent = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
  } else {
    periodLabelEl.textContent = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
}

function showEditor(mode = "create", alarm = null, presetDate = null, presetHour = null, presetMinute = null) {
  editorBackdropEl.classList.remove("hidden");
  editorTitleEl.textContent = mode === "edit" ? "Edit alarm" : "New alarm";
  document.getElementById("alarm-id").value = alarm?.id || "";
  document.getElementById("alarm-label").value = alarm?.label || "";
  document.getElementById("alarm-hour").value = alarm?.hour ?? presetHour ?? 9;
  document.getElementById("alarm-minute").value = alarm?.minute ?? presetMinute ?? 0;
  document.getElementById("alarm-enabled").checked = alarm?.enabled ?? true;
  enabledFieldEl.classList.toggle("hidden", mode !== "edit");

  const type = alarm?.recurrence?.type || "Once";
  const map = { Once: "once", Daily: "daily", Weekdays: "weekdays", Weekly: "weekly" };
  recurrenceEl.value = map[type] || "once";
  weeklyDaysEl.classList.toggle("hidden", recurrenceEl.value !== "weekly");
  updateDateFieldVisibility();

  document.getElementById("alarm-date").value = alarm?.once_date || presetDate || todayString();

  weeklyDaysEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = alarm?.recurrence?.days?.includes(Number(cb.value)) ?? false;
  });
  document.querySelectorAll('input[name="remind-before"]').forEach((cb) => {
    cb.checked = alarm?.remind_before?.includes(Number(cb.value)) ?? false;
  });
}

function hideEditor() {
  editorBackdropEl.classList.add("hidden");
  formEl.reset();
}

function updateDateFieldVisibility() {
  onceDateFieldEl.classList.toggle("hidden", recurrenceEl.value !== "once");
}

function buildRemindBefore() {
  return [...document.querySelectorAll('input[name="remind-before"]:checked')].map((cb) => Number(cb.value));
}

function buildRecurrence() {
  const value = recurrenceEl.value;
  if (value === "once") return { type: "Once" };
  if (value === "daily") return { type: "Daily" };
  if (value === "weekdays") return { type: "Weekdays" };
  const days = [...weeklyDaysEl.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => Number(cb.value));
  return { type: "Weekly", days };
}

function buildOnceDate() {
  if (recurrenceEl.value !== "once") return null;
  return document.getElementById("alarm-date").value || null;
}

async function loadAlarms() {
  try {
    alarmsCache = await tauriInvoke("list_alarms");
  } catch (err) {
    console.error("Failed to load alarms:", err);
    alarmsCache = [];
  }
  renderCalendar();
  renderAlarms(alarmsCache);
}

function renderCalendar() {
  updatePeriodLabel();
  if (calendarView === "month") {
    monthViewEl.classList.remove("hidden");
    weekViewEl.classList.add("hidden");
    renderMonthView();
  } else {
    monthViewEl.classList.add("hidden");
    weekViewEl.classList.remove("hidden");
    renderWeekView();
  }
  updateNowIndicator();
}

function renderMonthView() {
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const instancesByDate = buildMonthInstances(alarmsCache, viewYear, viewMonth);
  const today = todayString();
  const cells = [];

  for (let i = 0; i < firstDay; i++) {
    const day = daysInPrevMonth - firstDay + i + 1;
    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push(renderDayCell(day, toDateString(prevYear, prevMonth, day), true, [], today));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateString(viewYear, viewMonth, day);
    cells.push(renderDayCell(day, dateStr, false, instancesByDate.get(dateStr) || [], today));
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push(renderDayCell(i, toDateString(nextYear, nextMonth, i), true, [], today));
  }
  calendarGridEl.innerHTML = cells.join("");
}

function renderDayCell(day, dateStr, isOutside, instances, today) {
  const isToday = dateStr === today;
  const eventsHtml = instances
    .slice(0, 4)
    .map(
      ({ alarm }) => `
      <button type="button" class="cal-event ${alarm.enabled ? "" : "disabled"}"
        data-alarm-id="${alarm.id}" title="${escapeHtml(alarm.label)}">
        <span class="cal-event-time">${formatTime(alarm.hour, alarm.minute)}</span>
        <span class="cal-event-label">${escapeHtml(alarm.label)}</span>
      </button>`,
    )
    .join("");
  const more = instances.length > 4 ? `<div class="cal-more">+${instances.length - 4} more</div>` : "";
  const now = new Date();
  const nowMarker = isToday
    ? `<div class="today-now-marker"><span class="today-now-dot"></span> Now ${formatTime12(now.getHours(), now.getMinutes())}</div>`
    : "";
  return `
    <div class="cal-day ${isOutside ? "outside" : ""} ${isToday ? "today" : ""}" data-date="${dateStr}">
      <div class="cal-day-header">
        <span class="cal-day-num">${day}</span>
        <button type="button" class="cal-add-btn" data-date="${dateStr}" title="Add alarm">+</button>
      </div>
      ${nowMarker}
      <div class="cal-events">${eventsHtml}${more}</div>
    </div>`;
}

function renderWeekView() {
  const days = getWeekDays(viewWeekStart);
  const today = todayString();
  const instancesByDate = buildWeekInstances(alarmsCache, viewWeekStart);
  const refDay = days.find((d) => dateToString(d) === today) || days[0];
  const refDateStr = dateToString(refDay);
  const refInstant = hourInstant(refDateStr, 12);
  const primaryAbbr = tzAbbreviation(PRIMARY_TZ, refInstant);
  const secondaryAbbr = tzAbbreviation(secondaryTz, refInstant);

  weekHeaderEl.innerHTML = `
    <div class="week-header-gutter">
      <span class="tz-col-label" title="${PRIMARY_TZ}">${primaryAbbr}</span>
      <span class="tz-col-label" title="${secondaryTz}">${secondaryAbbr}</span>
    </div>
    ${days
      .map((day) => {
        const dateStr = dateToString(day);
        const isToday = dateStr === today;
        return `
        <div class="week-header-day ${isToday ? "today" : ""}">
          <span class="week-header-dow">${DAY_NAMES[day.getDay()]}</span>
          <span class="week-header-date ${isToday ? "today-num" : ""}">${day.getDate()}</span>
        </div>`;
      })
      .join("")}`;

  timeGutterEl.innerHTML = Array.from({ length: HOURS }, (_, h) => {
    const instant = hourInstant(refDateStr, h);
    const primaryLabel = formatLocalHourLabel(h);
    const secondaryLabel = formatHourInTz(instant, secondaryTz);
    return `
      <div class="time-label-row" style="top:${h * HOUR_HEIGHT}px">
        <span class="time-label-primary" title="${PRIMARY_TZ}">${primaryLabel}</span>
        <span class="time-label-secondary" title="${secondaryTz}">${secondaryLabel}</span>
      </div>`;
  }).join("");

  const gutterDot = timeGutterEl.querySelector(".now-gutter-dot");
  if (!gutterDot) {
    timeGutterEl.insertAdjacentHTML("beforeend", '<div class="now-gutter-dot hidden"></div>');
  }

  weekColumnsEl.innerHTML = days
    .map((day) => {
      const dateStr = dateToString(day);
      const isToday = dateStr === today;
      const instances = instancesByDate.get(dateStr) || [];

      const hourLines = Array.from({ length: HOURS }, (_, h) =>
        `<div class="hour-line" style="top:${h * HOUR_HEIGHT}px"></div>`,
      ).join("");

      const events = instances
        .map(({ alarm }) => {
          const top = (alarm.hour * 60 + alarm.minute) * (HOUR_HEIGHT / 60);
          return `
          <button type="button" class="week-event ${alarm.enabled ? "" : "disabled"}"
            data-alarm-id="${alarm.id}" style="top:${top}px;height:${EVENT_HEIGHT}px"
            title="${escapeHtml(alarm.label)} – ${formatTime(alarm.hour, alarm.minute)}">
            <span class="week-event-label">${escapeHtml(alarm.label)}</span>
            <span class="week-event-time">${formatTime12(alarm.hour, alarm.minute)}</span>
          </button>`;
        })
        .join("");

      return `
      <div class="week-col ${isToday ? "today-col" : ""}" data-date="${dateStr}">
        <div class="week-col-grid" data-date="${dateStr}" style="height:${GRID_HEIGHT}px">
          ${hourLines}
          ${events}
        </div>
      </div>`;
    })
    .join("");

  scrollWeekToCurrentTime();
  updateNowIndicator();
}

function scrollWeekToCurrentTime() {
  const today = todayString();
  const days = getWeekDays(viewWeekStart);
  const inWeek = days.some((d) => dateToString(d) === today);
  if (!inWeek) return;
  const now = new Date();
  const scrollTop = Math.max(0, (now.getHours() - 2) * HOUR_HEIGHT);
  weekScrollEl.scrollTop = scrollTop;
}

function renderAlarms(alarms) {
  if (!alarms.length) {
    alarmListEl.innerHTML = '<p class="empty">No alarms yet. Click a day or "+ Create".</p>';
    return;
  }
  const sorted = [...alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  alarmListEl.innerHTML = sorted
    .map(
      (alarm) => `
      <article class="alarm-item ${alarm.enabled ? "" : "disabled"}" data-id="${alarm.id}">
        <div class="alarm-main">
          <div class="alarm-time">${formatTime(alarm.hour, alarm.minute)}</div>
          <div class="alarm-meta">
            <div class="alarm-label">${escapeHtml(alarm.label)}</div>
            <div class="alarm-recurrence">${recurrenceLabel(alarm)}</div>
            ${alarm.remind_before?.length ? `<div class="alarm-remind">${remindBeforeLabel(alarm.remind_before)}</div>` : ""}
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
      </article>`,
    )
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function openAlarmEditor(id) {
  const alarm = alarmsCache.find((a) => a.id === id);
  if (alarm) showEditor("edit", alarm);
}

function timeFromClickY(y) {
  const minutes = Math.max(0, Math.min(24 * 60 - 1, Math.round((y / GRID_HEIGHT) * 24 * 60)));
  const snapped = Math.round(minutes / 15) * 15;
  return { hour: Math.floor(snapped / 60) % 24, minute: snapped % 60 };
}

calendarGridEl.addEventListener("click", async (event) => {
  const addBtnEl = event.target.closest(".cal-add-btn");
  if (addBtnEl) {
    showEditor("create", null, addBtnEl.dataset.date);
    return;
  }
  const eventBtn = event.target.closest(".cal-event");
  if (eventBtn) {
    await openAlarmEditor(eventBtn.dataset.alarmId);
    return;
  }
  const dayCell = event.target.closest(".cal-day:not(.outside)");
  if (dayCell && !event.target.closest(".cal-event")) {
    showEditor("create", null, dayCell.dataset.date);
  }
});

weekColumnsEl.addEventListener("click", async (event) => {
  const eventBtn = event.target.closest(".week-event");
  if (eventBtn) {
    await openAlarmEditor(eventBtn.dataset.alarmId);
    return;
  }
  const grid = event.target.closest(".week-col-grid");
  if (grid) {
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const { hour, minute } = timeFromClickY(y);
    showEditor("create", null, grid.dataset.date, hour, minute);
  }
});

alarmListEl.addEventListener("click", async (event) => {
  const item = event.target.closest(".alarm-item");
  if (!item) return;
  const id = item.dataset.id;
  if (event.target.classList.contains("delete-btn")) {
    await tauriInvoke("delete_alarm", { id });
    await loadAlarms();
    return;
  }
  if (event.target.classList.contains("edit-btn")) {
    await openAlarmEditor(id);
    return;
  }
  if (event.target.classList.contains("toggle-input")) {
    await tauriInvoke("toggle_alarm", { id });
    await loadAlarms();
  }
});

addBtn.addEventListener("click", () => showEditor("create", null, todayString()));
cancelBtn.addEventListener("click", hideEditor);
closeEditorBtn.addEventListener("click", hideEditor);
editorBackdropEl.addEventListener("click", (e) => {
  if (e.target === editorBackdropEl) hideEditor();
});

recurrenceEl.addEventListener("change", () => {
  weeklyDaysEl.classList.toggle("hidden", recurrenceEl.value !== "weekly");
  updateDateFieldVisibility();
});

viewSelectEl.addEventListener("change", () => {
  calendarView = viewSelectEl.value;
  if (calendarView === "week") {
    viewWeekStart = startOfWeek(new Date(viewYear, viewMonth, 1));
  } else {
    viewYear = viewWeekStart.getFullYear();
    viewMonth = viewWeekStart.getMonth();
  }
  renderCalendar();
});

prevPeriodBtn.addEventListener("click", () => {
  if (calendarView === "month") {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
  } else {
    viewWeekStart = addDays(viewWeekStart, -7);
  }
  renderCalendar();
});

nextPeriodBtn.addEventListener("click", () => {
  if (calendarView === "month") {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
  } else {
    viewWeekStart = addDays(viewWeekStart, 7);
  }
  renderCalendar();
});

todayBtn.addEventListener("click", () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  viewWeekStart = startOfWeek(now);
  renderCalendar();
});

secondaryTzEl.value = secondaryTz;
secondaryTzEl.addEventListener("change", () => {
  secondaryTz = secondaryTzEl.value;
  localStorage.setItem(TZ_STORAGE_KEY, secondaryTz);
  if (calendarView === "week") renderWeekView();
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("alarm-id").value;
  const label = document.getElementById("alarm-label").value.trim();
  const hour = Number(document.getElementById("alarm-hour").value);
  const minute = Number(document.getElementById("alarm-minute").value);
  const recurrence = buildRecurrence();
  const remindBefore = buildRemindBefore();
  const onceDate = buildOnceDate();

  if (recurrence.type === "Weekly" && (!recurrence.days || !recurrence.days.length)) {
    alert("Select at least one day for a weekly alarm.");
    return;
  }
  if (recurrence.type === "Once" && !onceDate) {
    alert("Select a date for a one-time alarm.");
    return;
  }

  const request = { label, hour, minute, recurrence, once_date: onceDate, remind_before: remindBefore };
  if (id) {
    await tauriInvoke("update_alarm", {
      request: { ...request, id, enabled: document.getElementById("alarm-enabled").checked },
    });
  } else {
    await tauriInvoke("create_alarm", { request });
  }
  hideEditor();
  await loadAlarms();
});

window.addEventListener("DOMContentLoaded", async () => {
  renderCalendar();
  startNowTimer();
  await loadAlarms();
  await tauriListen("alarm-fired", () => loadAlarms());
  await tauriListen("alarms-changed", () => loadAlarms());
});
