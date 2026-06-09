use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use chrono::Local;
use rodio::source::{SineWave, Source};
use rodio::{OutputStream, Sink};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::alarm::{ActiveRing, REMIND_OPTIONS};
use crate::AppState;

pub fn start_scheduler(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Err(err) = tick(&app, &state) {
                eprintln!("scheduler tick error: {err}");
            }
        }
    });
}

fn tick(app: &AppHandle, state: &Arc<AppState>) -> Result<(), String> {
    let now = Local::now();

    if state.is_ringing() {
        return Ok(());
    }

    let due_alarm = {
        let store = state.store.lock().map_err(|e| e.to_string())?;

        if let Some(snooze) = &store.data.active_snooze {
            if now >= snooze.until {
                Some((snooze.alarm_id.clone(), snooze.label.clone()))
            } else {
                None
            }
        } else {
            store
                .data
                .alarms
                .iter()
                .find(|alarm| alarm.is_due(now))
                .map(|alarm| (alarm.id.clone(), alarm.label.clone()))
        }
    };

    if let Some((id, label)) = due_alarm {
        fire_alarm(app, state, id, label)?;
        return Ok(());
    }

    let due_reminder = {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        let snoozed_id = store
            .data
            .active_snooze
            .as_ref()
            .map(|s| s.alarm_id.clone());

        let mut found = None;
        'outer: for alarm in &store.data.alarms {
            if snoozed_id.as_ref() == Some(&alarm.id) {
                continue;
            }
            for minutes_before in REMIND_OPTIONS {
                if alarm.is_reminder_due(now, minutes_before) {
                    found = Some((
                        alarm.id.clone(),
                        alarm.label.clone(),
                        minutes_before,
                    ));
                    break 'outer;
                }
            }
        }

        if let Some((id, label, minutes_before)) = found {
            store.mark_reminder_fired(&id, minutes_before, now)?;
            Some((label, minutes_before))
        } else {
            None
        }
    };

    if let Some((label, minutes_before)) = due_reminder {
        fire_reminder(app, &label, minutes_before)?;
    }

    Ok(())
}

fn fire_reminder(app: &AppHandle, label: &str, minutes_before: u32) -> Result<(), String> {
    let body = format!("{label} in {minutes_before} minutes");
    app.notification()
        .builder()
        .title("Upcoming alarm")
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("reminder-fired", ());
    }

    Ok(())
}

fn fire_alarm(
    app: &AppHandle,
    state: &Arc<AppState>,
    alarm_id: String,
    label: String,
) -> Result<(), String> {
    state.set_active_ring(ActiveRing {
        alarm_id: alarm_id.clone(),
        label: label.clone(),
    });
    state.start_sound();

    app.notification()
        .builder()
        .title("Alarm")
        .body(&label)
        .show()
        .map_err(|e| e.to_string())?;

    let payload = ActiveRing {
        alarm_id: alarm_id.clone(),
        label: label.clone(),
    };

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("alarm-fired", &payload);
    }

    if let Some(alert) = app.get_webview_window("alert") {
        let _ = alert.emit("alarm-fired", &payload);
        let _ = alert.show();
        let _ = alert.unminimize();
        let _ = alert.set_focus();
    }

    Ok(())
}

impl AppState {
    pub fn is_ringing(&self) -> bool {
        self.active_ring
            .lock()
            .map(|ring| ring.is_some())
            .unwrap_or(false)
    }

    pub fn set_active_ring(&self, ring: ActiveRing) {
        if let Ok(mut active) = self.active_ring.lock() {
            *active = Some(ring);
        }
    }

    pub fn clear_active_ring(&self) {
        if let Ok(mut active) = self.active_ring.lock() {
            *active = None;
        }
    }

    pub fn get_active_ring(&self) -> Option<ActiveRing> {
        self.active_ring.lock().ok().and_then(|r| r.clone())
    }

    pub fn start_sound(&self) {
        self.stop_sound();

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_flag);

        let handle = thread::spawn(move || {
            let Ok((_stream, stream_handle)) = OutputStream::try_default() else {
                return;
            };

            while !stop_clone.load(Ordering::SeqCst) {
                let Ok(sink) = Sink::try_new(&stream_handle) else {
                    break;
                };

                let beep = SineWave::new(880.0)
                    .take_duration(Duration::from_millis(400))
                    .amplify(0.25)
                    .delay(Duration::from_millis(200));
                sink.append(beep);
                sink.sleep_until_end();
            }
        });

        if let Ok(mut stop) = self.sound_stop.lock() {
            *stop = Some(stop_flag);
        }
        if let Ok(mut thread) = self.sound_thread.lock() {
            *thread = Some(handle);
        }
    }

    pub fn stop_sound(&self) {
        if let Ok(mut stop) = self.sound_stop.lock() {
            if let Some(flag) = stop.take() {
                flag.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(mut thread) = self.sound_thread.lock() {
            if let Some(handle) = thread.take() {
                let _ = handle.join();
            }
        }
    }
}
