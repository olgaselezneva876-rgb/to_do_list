// Browser integration checks using an installed Chrome and its DevTools protocol.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = __dirname;
const profile = path.join(root, '.browser-test-profile', String(process.pid));
const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser, server, socket;
let checks = 0;
async function main() {
  fs.mkdirSync(profile, { recursive: true });
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (path.dirname(file) !== root || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const portFile = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let startupError; browser.on('error', error => { startupError = error; });
  for (let n = 0; n < 100 && !fs.existsSync(portFile); n++) { if (startupError) throw startupError; await delay(100); }
  let port;
  for (let n = 0; n < 50 && !port; n++) { try { port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); } catch {} if (!port) await delay(100); }
  console.log('DevTools port: ' + port);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  console.log('Chrome connected; opening test page.');
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('WebSocket ready.');
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); }
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('DevTools timeout: ' + method)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function ready() {
    for (let i = 0; i < 100; i++) { if (await evaluate('!!document.getElementById("week-days")?.children.length')) return; await delay(50); }
    throw new Error('Page did not initialize');
  }
  async function check(name, expression, expected) { assert.deepEqual(await evaluate(expression), expected, name); checks++; console.log('PASS ' + name); }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1150, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await ready();
  await evaluate('localStorage.clear()'); await cdp('Page.reload'); await delay(200); await ready();
  await check('empty day', 'document.getElementById("day-summary").textContent', 'Нет задач');
  async function add(title, priority) { await evaluate(`document.getElementById('task-title').value=${JSON.stringify(title)}; document.getElementById('task-priority').value=${JSON.stringify(priority)}; document.getElementById('add-form').requestSubmit()`); }
  await add('  Запланировать день  ', 'urgent'); await add('Прочитать главу', 'secondary'); await add('Разобрать фотографии', 'later');
  await check('three priorities', '[...document.querySelectorAll(".badge")].map(x=>x.textContent)', ['Срочно','Второстепенно','Можно сделать потом']);
  await evaluate('document.querySelector(".task-check").click()');
  await check('completion updates ring', 'document.getElementById("day-summary").textContent', 'Выполнено 1 из 3');
  await check('percentage', 'document.getElementById("day-ring").style.getPropertyValue("--percent")', '33');
  await evaluate('document.querySelector(".task-check").click()');
  await check('undo completion', 'document.getElementById("day-summary").textContent', 'Выполнено 0 из 3');
  await evaluate('document.querySelector(".edit").click(); document.getElementById("edit-title").value="Обновлённая задача"; document.getElementById("edit-priority").value="later"; document.getElementById("edit-form").requestSubmit()');
  await check('editing', 'document.querySelector(".task-title").textContent', 'Обновлённая задача');
  await cdp('Page.reload'); await delay(200); await ready();
  await check('persistence after reload', 'document.querySelector(".task-title").textContent', 'Обновлённая задача');
  await evaluate(`(() => { const key='day-by-day.planner.v1'; const raw=localStorage.getItem(key); localStorage.setItem(key, JSON.stringify({version:1,tasks:[]})); window.dispatchEvent(new StorageEvent('storage',{key,oldValue:raw,newValue:localStorage.getItem(key),storageArea:localStorage})); })()`);
  await check('other tab updates displayed tasks', 'document.querySelectorAll(".task-row").length', 0);
  await add('Обновлённая задача', 'later'); await add('Прочитать главу', 'secondary'); await add('Разобрать фотографии', 'later');
  await evaluate('document.getElementById("next").click()');
  await check('date separation', 'document.querySelectorAll(".task-row").length', 0);
  await evaluate('document.getElementById("previous").click(); document.querySelector(".delete").click()');
  await check('deletion', 'document.querySelectorAll(".task-row").length', 2);
  await add('   ', 'urgent');
  await check('whitespace rejected', 'document.querySelectorAll(".task-row").length', 2);
  await add('<img src=x onerror=alert(1)>', 'later');
  await check('user text is not HTML', 'document.querySelectorAll(".task-list img").length', 0);
  await evaluate('document.querySelectorAll(".delete")[2].click(); document.querySelector(".task-check").click()');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(root, 'preview-desktop.png'), Buffer.from(screenshot.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: true });
  await check('mobile has no horizontal overflow', 'document.documentElement.scrollWidth <= innerWidth', true);
  const mobile = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(root, 'preview-mobile.png'), Buffer.from(mobile.data, 'base64'));
  await evaluate('document.getElementById("selected-date").value="2026-01-03"; document.getElementById("selected-date").dispatchEvent(new Event("change"))');
  await check('week crosses year boundary', '[...document.querySelectorAll(".week-day")].map(x=>x.dataset.date)', ['2025-12-28','2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03']);
  await evaluate('document.querySelector(".week-day").click()');
  await check('week navigation', 'document.getElementById("selected-date").value', '2025-12-28');
  await evaluate('localStorage.setItem("day-by-day.planner.v1", "broken")');
  await cdp('Page.reload'); await delay(200); await ready(); await add('Временная задача', 'urgent');
  await check('corrupt storage preserved', 'localStorage.getItem("day-by-day.planner.v1")', 'broken');
  await check('corrupt storage warning visible', '!document.getElementById("storage-error").hidden', true);
  await evaluate('localStorage.removeItem("day-by-day.planner.v1")');
  await cdp('Page.reload'); await delay(200); await ready();
  await evaluate('Storage.prototype.setItem = () => { throw new DOMException("QuotaExceeded", "QuotaExceededError") }');
  await add('Не сохранено', 'urgent');
  await check('failed save is explicit', 'document.getElementById("save-status").textContent', 'Изменения не сохранены');
  await cdp('Page.navigate', { url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href }); await ready();
  await add('Прямое открытие файла', 'secondary');
  await cdp('Page.reload'); await delay(200); await ready();
  await check('direct file launch and persistence', 'document.querySelector(".task-title").textContent', 'Прямое открытие файла');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`${checks} browser checks passed; no uncaught errors.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server?.close(); });
