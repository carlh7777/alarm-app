const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const labelEl = document.getElementById("alert-label");
const timeEl = document.getElementById("alert-time");
const snoozeBtn = document.getElementById("snooze-btn");
const dismissBtn = document.getElementById("dismiss-btn");
const snoozeMinutesEl = document.getElementById("snooze-minutes");

let activeAlarmId = null;

function updateClock() {
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showRing(ring) {
  if (!ring) return;
  activeAlarmId = ring.alarm_id;
  labelEl.textContent = ring.label;
  updateClock();
}

async function refreshActiveRing() {
  const ring = await invoke("get_active_ring");
  showRing(ring);
}

snoozeBtn.addEventListener("click", async () => {
  if (!activeAlarmId) return;
  const minutes = Number(snoozeMinutesEl.value);
  await invoke("snooze_alarm", { alarmId: activeAlarmId, minutes });
});

dismissBtn.addEventListener("click", async () => {
  if (!activeAlarmId) return;
  await invoke("dismiss_alarm", { alarmId: activeAlarmId });
  activeAlarmId = null;
});

window.addEventListener("DOMContentLoaded", async () => {
  updateClock();
  setInterval(updateClock, 1000);
  await refreshActiveRing();
  await listen("alarm-fired", (event) => showRing(event.payload));
});
