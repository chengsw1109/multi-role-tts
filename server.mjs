import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const publicDir = join(root, "public");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function localVoiceboxUrl(value) {
  const url = new URL(value || "http://127.0.0.1:17493");
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (url.protocol !== "http:" || !allowedHosts.has(url.hostname)) {
    throw new Error("Voicebox URL must point to a local HTTP service.");
  }
  return url.origin;
}

async function voiceboxError(apiResponse, response) {
  const detail = await apiResponse.text();
  let message = "Voicebox request failed.";
  try { message = JSON.parse(detail).detail || JSON.parse(detail).error || message; } catch { /* safe fallback */ }
  sendJson(response, apiResponse.status, { error: message });
}

async function listVoiceboxProfiles(request, response) {
  try {
    const { voiceboxUrl } = await readJson(request);
    const apiResponse = await fetch(`${localVoiceboxUrl(voiceboxUrl)}/profiles`);
    if (!apiResponse.ok) return voiceboxError(apiResponse, response);
    const payload = await apiResponse.json();
    const profiles = Array.isArray(payload) ? payload : (payload.profiles || []);
    sendJson(response, 200, { profiles });
  } catch (error) {
    sendJson(response, 502, { error: "Unable to connect to local Voicebox. Check that Voicebox is running and its URL is correct." });
  }
}

async function generateVoiceboxSpeech(request, response) {
  try {
    const { voiceboxUrl, profileId, text } = await readJson(request);
    if (typeof profileId !== "string" || !profileId || typeof text !== "string" || !text.trim() || text.length > 5_000) {
      sendJson(response, 400, { error: "Invalid Voicebox speech request." });
      return;
    }
    const baseUrl = localVoiceboxUrl(voiceboxUrl);
    const generation = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, text: text.trim(), language: "zh", max_chunk_chars: 800 })
    });
    if (!generation.ok) return voiceboxError(generation, response);
    const generationData = await generation.json();
    if (!generationData.id) {
      sendJson(response, 502, { error: "Voicebox did not return an audio generation id." });
      return;
    }
    const audio = await fetch(`${baseUrl}/audio/${encodeURIComponent(generationData.id)}`);
    if (!audio.ok) return voiceboxError(audio, response);
    response.writeHead(200, {
      "Content-Type": audio.headers.get("content-type") || "audio/wav",
      "Cache-Control": "no-store"
    });
    response.end(Buffer.from(await audio.arrayBuffer()));
  } catch (error) {
    sendJson(response, 502, { error: "Unable to generate local Voicebox speech. Check the Voicebox service, installed model, and profile." });
  }
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

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/voicebox/profiles") {
    listVoiceboxProfiles(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/voicebox/speech") {
    generateVoiceboxSpeech(request, response);
    return;
  }
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405, { Allow: "GET, POST" });
  response.end();
}).listen(port, () => {
  console.log(`Story Voice is ready at http://localhost:${port}`);
});
