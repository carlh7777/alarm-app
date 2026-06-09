mod alarm;
mod scheduler;
mod store;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use alarm::{
    ActiveRing, Alarm, CreateAlarmRequest, UpdateAlarmRequest,
};
use chrono::Local;
use store::AlarmStore;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};

pub struct AppState {
    pub store: Mutex<AlarmStore>,
    pub active_ring: Mutex<Option<ActiveRing>>,
    pub(crate) sound_stop: Mutex<Option<Arc<AtomicBool>>>,
    pub(crate) sound_thread: Mutex<Option<JoinHandle<()>>>,
}

#[tauri::command]
fn list_alarms(state: State<'_, Arc<AppState>>) -> Result<Vec<Alarm>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
fn create_alarm(
    state: State<'_, Arc<AppState>>,
    request: CreateAlarmRequest,
) -> Result<Alarm, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.create(request)
}

#[tauri::command]
fn update_alarm(
    state: State<'_, Arc<AppState>>,
    request: UpdateAlarmRequest,
) -> Result<Alarm, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.update(request)
}

#[tauri::command]
fn delete_alarm(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete(&id)
}

#[tauri::command]
fn toggle_alarm(state: State<'_, Arc<AppState>>, id: String) -> Result<Alarm, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.toggle(&id)
}

#[tauri::command]
fn get_active_ring(state: State<'_, Arc<AppState>>) -> Result<Option<ActiveRing>, String> {
    Ok(state.get_active_ring())
}

#[tauri::command]
fn snooze_alarm(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    alarm_id: String,
    minutes: u32,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        let label = store
            .data
            .alarms
            .iter()
            .find(|a| a.id == alarm_id)
            .map(|a| a.label.clone())
            .or_else(|| {
                state
                    .get_active_ring()
                    .filter(|r| r.alarm_id == alarm_id)
                    .map(|r| r.label)
            })
            .unwrap_or_else(|| "Alarm".to_string());

        store.set_snooze(&alarm_id, &label, minutes)?;
    }

    state.stop_sound();
    state.clear_active_ring();

    if let Some(alert) = app.get_webview_window("alert") {
        let _ = alert.hide();
    }

    Ok(())
}

#[tauri::command]
fn dismiss_alarm(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    alarm_id: String,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        store.mark_fired(&alarm_id, Local::now())?;
    }

    state.stop_sound();
    state.clear_active_ring();

    if let Some(alert) = app.get_webview_window("alert") {
        let _ = alert.hide();
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("alarms-changed", ());
    }

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .ok_or("missing default window icon")?
        .clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Alarm App")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let store = AlarmStore::load(data_dir.join("alarms.json"));

            let state = Arc::new(AppState {
                store: Mutex::new(store),
                active_ring: Mutex::new(None),
                sound_stop: Mutex::new(None),
                sound_thread: Mutex::new(None),
            });

            app.manage(state.clone());
            setup_tray(app.handle())?;
            scheduler::start_scheduler(app.handle().clone(), state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_alarms,
            create_alarm,
            update_alarm,
            delete_alarm,
            toggle_alarm,
            get_active_ring,
            snooze_alarm,
            dismiss_alarm,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                } else if window.label() == "alert" {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
