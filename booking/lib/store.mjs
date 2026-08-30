import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.mjs";

let bookings = null;
let pendingWrite = Promise.resolve();

function load() {
  if (bookings) return bookings;
  mkdirSync(dirname(config.dataFile), { recursive: true });
  if (existsSync(config.dataFile)) {
    try {
      const parsed = JSON.parse(readFileSync(config.dataFile, "utf8"));
      bookings = Array.isArray(parsed.bookings) ? parsed.bookings : [];
    } catch {
      throw new Error(`Cannot read bookings from ${config.dataFile}. Fix or remove the file.`);
    }
  } else {
    bookings = [];
  }
  return bookings;
}

// Writes are queued and atomic so a crash cannot leave a half-written file.
function persist() {
  const snapshot = JSON.stringify({ bookings: load() }, null, 2);
  pendingWrite = pendingWrite.then(() => {
    const temporary = `${config.dataFile}.${process.pid}.tmp`;
    writeFileSync(temporary, snapshot);
    renameSync(temporary, config.dataFile);
  });
  return pendingWrite;
}

export function activeBookings() {
  return load().filter((booking) => booking.status === "confirmed");
}

export function bookingsBetween(fromMs, toMs) {
  return activeBookings().filter((booking) => booking.endMs > fromMs && booking.startMs < toMs);
}

export function findBooking(id) {
  return load().find((booking) => booking.id === id) || null;
}

export async function addBooking(booking) {
  const record = {
    id: randomUUID(),
    manageToken: randomBytes(24).toString("base64url"),
    status: "confirmed",
    createdAt: new Date().toISOString(),
    ...booking
  };
  load().push(record);
  await persist();
  return record;
}

export async function cancelBooking(id) {
  const booking = findBooking(id);
  if (!booking) return null;
  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  await persist();
  return booking;
}

export async function attachEvent(id, event) {
  const booking = findBooking(id);
  if (!booking) return;
  booking.calendarEventId = event?.id || null;
  booking.calendarLink = event?.htmlLink || null;
  await persist();
}
