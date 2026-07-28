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
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405, { Allow: "GET" });
  response.end();
}).listen(port, () => {
  console.log(`Story Voice is ready at http://localhost:${port}`);
});
