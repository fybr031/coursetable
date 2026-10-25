/**
 * 构建脚本
 *  1) 生成单文件版：dist/课程表.html（把所有 CSS/JS 内联，方便直接发到手机打开）
 *  2) 自检：确认关键文件存在、资源引用没断
 * 用法：node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exist = (p) => fs.existsSync(path.join(ROOT, p));

/* ---------- 自检 ---------- */
const REQUIRED = [
  'index.html', 'manifest.webmanifest', 'sw.js',
  'assets/app.css', 'assets/app.js', 'assets/parser.js', 'assets/pdf-import.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png', 'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon.svg'
];
let bad = 0;
for (const f of REQUIRED) {
  if (!exist(f)) { console.error('✗ 缺少文件:', f); bad++; }
}
if (bad) process.exit(1);
console.log('✓ 文件完整 (' + REQUIRED.length + ' 个)');

/* ---------- 生成单文件版 ---------- */
const html = read('index.html');
const css = read('assets/app.css');
const parser = read('assets/parser.js');
const pdfImport = read('assets/pdf-import.js');
const app = read('assets/app.js');

const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

// 图标内联成 data URI，让单文件版真正零外部依赖
const svgIcon = fs.readFileSync(path.join(ROOT, 'assets/icons/favicon.svg'));
const pngIcon = fs.readFileSync(path.join(ROOT, 'assets/icons/apple-touch-icon.png'));

let out = html
  .replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace(/<link rel="stylesheet" href="assets\/app\.css">/, '<style>\n' + css + '\n</style>')
  .replace(/<link rel="icon" href="assets\/icons\/favicon\.svg" type="image\/svg\+xml">/,
    '<link rel="icon" href="data:image/svg+xml;base64,' + svgIcon.toString('base64') + '">')
  .replace(/<link rel="apple-touch-icon" href="assets\/icons\/apple-touch-icon\.png">/,
    '<link rel="apple-touch-icon" href="data:image/png;base64,' + pngIcon.toString('base64') + '">')
  .replace(/<script src="assets\/parser\.js"><\/script>/, '<script>\n' + safe(parser) + '\n</script>')
  .replace(/<script src="assets\/pdf-import\.js"><\/script>/, '<script>\n' + safe(pdfImport) + '\n</script>')
  .replace(/<script src="assets\/app\.js"><\/script>/, '<script>\n' + safe(app) + '\n</script>');

// 单文件版不需要 SW 与 manifest：去掉注册代码里的路径依赖（registerSW 已判断 http(s)，file:// 自动跳过）
out = out.replace('<title>课程表</title>', '<title>课程表 · 单文件版</title>');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const outFile = path.join(ROOT, 'dist', '课程表.html');
fs.writeFileSync(outFile, out, 'utf8');

const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log('✓ dist/课程表.html  (' + kb + ' KB)');

// 简单校验：内联后不应再有外部引用
const leftovers = out.match(/(?:src|href)="(?!data:|#)[^"]*"/g) || [];
const external = leftovers.filter((s) => /assets\/|\.css|\.js|manifest/.test(s));
if (external.length) {
  console.warn('⚠ 单文件版仍有外部引用：', external.join(', '));
} else {
  console.log('✓ 单文件版无外部依赖');
}
