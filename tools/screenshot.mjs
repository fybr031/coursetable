/**
 * 开发用：用 Chrome DevTools Protocol 精确模拟手机视口截图（明/暗主题、各页面）
 * 用法：先启动 Chrome（见 .tmp-verify 脚本），再 node tools/screenshot.mjs <baseUrl> <outDir>
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8088';
const OUT = process.argv[3] || '.tmp-shots';
const CDP = process.argv[4] || 'http://127.0.0.1:9333';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(CDP + '/json/version');
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await wait(250);
  }
  throw new Error('连不上 Chrome DevTools，检查 --remote-debugging-port');
}

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, listeners };
}

const SCENARIOS = [
  {
    name: '1-day-light', theme: 'light', url: '/index.html?demo=1', desc: '日视图（浅色）'
  },
  {
    name: '2-week-light', theme: 'light', url: '/index.html?demo=1',
    action: `document.querySelector('.tab[data-view="week"]').click()`
  },
  {
    name: '3-day-dark', theme: 'dark', url: '/index.html?demo=1'
  },
  {
    name: '4-import-sheet', theme: 'light', url: '/index.html?demo=1',
    action: `window.CourseTableApp.openImport('paste')`
  },
  {
    name: '5-settings-sheet', theme: 'light', url: '/index.html?demo=1',
    action: `window.CourseTableApp.openSettings()`
  },
  {
    name: '6-course-detail', theme: 'light', url: '/index.html?demo=1',
    action: `document.querySelector('#dayView .lesson').click()`
  },
  {
    name: '7-empty-state', theme: 'light', url: '/index.html', clearStorage: true
  },
  {
    name: '8-week-dark', theme: 'dark', url: '/index.html?demo=1',
    action: `document.querySelector('.tab[data-view="week"]').click()`
  }
];

async function main() {
  const bws = await browserWs();
  const ws = new WebSocket(bws);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const { send } = rpc(ws);

  const results = [];
  for (const sc of SCENARIOS) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p = {}) => send(m, p, sessionId);

    await S('Page.enable');
    await S('Runtime.enable');
    // 提前注入错误收集器，捕获页面里的脚本异常
    await S('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__ctErrors=[];
        window.addEventListener('error',function(e){window.__ctErrors.push(String(e.message));});
        window.addEventListener('unhandledrejection',function(e){window.__ctErrors.push('promise: '+String(e.reason));});`
    });
    await S('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 }
    });
    await S('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-color-scheme', value: sc.theme }]
    });

    await S('Page.navigate', { url: BASE + sc.url });
    await wait(900);

    if (sc.clearStorage) {
      await S('Runtime.evaluate', { expression: `localStorage.clear()` });
      await S('Page.navigate', { url: BASE + sc.url });
      await wait(900);
    }
    if (sc.action) {
      await S('Runtime.evaluate', { expression: sc.action, awaitPromise: true });
      await wait(500);
    }
    // 关掉可能弹出的 toast 干扰
    await wait(400);

    const shot = await S('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(OUT, sc.name + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    results.push(sc.name + '  ' + sc.theme + '  ' + (fs.statSync(file).size / 1024).toFixed(0) + 'KB');

    // 顺带收集控制台错误
    const errs = await S('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__ctErrors||[])', returnByValue: true
    });
    const list = JSON.parse(errs.result.value || '[]');
    if (list.length) results.push('   ⚠ 页面错误: ' + list.join(' | '));

    await send('Target.closeTarget', { targetId });
  }
  ws.close();
  console.log(results.join('\n'));
}

main().catch((e) => { console.error('截图失败:', e.message); process.exit(1); });
