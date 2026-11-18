import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { filesDir } from './store.js';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MAX_UPLOAD = 40 << 20;
const mimeTypes = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

export function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readRaw(req, limit, message) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, message);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readBody(req) {
  const body = await readRaw(req, 512_000, '这轮对话太长，请缩短答复。');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new RequestError(400, '请求格式有误。');
  }
}

// Attachments are served from the course's folder, never outside it.
export function serveFile(req, res, parts) {
  const [slug, ...rest] = parts.map((part) => decodeURIComponent(part));
  const name = rest.join('/');
  if (!/^[a-z0-9-]+$/.test(slug ?? '') || !name || name.includes('..') || name.includes('/'))
    return send(res, 404, { error: '没有这个文件。' });
  const path = join(filesDir, slug, name);
  if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, { error: '没有这个文件。' });
  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(name).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(path).size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  createReadStream(path).pipe(res);
}
