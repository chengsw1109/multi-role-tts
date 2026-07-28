import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const publicDir = join(root, "public");

function loadEnvFile() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadEnvFile();

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

function validateSpeechRequest(body) {
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const voice = typeof body.voice === "string" ? body.voice : "alloy";
  const speed = Number(body.speed ?? 1);
  const voices = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

  if (!input) throw new Error("請輸入要朗讀的台詞。");
  if (input.length > 4_096) throw new Error("每段台詞最多 4,096 個字元。");
  if (!voices.has(voice)) throw new Error("不支援的聲音。");
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("語速必須介於 0.25 和 4 之間。");
  }
  return { input, voice, speed };
}

async function synthesize(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 500, { error: "找不到 OPENAI_API_KEY。請確認 .env.local 已設定。" });
    return;
  }

  try {
    const { input, voice, speed } = validateSpeechRequest(await readJson(request));
    const apiResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice,
        input,
        speed,
        response_format: "mp3"
      })
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      let message = "語音產生失敗。";
      try { message = JSON.parse(detail).error?.message || message; } catch { /* keep safe fallback */ }
      sendJson(response, apiResponse.status, { error: message });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    });
    const buffer = Buffer.from(await apiResponse.arrayBuffer());
    response.end(buffer);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "無法讀取請求。" });
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
  if (request.method === "POST" && request.url === "/api/speech") {
    synthesize(request, response);
    return;
  }
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405, { Allow: "GET, POST" });
  response.end();
}).listen(port, () => {
  console.log(`Multi-role TTS is ready at http://localhost:${port}`);
});

