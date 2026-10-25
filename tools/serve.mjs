/**
 * 局域网静态服务器（手机同 WiFi 下用手机浏览器访问电脑上的课程表）
 * 用法：node tools/serve.mjs [端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('404 ' + urlPath); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
});

function lanIps() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('课程表已启动：');
  console.log('  电脑：  http://localhost:' + PORT + '/');
  lanIps().forEach((ip) => console.log('  手机：  http://' + ip + ':' + PORT + '/   （手机连同一个 WiFi）'));
  console.log('\n注意：http 局域网地址不是「安全上下文」，Service Worker 离线缓存和「添加到主屏幕」会受限；');
  console.log('      要完整 PWA 体验，把这个文件夹传到任意 HTTPS 静态托管（GitHub Pages / Cloudflare Pages）即可。');
  console.log('按 Ctrl+C 停止。');
});
