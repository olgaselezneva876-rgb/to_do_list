/* Shared pure logic; classic script also works when index.html is opened directly. */
(function (root) {
  'use strict';
  const priorities = { urgent: 'Срочно', secondary: 'Второстепенно', later: 'Можно сделать потом' };
  function dateKey(date) {
    return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function parseDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Выберите дату.');
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(2000, m - 1, d, 12);
    date.setFullYear(y);
    if (y < 1000 || y > 9999 || dateKey(date) !== key) throw new Error('Выберите корректную дату.');
    return date;
  }
  function shiftDate(key, delta) {
    const date = parseDate(key);
    date.setDate(date.getDate() + delta);
    const result = dateKey(date);
    parseDate(result);
    return result;
  }
  function weekDates(key) { return Array.from({ length: 7 }, (_, i) => shiftDate(key, i - 6)); }
  function validate(task) {
    if (!task || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 300) throw new Error('Введите название задачи от 1 до 300 символов.');
    if (!Object.hasOwn(priorities, task.priority)) throw new Error('Выберите приоритет.');
    if (typeof task.id !== 'string' || !task.id || typeof task.done !== 'boolean') throw new Error('Некорректные данные задачи.');
    parseDate(task.date);
    return { id: task.id, title: task.title.trim(), date: task.date, priority: task.priority, done: task.done };
  }
  function makeTask(title, date, priority = 'secondary') {
    return validate({ id: root.crypto.randomUUID(), title, date, priority, done: false });
  }
  function updateTask(tasks, id, changes) {
    return tasks.map(task => task.id === id ? validate({ ...task, ...changes, id: task.id, date: task.date }) : task);
  }
  function progress(tasks, date) {
    const day = tasks.filter(task => task.date === date);
    const done = day.filter(task => task.done).length;
    const percent = day.length
      ? (done === day.length ? 100 : Math.min(99, Math.round(done / day.length * 100)))
      : 0;
    return { total: day.length, done, percent };
  }
  function decode(raw) {
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tasks)) throw new Error('Неизвестный формат сохранённых данных.');
    const tasks = data.tasks.map(validate);
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('Повторяющиеся идентификаторы задач.');
    return tasks;
  }
  root.Planner = { priorities, dateKey, parseDate, shiftDate, weekDates, makeTask, updateTask, progress, decode };
})(globalThis);
