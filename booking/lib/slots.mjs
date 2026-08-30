import { config } from "../config.mjs";
import { bookingsBetween } from "./store.mjs";
import { busyPeriods } from "./google-calendar.mjs";
import { formatMinutes, weekdayOf, zonedToUtc } from "./time.mjs";

// Every opening-hours range is cut into fixed-length slots; a slot that runs
// past the end of its range is dropped rather than trimmed.
function slotStartsFor(date) {
  const starts = [];
  const step = config.slotMinutes + config.bufferMinutes;
  for (const range of config.openingHours[weekdayOf(date)] || []) {
    for (let minute = range.start; minute + config.slotMinutes <= range.end; minute += step) {
      starts.push(minute);
    }
  }
  return [...new Set(starts)].sort((left, right) => left - right);
}

function overlaps(startMs, endMs, periods) {
  const paddedStart = startMs - config.bufferMinutes * 60_000;
  const paddedEnd = endMs + config.bufferMinutes * 60_000;
  return periods.some((period) => period.start < paddedEnd && period.end > paddedStart);
}

export function slotWindow(date, minutesOfDay) {
  const start = zonedToUtc(date, minutesOfDay, config.timeZone);
  return { start, end: new Date(start.getTime() + config.slotMinutes * 60_000) };
}

export async function availabilityFor(date) {
  const starts = slotStartsFor(date);
  if (starts.length === 0) return [];

  const dayStart = zonedToUtc(date, starts[0], config.timeZone);
  const dayEnd = zonedToUtc(date, starts[starts.length - 1] + config.slotMinutes, config.timeZone);
  const busy = [
    ...(await busyPeriods(new Date(dayStart.getTime() - 3_600_000), new Date(dayEnd.getTime() + 3_600_000))),
    ...bookingsBetween(dayStart.getTime(), dayEnd.getTime()).map((booking) => ({
      start: booking.startMs,
      end: booking.endMs
    }))
  ];
  const earliest = Date.now() + config.leadMinutes * 60_000;

  return starts.map((minutesOfDay) => {
    const { start, end } = slotWindow(date, minutesOfDay);
    const tooSoon = start.getTime() < earliest;
    return {
      time: formatMinutes(minutesOfDay),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      available: !tooSoon && !overlaps(start.getTime(), end.getTime(), busy),
      reason: tooSoon ? "too-soon" : overlaps(start.getTime(), end.getTime(), busy) ? "taken" : null
    };
  });
}

export async function isSlotFree(date, minutesOfDay) {
  const slots = await availabilityFor(date);
  const wanted = formatMinutes(minutesOfDay);
  return slots.some((slot) => slot.time === wanted && slot.available);
}
