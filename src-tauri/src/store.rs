use std::fs;
use std::path::PathBuf;

use chrono::{Datelike, Local};
use uuid::Uuid;

use crate::alarm::{
    normalize_remind_before, Alarm, CreateAlarmRequest, Recurrence, ReminderFire, SnoozeState,
    UpdateAlarmRequest,
};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct StoreData {
    pub alarms: Vec<Alarm>,
    pub active_snooze: Option<SnoozeState>,
}

pub struct AlarmStore {
    path: PathBuf,
    pub data: StoreData,
}

impl AlarmStore {
    pub fn load(path: PathBuf) -> Self {
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        } else {
            StoreData::default()
        };

        Self { path, data }
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(&self.data).map_err(|e| e.to_string())?;
        fs::write(&self.path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list(&self) -> Vec<Alarm> {
        self.data.alarms.clone()
    }

    pub fn create(&mut self, req: CreateAlarmRequest) -> Result<Alarm, String> {
        let alarm = Alarm {
            id: Uuid::new_v4().to_string(),
            label: req.label,
            hour: req.hour,
            minute: req.minute,
            enabled: true,
            recurrence: req.recurrence,
            remind_before: normalize_remind_before(req.remind_before),
            created_at: Local::now(),
            last_fired_at: None,
            last_reminder_fires: Vec::new(),
        };
        self.data.alarms.push(alarm.clone());
        self.save()?;
        Ok(alarm)
    }

    pub fn update(&mut self, req: UpdateAlarmRequest) -> Result<Alarm, String> {
        let alarm = self
            .data
            .alarms
            .iter_mut()
            .find(|a| a.id == req.id)
            .ok_or_else(|| "Alarm not found".to_string())?;

        alarm.label = req.label;
        alarm.hour = req.hour;
        alarm.minute = req.minute;
        alarm.recurrence = req.recurrence;
        alarm.enabled = req.enabled;
        alarm.remind_before = normalize_remind_before(req.remind_before);

        let updated = alarm.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let len_before = self.data.alarms.len();
        self.data.alarms.retain(|a| a.id != id);
        if self.data.alarms.len() == len_before {
            return Err("Alarm not found".to_string());
        }
        if self
            .data
            .active_snooze
            .as_ref()
            .is_some_and(|s| s.alarm_id == id)
        {
            self.data.active_snooze = None;
        }
        self.save()
    }

    pub fn toggle(&mut self, id: &str) -> Result<Alarm, String> {
        let alarm = self
            .data
            .alarms
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "Alarm not found".to_string())?;
        alarm.enabled = !alarm.enabled;
        let updated = alarm.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn mark_fired(&mut self, id: &str, now: chrono::DateTime<Local>) -> Result<(), String> {
        let alarm = self
            .data
            .alarms
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "Alarm not found".to_string())?;

        alarm.last_fired_at = Some(now);
        if matches!(alarm.recurrence, Recurrence::Once) {
            alarm.enabled = false;
        }
        self.data.active_snooze = None;
        self.save()
    }

    pub fn set_snooze(&mut self, alarm_id: &str, label: &str, minutes: u32) -> Result<(), String> {
        let until = Local::now() + chrono::Duration::minutes(minutes as i64);
        self.data.active_snooze = Some(SnoozeState {
            alarm_id: alarm_id.to_string(),
            label: label.to_string(),
            until,
        });
        self.save()
    }

    pub fn clear_snooze(&mut self) {
        self.data.active_snooze = None;
        let _ = self.save();
    }

    pub fn mark_reminder_fired(
        &mut self,
        id: &str,
        minutes_before: u32,
        now: chrono::DateTime<Local>,
    ) -> Result<(), String> {
        let alarm = self
            .data
            .alarms
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "Alarm not found".to_string())?;

        alarm.last_reminder_fires.retain(|r| {
            !(r.year == now.year() && r.ordinal == now.ordinal() && r.minutes_before == minutes_before)
        });
        alarm.last_reminder_fires.push(ReminderFire {
            year: now.year(),
            ordinal: now.ordinal(),
            minutes_before,
        });
        self.save()
    }
}
