import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, calendarMode } from "./config.mjs";
import { createEvent, deleteEvent, isConfigured } from "./lib/google-calendar.mjs";
import { availabilityFor, isSlotFree, slotWindow } from "./lib/slots.mjs";
import { addBooking, attachEvent, cancelBooking, findBooking } from "./lib/store.mjs";
import {
  addDays,
  compareDates,
  formatDate,
  formatMinutes,
  parseDate,
  parseTime,
  todayInZone,
  weekdayOf
} from "./lib/time.mjs";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function bookableRange() {
  const first = todayInZone(config.timeZone);
  return { first, last: addDays(first, config.maxDaysAhead) };
}

function requestedDate(value) {
  const date = parseDate(value);
  if (!date) return { error: "請提供 YYYY-MM-DD 格式的日期。" };
  const { first, last } = bookableRange();
  if (compareDates(date, first) < 0) return { error: "無法預約過去的日期。" };
  if (compareDates(date, last) > 0) return { error: `最多只能預約 ${config.maxDaysAhead} 天內的時段。` };
  return { date };
}

function guestFrom(payload) {
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const phone = String(payload.phone || "").trim();
  const note = String(payload.note || "").trim();
  if (name.length < 1 || name.length > 80) return { error: "請填寫姓名（80 字以內）。" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "請填寫有效的 Email。" };
  if (phone.length > 40) return { error: "電話號碼過長。" };
  if (note.length > 1_000) return { error: "備註請控制在 1000 字以內。" };
  return { guest: { name, email, phone, note } };
}

function publicBooking(booking) {
  return {
    id: booking.id,
    manageToken: booking.manageToken,
    status: booking.status,
    date: booking.date,
    time: booking.time,
    endTime: booking.endTime,
    timeZone: config.timeZone,
    name: booking.name,
    email: booking.email,
    calendarLink: booking.calendarLink || null
  };
}

function sendSettings(response) {
  const { first, last } = bookableRange();
  sendJson(response, 200, {
    title: config.title,
    timeZone: config.timeZone,
    slotMinutes: config.slotMinutes,
    leadMinutes: config.leadMinutes,
    firstDate: formatDate(first),
    lastDate: formatDate(last),
    openWeekdays: Object.entries(config.openingHours)
      .filter(([, ranges]) => ranges.length > 0)
      .map(([weekday]) => Number(weekday)),
    calendarConnected: isConfigured()
  });
}

async function sendAvailability(url, response) {
  const { date, error } = requestedDate(url.searchParams.get("date"));
  if (error) return sendJson(response, 400, { error });
  if ((config.openingHours[weekdayOf(date)] || []).length === 0) {
    return sendJson(response, 200, { date: formatDate(date), slots: [], message: "這天沒有開放時段。" });
  }
  sendJson(response, 200, { date: formatDate(date), slots: await availabilityFor(date) });
}

async function createBooking(request, response) {
  const payload = await readJson(request);
  const { date, error: dateError } = requestedDate(payload.date);
  if (dateError) return sendJson(response, 400, { error: dateError });

  const minutesOfDay = parseTime(payload.time);
  if (minutesOfDay === null) return sendJson(response, 400, { error: "請提供 HH:MM 格式的時間。" });

  const { guest, error: guestError } = guestFrom(payload);
  if (guestError) return sendJson(response, 400, { error: guestError });

  // Re-check availability at booking time so a stale slot list cannot double-book.
  if (!(await isSlotFree(date, minutesOfDay))) {
    return sendJson(response, 409, { error: "這個時段剛剛被預約或已不開放，請重新選擇。" });
  }

  const { start, end } = slotWindow(date, minutesOfDay);
  const booking = await addBooking({
    date: formatDate(date),
    time: formatMinutes(minutesOfDay),
    endTime: formatMinutes(minutesOfDay + config.slotMinutes),
    startMs: start.getTime(),
    endMs: end.getTime(),
    ...guest
  });

  try {
    const event = await createEvent({
      summary: `${config.title}：${guest.name}`,
      description: [
        `姓名：${guest.name}`,
        `Email：${guest.email}`,
        guest.phone ? `電話：${guest.phone}` : null,
        guest.note ? `備註：${guest.note}` : null,
        `預約編號：${booking.id}`
      ].filter(Boolean).join("\n"),
      startInstant: start,
      endInstant: end,
      guestName: guest.name,
      guestEmail: guest.email
    });
    await attachEvent(booking.id, event);
  } catch (calendarError) {
    // The booking stays valid locally; the calendar can be reconciled later.
    console.error("Failed to create the Google Calendar event:", calendarError.message);
    sendJson(response, 201, {
      booking: publicBooking(findBooking(booking.id)),
      warning: "預約已建立，但同步 Google 日曆失敗，請聯絡我們確認。"
    });
    return;
  }

  sendJson(response, 201, { booking: publicBooking(findBooking(booking.id)) });
}

async function removeBooking(url, response) {
  const id = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";
  const booking = findBooking(id);
  if (!booking || booking.manageToken !== token) {
    return sendJson(response, 404, { error: "找不到這筆預約，請確認連結是否正確。" });
  }
  if (booking.status === "cancelled") {
    return sendJson(response, 200, { booking: publicBooking(booking), message: "這筆預約已經取消。" });
  }
  await deleteEvent(booking.calendarEventId);
  const cancelled = await cancelBooking(booking.id);
  sendJson(response, 200, { booking: publicBooking(cancelled) });
}

function serveStatic(request, response) {
  const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filename = normalize(join(publicDir, requested));
  if (!filename.startsWith(publicDir) || !existsSync(filename)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filename)] || "application/octet-stream" });
  createReadStream(filename).pipe(response);
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/settings") return sendSettings(response);
  if (request.method === "GET" && url.pathname === "/api/availability") return sendAvailability(url, response);
  if (request.method === "POST" && url.pathname === "/api/bookings") return createBooking(request, response);
  if (request.method === "DELETE" && url.pathname === "/api/bookings") return removeBooking(url, response);
  if (request.method === "GET") return serveStatic(request, response);
  response.writeHead(405, { Allow: "GET, POST, DELETE" });
  response.end();
}

createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    sendJson(response, 500, { error: "伺服器發生錯誤，請稍後再試。" });
  });
}).listen(config.port, () => {
  const mode = calendarMode();
  console.log(`Booking is ready at http://localhost:${config.port}`);
  console.log(
    mode === "offline"
      ? "Google Calendar is not configured; bookings are stored locally only. See booking/README.md."
      : `Google Calendar connected via ${mode} (calendar: ${config.calendarId}).`
  );
});
