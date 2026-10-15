import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let filename = path.resolve(root, `.${pathname}`);
    if ((filename !== root && !filename.startsWith(`${root}${path.sep}`)) || pathname.split('/').some((part) => part.startsWith('.'))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filename);
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      filename = path.join(filename, 'index.html');
    }
    const content = await readFile(filename);
    const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    // Audio and video elements seek with byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, content.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
      if (start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${content.length}` }).end();
        return;
      }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1 });
      response.end(request.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Page not found');
  }
});
server.listen(port, '0.0.0.0', () => console.log(`KRPSA preview: http://localhost:${port}`));
