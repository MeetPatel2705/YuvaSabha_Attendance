const IST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hour12: false,
});

// Check-in window is [21:00, 22:00) IST, on whichever weekday is configured
// (see lib/settings.js — defaults to Saturday, but admins can reschedule).
const WINDOW_START_HOUR = 21;
const WINDOW_END_HOUR = 22;

// The "you're marked present" success screen stays up until 10:30 PM IST —
// a 30-minute grace period past the 10:00 PM submission cutoff — then
// reverts, even though the attendance record itself is permanent.
const STATUS_DISPLAY_END_HOUR = 22;
const STATUS_DISPLAY_END_MINUTE = 30;

function getIstNow(now = new Date()) {
  const parts = Object.fromEntries(IST_FORMATTER.formatToParts(now).map((p) => [p.type, p.value]));
  // hour12:false + Intl can report midnight as "24" on some ICU versions — normalize.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday, // 'Mon', 'Tue', ... 'Sat', 'Sun'
  };
}

function isCheckinDay(istNow, weekday) {
  return istNow.weekday === weekday;
}

function isWithinCheckinWindow(istNow) {
  return istNow.hour >= WINDOW_START_HOUR && istNow.hour < WINDOW_END_HOUR;
}

function isBeforeStatusDisplayCutoff(istNow) {
  return (
    istNow.hour < STATUS_DISPLAY_END_HOUR ||
    (istNow.hour === STATUS_DISPLAY_END_HOUR && istNow.minute < STATUS_DISPLAY_END_MINUTE)
  );
}

module.exports = { getIstNow, isCheckinDay, isWithinCheckinWindow, isBeforeStatusDisplayCutoff };
