// Timezone helpers built on Intl so no date library is needed.

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(\d{2}):(\d{2})$/;

export function parseDate(value) {
  const match = datePattern.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function parseTime(value) {
  const match = timePattern.exec(String(value || ""));
  if (!match) return null;
  const [, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);
  const field = {};
  for (const part of parts) field[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(field.year),
    Number(field.month) - 1,
    Number(field.day),
    Number(field.hour),
    Number(field.minute),
    Number(field.second)
  );
  return asUtc - instant.getTime();
}

// Turns a wall-clock time in `timeZone` into the matching UTC instant,
// correcting once for daylight-saving transitions.
export function zonedToUtc({ year, month, day }, minutesOfDay, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day) + minutesOfDay * 60_000;
  const firstOffset = zoneOffsetMs(new Date(wallClock), timeZone);
  const firstGuess = wallClock - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(secondOffset === firstOffset ? firstGuess : wallClock - secondOffset);
}

export function todayInZone(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
  return parseDate(parts);
}

export function formatDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatMinutes(minutesOfDay) {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addDays(date, days) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function compareDates(left, right) {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}
