(() => {
  'use strict';
  const P = window.Planner;
  const KEY = 'day-by-day.planner.v1';
  const $ = id => document.getElementById(id);
  let tasks = [];
  let selected = P.dateKey(new Date());
  let editing = null;
  let storageBlocked = false;
  let savedSnapshot = null;
  let unsaved = false;
  const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
  const shortFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
  const weekdayFormat = new Intl.DateTimeFormat('ru', { weekday: 'short' });

  function showError(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }
  function storageError(message) {
    showError('storage-error', message);
    $('save-status').textContent = 'Изменения не сохранены';
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      tasks = P.decode(raw);
      savedSnapshot = raw;
      unsaved = false;
      storageBlocked = false;
      showError('storage-error', '');
      $('save-status').textContent = 'Данные загружены из браузера';
    } catch {
      storageBlocked = true;
      storageError('Не удалось прочитать сохранённые задачи. Старые данные не перезаписываются. Изменения доступны только до закрытия страницы. Проверь доступ к хранилищу браузера.');
    }
  }
  function persist() {
    if (storageBlocked) return;
    try {
      if (localStorage.getItem(KEY) !== savedSnapshot) {
        storageBlocked = true;
        storageError('Задачи изменились в другой вкладке. Твои текущие изменения не сохранены, чтобы не перезаписать их. Скопируй нужный текст перед обновлением страницы.');
        return;
      }
      const raw = JSON.stringify({ version: 1, tasks });
      localStorage.setItem(KEY, raw);
      savedSnapshot = raw;
      unsaved = false;
      showError('storage-error', '');
      $('save-status').textContent = 'Сохранено в браузере';
    } catch {
      storageError('Не удалось сохранить изменения. Они доступны только до закрытия страницы. Возможно, хранилище браузера переполнено или недоступно.');
    }
  }
  function changeTasks(next) { tasks = next; unsaved = true; persist(); render(); }
  function setDate(value) {
    try {
      P.parseDate(value);
      P.weekDates(value);
      selected = value;
      showError('form-error', '');
      render();
    } catch (error) {
      $('selected-date').value = selected;
      showError('form-error', error.message);
    }
  }
  function actionButton(symbol, label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'task-action ' + className;
    button.textContent = symbol;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', handler);
    return button;
  }
  function openEdit(task) {
    editing = task.id;
    $('edit-title').value = task.title;
    $('edit-priority').value = task.priority;
    showError('edit-error', '');
    $('edit-dialog').showModal();
    $('edit-title').focus();
  }
  function renderTasks() {
    const day = tasks.filter(task => task.date === selected);
    $('task-count').textContent = day.length;
    $('empty-state').hidden = day.length > 0;
    $('task-list').replaceChildren();
    for (const task of day) {
      const row = document.createElement('li');
      row.className = 'task-row' + (task.done ? ' completed' : '');
      row.dataset.id = task.id;
      const check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'task-check'; check.checked = task.done;
      check.setAttribute('aria-label', (task.done ? 'Вернуть в работу: ' : 'Выполнить: ') + task.title);
      check.addEventListener('change', () => {
        changeTasks(P.updateTask(tasks, task.id, { done: check.checked }));
        [...$('task-list').children].find(item => item.dataset.id === task.id)?.querySelector('input').focus();
      });
      const text = document.createElement('div'); text.className = 'task-text';
      const title = document.createElement('p'); title.className = 'task-title'; title.textContent = task.title;
      const badge = document.createElement('span'); badge.className = 'badge ' + task.priority; badge.textContent = P.priorities[task.priority];
      text.append(title, badge);
      const actions = document.createElement('div'); actions.className = 'task-actions';
      actions.append(actionButton('✎', 'Изменить: ' + task.title, 'edit', () => openEdit(task)), actionButton('×', 'Удалить: ' + task.title, 'delete', () => {
        changeTasks(tasks.filter(item => item.id !== task.id));
        $('task-title').focus();
      }));
      row.append(check, text, actions); $('task-list').append(row);
    }
  }
  function renderProgress() {
    const p = P.progress(tasks, selected);
    $('day-ring').style.setProperty('--percent', p.percent);
    $('day-percent').replaceChildren(document.createTextNode(p.percent));
    const percent = document.createElement('span'); percent.textContent = '%'; $('day-percent').append(percent);
    $('day-ring').querySelector('.ring-center > span').textContent = selected === P.dateKey(new Date()) ? 'на сегодня' : 'за этот день';
    const summary = p.total ? `Выполнено ${p.done} из ${p.total}` : 'Нет задач';
    $('day-summary').textContent = summary;
    $('day-ring').setAttribute('aria-label', `${summary}. ${p.percent}%`);
    $('remaining').textContent = p.total ? (p.done === p.total ? 'Всё готово. Время для себя ✦' : `Осталось задач: ${p.total - p.done}`) : 'Пока можно просто выдохнуть';
    $('encouragement').textContent = !p.total ? 'Освободи мысли — запиши планы.' : p.done === p.total ? 'Все дела завершены. Можно выдохнуть!' : p.done ? 'Ты уже продвигаешься. Так держать.' : 'Начни с малого. Первый шаг важен.';
    const dates = P.weekDates(selected);
    $('week-range').textContent = `${shortFormat.format(P.parseDate(dates[0]))} — ${shortFormat.format(P.parseDate(selected))}`;
    $('week-days').replaceChildren();
    for (const date of dates) {
      const progress = P.progress(tasks, date);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'week-day' + (date === selected ? ' selected' : '');
      button.dataset.date = date;
      button.setAttribute('aria-label', `${dateFormat.format(P.parseDate(date))}: ${progress.total ? `выполнено ${progress.done} из ${progress.total}` : 'нет задач'}`);
      if (date === selected) button.setAttribute('aria-current', 'date');
      const label = document.createElement('span'); label.className = 'week-label'; label.textContent = weekdayFormat.format(P.parseDate(date));
      const ring = document.createElement('span'); ring.className = 'ring small-ring'; ring.style.setProperty('--percent', progress.percent);
      const number = document.createElement('span'); number.textContent = P.parseDate(date).getDate(); ring.append(number);
      const result = document.createElement('span'); result.className = 'week-result'; result.textContent = progress.total ? `${progress.done}/${progress.total}` : 'Нет задач';
      button.append(label, ring, result); button.addEventListener('click', () => { setDate(date); $('selected-date').focus(); });
      $('week-days').append(button);
    }
  }
  function render() {
    $('selected-date').value = selected;
    $('date-heading').textContent = dateFormat.format(P.parseDate(selected));
    $('date-context').textContent = selected === P.dateKey(new Date()) ? 'СЕГОДНЯ · ' + P.parseDate(selected).getFullYear() : 'ТВОЙ ДЕНЬ · ' + P.parseDate(selected).getFullYear();
    $('previous').disabled = selected === '1000-01-07';
    $('next').disabled = selected === '9999-12-31';
    renderTasks(); renderProgress();
  }
  $('add-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const task = P.makeTask($('task-title').value, selected, $('task-priority').value);
      changeTasks([...tasks, task]);
      $('task-title').value = ''; showError('form-error', ''); $('task-title').focus();
    } catch (error) { showError('form-error', error.message); }
  });
  $('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!tasks.some(task => task.id === editing)) throw new Error('Эта задача уже удалена в другой вкладке. Скопируй текст и добавь её заново.');
      changeTasks(P.updateTask(tasks, editing, { title: $('edit-title').value, priority: $('edit-priority').value }));
      $('edit-dialog').close(); $('task-title').focus();
    } catch (error) { showError('edit-error', error.message); }
  });
  $('cancel-edit').addEventListener('click', () => $('edit-dialog').close());
  $('selected-date').addEventListener('change', event => setDate(event.target.value));
  $('previous').addEventListener('click', () => setDate(P.shiftDate(selected, -1)));
  $('next').addEventListener('click', () => setDate(P.shiftDate(selected, 1)));
  $('today').addEventListener('click', () => setDate(P.dateKey(new Date())));
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    if (unsaved || storageBlocked) {
      storageBlocked = true;
      storageError('Данные изменились в другой вкладке. Текущие несохранённые изменения оставлены на экране. Скопируй нужный текст перед обновлением страницы.');
      return;
    }
    load(); render();
  });
  load(); render();
})();
