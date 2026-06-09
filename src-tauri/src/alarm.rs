use chrono::{DateTime, Datelike, Duration, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};

pub const REMIND_OPTIONS: [u32; 4] = [5, 10, 15, 30];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "days")]
pub enum Recurrence {
    Once,
    Daily,
    Weekdays,
    Weekly(Vec<u8>),
}

impl Recurrence {
    pub fn label(&self) -> &'static str {
        match self {
            Recurrence::Once => "Once",
            Recurrence::Daily => "Daily",
            Recurrence::Weekdays => "Weekdays",
            Recurrence::Weekly(_) => "Weekly",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderFire {
    pub year: i32,
    pub ordinal: u32,
    pub minutes_before: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alarm {
    pub id: String,
    pub label: String,
    pub hour: u8,
    pub minute: u8,
    pub enabled: bool,
    pub recurrence: Recurrence,
    #[serde(default)]
    pub remind_before: Vec<u32>,
    pub created_at: DateTime<Local>,
    pub last_fired_at: Option<DateTime<Local>>,
    #[serde(default)]
    pub last_reminder_fires: Vec<ReminderFire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnoozeState {
    pub alarm_id: String,
    pub label: String,
    pub until: DateTime<Local>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlarmRequest {
    pub label: String,
    pub hour: u8,
    pub minute: u8,
    pub recurrence: Recurrence,
    #[serde(default)]
    pub remind_before: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAlarmRequest {
    pub id: String,
    pub label: String,
    pub hour: u8,
    pub minute: u8,
    pub recurrence: Recurrence,
    pub enabled: bool,
    #[serde(default)]
    pub remind_before: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveRing {
    pub alarm_id: String,
    pub label: String,
}

impl Alarm {
    pub fn matches_time(&self, now: DateTime<Local>) -> bool {
        now.hour() as u8 == self.hour && now.minute() as u8 == self.minute
    }

    pub fn already_fired_this_minute(&self, now: DateTime<Local>) -> bool {
        self.last_fired_at.is_some_and(|last| {
            last.year() == now.year()
                && last.ordinal() == now.ordinal()
                && last.hour() == now.hour()
                && last.minute() == now.minute()
        })
    }

    pub fn matches_recurrence(&self, now: DateTime<Local>) -> bool {
        match &self.recurrence {
            Recurrence::Once => self.last_fired_at.is_none(),
            Recurrence::Daily => true,
            Recurrence::Weekdays => matches!(
                now.weekday(),
                Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu | Weekday::Fri
            ),
            Recurrence::Weekly(days) => {
                let day = now.weekday().number_from_monday() as u8 - 1;
                days.contains(&day)
            }
        }
    }

    pub fn is_due(&self, now: DateTime<Local>) -> bool {
        self.enabled
            && self.matches_time(now)
            && !self.already_fired_this_minute(now)
            && self.matches_recurrence(now)
    }

    pub fn already_reminded(&self, minutes_before: u32, now: DateTime<Local>) -> bool {
        self.last_reminder_fires.iter().any(|r| {
            r.year == now.year()
                && r.ordinal == now.ordinal()
                && r.minutes_before == minutes_before
        })
    }

    pub fn is_reminder_due(&self, now: DateTime<Local>, minutes_before: u32) -> bool {
        if !self.enabled || !self.remind_before.contains(&minutes_before) {
            return false;
        }

        let alarm_occurrence = now + Duration::minutes(minutes_before as i64);
        if alarm_occurrence.hour() as u8 != self.hour || alarm_occurrence.minute() as u8 != self.minute
        {
            return false;
        }

        !self.already_reminded(minutes_before, now) && self.matches_recurrence(alarm_occurrence)
    }
}

pub fn normalize_remind_before(mut minutes: Vec<u32>) -> Vec<u32> {
    minutes.retain(|m| REMIND_OPTIONS.contains(m));
    minutes.sort_unstable();
    minutes.dedup();
    minutes
}
