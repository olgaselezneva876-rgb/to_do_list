const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { Date, crypto: require('node:crypto').webcrypto };
vm.createContext(context);
if (fs.existsSync(__dirname + '/core.js')) vm.runInContext(fs.readFileSync(__dirname + '/core.js', 'utf8'), context);
const api = context.Planner || {};

test('local calendar dates cross month, leap year and year boundaries', () => {
  assert.equal(typeof api.shiftDate, 'function');
  assert.equal(api.shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(api.shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(api.dateKey(new Date(2026, 9, 15, 23, 59)), '2026-10-15');
  assert.equal(Array.from(api.weekDates('2026-01-03')).join(','), '2025-12-28,2025-12-29,2025-12-30,2025-12-31,2026-01-01,2026-01-02,2026-01-03');
});

test('tasks trim names, support every priority, reject invalid input', () => {
  assert.equal(typeof api.makeTask, 'function');
  for (const priority of ['urgent', 'secondary', 'later']) {
    const task = api.makeTask('  Позвонить  ', '2026-10-15', priority);
    assert.equal(task.title, 'Позвонить');
    assert.equal(task.priority, priority);
    assert.equal(task.done, false);
    assert.ok(task.id);
  }
  assert.throws(() => api.makeTask('   ', '2026-10-15', 'later'));
  assert.throws(() => api.makeTask('Тест', '2026-02-30', 'later'));
  assert.throws(() => api.makeTask('Тест', '2026-10-15', 'unknown'));
});

test('editing and toggling affect only selected task and preserve original array', () => {
  assert.equal(typeof api.updateTask, 'function');
  const a = api.makeTask('A', '2026-10-15', 'urgent');
  const b = api.makeTask('B', '2026-10-16', 'later');
  const changed = api.updateTask([a, b], a.id, { title: ' Новое ', priority: 'secondary', done: true });
  assert.equal(changed[0].title, 'Новое');
  assert.equal(changed[0].priority, 'secondary');
  assert.equal(changed[0].done, true);
  assert.equal(changed[1], b);
  assert.equal(a.done, false);
  assert.equal(api.updateTask(changed, a.id, { done: false })[0].done, false);
});

test('day progress excludes other dates and recalculates after deletion', () => {
  assert.equal(typeof api.progress, 'function');
  const a = api.makeTask('A', '2026-10-15', 'urgent');
  const b = { ...api.makeTask('B', '2026-10-15', 'later'), done: true };
  const c = { ...api.makeTask('C', '2026-10-16', 'later'), done: true };
  const p = api.progress([a, b, c], '2026-10-15');
  assert.equal(p.total, 2); assert.equal(p.done, 1); assert.equal(p.percent, 50);
  assert.equal(api.progress([b, c], '2026-10-15').percent, 100);
  assert.equal(api.progress([], '2026-10-15').percent, 0);
});

test('storage round trip preserves tasks and rejects corrupt data', () => {
  assert.equal(typeof api.decode, 'function');
  const task = api.makeTask('<img src=x onerror=alert(1)>', '2026-10-15', 'later');
  assert.equal(api.decode(JSON.stringify({ version: 1, tasks: [task] }))[0].title, task.title);
  assert.equal(api.decode(null).length, 0);
  for (const raw of ['invalid', '{}', '{"version":2,"tasks":[]}', JSON.stringify({version: 1, tasks: [{...task, done: 'yes'}]}), JSON.stringify({version: 1, tasks: [task, task]})]) assert.throws(() => api.decode(raw));
});
