import { createSign } from "node:crypto";
import { config, calendarMode } from "../config.mjs";

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const calendarApi = "https://www.googleapis.com/calendar/v3";
const scope = "https://www.googleapis.com/auth/calendar";

let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

async function requestToken(body) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token request failed: ${payload.error_description || payload.error || response.status}`);
  }
  return { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 - 60_000 };
}

function signedAssertion() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: config.serviceAccount.email,
    scope,
    aud: tokenEndpoint,
    iat: issuedAt,
    exp: issuedAt + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(config.serviceAccount.privateKey, "base64url")}`;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const mode = calendarMode();
  if (mode === "oauth") {
    cachedToken = await requestToken({
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      refresh_token: config.oauth.refreshToken,
      grant_type: "refresh_token"
    });
  } else if (mode === "service-account") {
    cachedToken = await requestToken({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion()
    });
  } else {
    throw new Error("Google Calendar is not configured.");
  }
  return cachedToken.token;
}

async function callCalendar(path, options = {}) {
  const response = await fetch(`${calendarApi}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return {};
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = payload.error?.message || `HTTP ${response.status}`;
    const error = new Error(`Google Calendar API error: ${reason}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function isConfigured() {
  return calendarMode() !== "offline";
}

// Service accounts may only invite attendees with domain-wide delegation,
// so guests are added as calendar attendees under OAuth only.
function canInviteAttendees() {
  return calendarMode() === "oauth";
}

export async function busyPeriods(fromInstant, toInstant) {
  if (!isConfigured()) return [];
  const payload = await callCalendar("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: fromInstant.toISOString(),
      timeMax: toInstant.toISOString(),
      timeZone: config.timeZone,
      items: [{ id: config.calendarId }]
    })
  });
  const calendar = payload.calendars?.[config.calendarId];
  if (calendar?.errors?.length) {
    throw new Error(`Google Calendar rejected the calendar id: ${calendar.errors[0].reason}`);
  }
  return (calendar?.busy || []).map((period) => ({
    start: new Date(period.start).getTime(),
    end: new Date(period.end).getTime()
  }));
}

export async function createEvent({ summary, description, startInstant, endInstant, guestName, guestEmail }) {
  if (!isConfigured()) return null;
  const event = {
    summary,
    description,
    start: { dateTime: startInstant.toISOString(), timeZone: config.timeZone },
    end: { dateTime: endInstant.toISOString(), timeZone: config.timeZone }
  };
  if (guestEmail && canInviteAttendees()) {
    event.attendees = [{ email: guestEmail, displayName: guestName }];
  }
  const query = event.attendees ? "?sendUpdates=all" : "";
  const created = await callCalendar(
    `/calendars/${encodeURIComponent(config.calendarId)}/events${query}`,
    { method: "POST", body: JSON.stringify(event) }
  );
  return { id: created.id, htmlLink: created.htmlLink };
}

export async function deleteEvent(eventId) {
  if (!isConfigured() || !eventId) return;
  try {
    await callCalendar(
      `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: "DELETE" }
    );
  } catch (error) {
    // A already-removed event should not block cancelling the local booking.
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}
