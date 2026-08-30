import { join } from "node:path";
import { loadEnvFile } from "./lib/env.mjs";
import { parseTime } from "./lib/time.mjs";

loadEnvFile(join(process.cwd(), ".env"));

// "09:00-12:00,13:30-18:00" -> [{ start: 540, end: 720 }, { start: 810, end: 1080 }]
function parseRanges(value, label) {
  const ranges = [];
  for (const piece of String(value).split(",")) {
    const text = piece.trim();
    if (!text) continue;
    const [from, to] = text.split("-").map((part) => parseTime(part.trim()));
    if (from === null || to === null || to <= from) {
      throw new Error(`Invalid opening hours "${text}" for ${label}. Use HH:MM-HH:MM.`);
    }
    ranges.push({ start: from, end: to });
  }
  return ranges.sort((left, right) => left.start - right.start);
}

// "1-5:09:00-12:00,13:30-18:00; 6:10:00-14:00" -> ranges keyed by weekday (0 = Sunday)
function parseOpeningHours(value) {
  const byWeekday = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const group of String(value).split(";")) {
    const text = group.trim();
    if (!text) continue;
    const separator = text.indexOf(":");
    if (separator < 1) throw new Error(`Invalid opening hours group "${text}". Use "1-5:09:00-18:00".`);
    const days = text.slice(0, separator).trim();
    const ranges = parseRanges(text.slice(separator + 1), days);
    for (const span of days.split(",")) {
      const [from, to] = span.trim().split("-").map(Number);
      const last = Number.isInteger(to) ? to : from;
      if (!Number.isInteger(from) || from < 0 || last > 6 || last < from) {
        throw new Error(`Invalid weekday "${span}". Use 0 (Sunday) to 6 (Saturday).`);
      }
      for (let weekday = from; weekday <= last; weekday += 1) byWeekday[weekday].push(...ranges);
    }
  }
  return byWeekday;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.BOOKING_PORT || 3100),
  timeZone: process.env.BOOKING_TIMEZONE || "Asia/Taipei",
  title: process.env.BOOKING_TITLE || "線上預約",
  slotMinutes: positiveNumber(process.env.BOOKING_SLOT_MINUTES, 30) || 30,
  bufferMinutes: positiveNumber(process.env.BOOKING_BUFFER_MINUTES, 0),
  leadMinutes: positiveNumber(process.env.BOOKING_LEAD_MINUTES, 120),
  maxDaysAhead: positiveNumber(process.env.BOOKING_MAX_DAYS_AHEAD, 30) || 30,
  openingHours: parseOpeningHours(process.env.BOOKING_HOURS || "1-5:09:00-12:00,13:30-18:00"),
  dataFile: process.env.BOOKING_DATA_FILE || join(process.cwd(), "booking", "data", "bookings.json"),
  calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || ""
  },
  serviceAccount: {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    privateKey: process.env.GOOGLE_PRIVATE_KEY || ""
  }
};

export function calendarMode() {
  if (config.oauth.clientId && config.oauth.clientSecret && config.oauth.refreshToken) return "oauth";
  if (config.serviceAccount.email && config.serviceAccount.privateKey) return "service-account";
  return "offline";
}
