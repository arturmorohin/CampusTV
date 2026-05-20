const API = '/api';
let playlist = [];
let dragSrc = null;

// ── Toast
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Auth
async function checkAuth() {
  try {
    const r = await fetch(API + '/check');
    const d = await r.json();
    return d.ok;
  } catch { return false; }
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  loadPlaylist();
  loadTicker();
}

// ── Глазик для пароля
document.getElementById('toggle-password').addEventListener('click', () => {
  const input = document.getElementById('password-input');
  const btn = document.getElementById('toggle-password');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.classList.toggle('visible', isHidden);
});

// ── Login
async function doLogin() {
  const pw = document.getElementById('password-input').value;
  const btn = document.getElementById('btn-login');
  const errEl = document.getElementById('login-error');
  const input = document.getElementById('password-input');
  if (!pw) { errEl.textContent = 'Введите пароль'; input.classList.add('error'); return; }
  btn.disabled = true;
  btn.textContent = 'ВХОД...';
  try {
    const r = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (r.ok) {
      showApp();
    } else {
      const d = await r.json();
      errEl.textContent = d.error || 'Неверный пароль';
      input.classList.add('error');
      input.value = '';
    }
  } catch { errEl.textContent = 'Ошибка соединения'; }
  btn.disabled = false;
  btn.textContent = 'ВОЙТИ';
}

document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('password-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('password-input').addEventListener('input', () => {
  document.getElementById('password-input').classList.remove('error');
  document.getElementById('login-error').textContent = '';
});

// Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch(API + '/logout', { method: 'POST' });
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('password-input').value = '';
  document.getElementById('password-input').type = 'password';
  document.getElementById('toggle-password').classList.remove('visible');
});

// ── Ticker
async function loadTicker() {
  try {
    const r = await fetch(API + '/ticker');
    const d = await r.json();
    document.getElementById('ticker-enabled').checked = !!d.enabled;
    document.getElementById('ticker-text').value = d.text || '';
  } catch {}
}

async function saveTicker(showToast) {
  const enabled = document.getElementById('ticker-enabled').checked;
  const text = document.getElementById('ticker-text').value.trim();
  try {
    const r = await fetch(API + '/ticker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, text })
    });
    if (r.status === 401) { toast('Сессия истекла, войдите снова', 'error'); return; }
    if (showToast) toast('Бегущая строка сохранена');
  } catch { if (showToast) toast('Ошибка сохранения', 'error'); }
}

document.getElementById('ticker-enabled').addEventListener('change', () => saveTicker(false));
document.getElementById('btn-save-ticker').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-ticker');
  btn.textContent = '...';
  await saveTicker(true);
  btn.textContent = 'СОХРАНИТЬ';
});

// ── Фильтр бегущей строки: только печатаемые символы
document.getElementById('ticker-text').addEventListener('input', (e) => {
  const el = e.target;
  // Оставляем: базовая латиница, расширенная латиница, кириллица, пробел, перенос строки, таб
  // Убираем: все управляющие символы, спецсимволы вне диапазона, мусор из буфера обмена
  const cleaned = el.value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u024F\u0400-\u04FF\u2000-\u206F\u2600-\u27BF]/g, '');
  if (cleaned !== el.value) {
    const pos = el.selectionStart - (el.value.length - cleaned.length);
    el.value = cleaned;
    el.selectionStart = el.selectionEnd = Math.max(0, pos);
  }
});

// ── Playlist
async function loadPlaylist() {
  try {
    const r = await fetch(API + '/playlist');
    playlist = await r.json();
    renderPlaylist();
  } catch(e) { toast('Ошибка загрузки плейлиста', 'error'); }
}

function renderPlaylist() {
  const list = document.getElementById('playlist-list');
  const empty = document.getElementById('empty-state');
  const badge = document.getElementById('count-badge');
  badge.textContent = pluralize(playlist.length, 'файл', 'файла', 'файлов');
  if (!playlist.length) { list.innerHTML = ''; empty.classList.add('show'); return; }
  empty.classList.remove('show');
  list.innerHTML = '';

  playlist.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'playlist-item';
    el.draggable = true;
    el.dataset.id = item.id;

    const thumb = item.type === 'video'
      ? `<video src="${item.url}" muted preload="metadata"></video>`
      : `<img src="${item.url}" alt="">`;

    // Для видео показываем поле длительности (0 = до конца)
    const durValue = item.duration || 0;
    // Для видео поле длительности не показываем — видео играет до конца автоматически
    const durField = item.type === 'video'
      ? ''
      : `<div class="item-duration">
           <label>сек</label>
           <input type="number" min="1" max="3600" value="${item.duration || 10}" data-id="${item.id}">
         </div>`;

    const metaDur = item.type === 'video'
      ? '<span>до конца</span>'
      : `<span>${item.duration || 10} сек</span>`;

    el.innerHTML = `
      <div class="drag-handle">⠿</div>
      <div class="item-thumb">${thumb}<span class="type-badge">${item.type === 'video' ? '▶ видео' : '🖼 фото'}</span></div>
      <div class="item-info">
        <div class="item-name">${item.originalName || item.filename}</div>
        <div class="item-meta"><span>#${idx + 1}</span>${metaDur}</div>
      </div>
      ${durField}
      <div class="item-actions"><button class="btn-icon btn-delete" data-id="${item.id}">🗑</button></div>
    `;

    // Обработчики поля длительности — только для фото (у видео поля нет)
    const input = el.querySelector('input[type=number]');
    if (input) {
      // Блокируем . , e E + -
      input.addEventListener('keydown', (e) => {
        if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
      });
      input.addEventListener('input', (e) => {
        // Убираем всё кроме цифр
        const raw = e.target.value.replace(/[^0-9]/g, '');
        if (raw !== e.target.value) e.target.value = raw;
      });
      input.addEventListener('change', async (e) => {
        const min = item.type === 'video' ? 0 : 1;
        const val = Math.max(min, parseInt(e.target.value) || 0);
        e.target.value = val;
        const r = await fetch(`${API}/playlist/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: val })
        });
        if (r.status === 401) { toast('Сессия истекла', 'error'); return; }
        const it = playlist.find(i => i.id === item.id);
        if (it) { it.duration = val; renderPlaylist(); }
        toast('Длительность обновлена');
      });
    }

    el.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm(`Удалить "${item.originalName}"?`)) return;
      const r = await fetch(`${API}/playlist/${item.id}`, { method: 'DELETE' });
      if (r.status === 401) { toast('Сессия истекла', 'error'); return; }
      playlist = playlist.filter(i => i.id !== item.id);
      renderPlaylist();
      toast('Файл удалён');
    });

    el.addEventListener('dragstart', e => { dragSrc = el; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('drag-over')); });
    el.addEventListener('dragover', e => { e.preventDefault(); if (dragSrc && dragSrc !== el) { document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('drag-over')); el.classList.add('drag-over'); } });
    el.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === el) return;
      const items = [...document.querySelectorAll('.playlist-item')];
      const fromIdx = items.indexOf(dragSrc);
      const toIdx = items.indexOf(el);
      const newOrder = [...playlist];
      const [moved] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, moved);
      playlist = newOrder;
      renderPlaylist();
      await fetch(`${API}/playlist/reorder`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ order: playlist.map(i => i.id) }) });
      toast('Порядок сохранён');
    });

    list.appendChild(el);
  });
}

// ── Upload
async function uploadFile(file) {
  const prog = document.getElementById('upload-progress');
  const bar = document.getElementById('upload-progress-bar');
  prog.classList.add('show');
  bar.style.width = '10%';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('duration', '0');
  try {
    bar.style.width = '50%';
    const r = await fetch(`${API}/upload`, { method: 'POST', body: fd });
    bar.style.width = '90%';
    if (r.status === 401) { toast('Сессия истекла, войдите снова', 'error'); return false; }
    if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
    const item = await r.json();
    playlist.push(item);
    renderPlaylist();
    bar.style.width = '100%';
    setTimeout(() => { prog.classList.remove('show'); bar.style.width = '0%'; }, 500);
    return true;
  } catch(e) {
    prog.classList.remove('show'); bar.style.width = '0%';
    toast(e.message || 'Ошибка загрузки', 'error');
    return false;
  }
}

async function uploadFiles(files) {
  let ok = 0;
  for (const f of files) { if (await uploadFile(f)) ok++; }
  if (ok > 0) toast(`Загружено: ${pluralize(ok, 'файл', 'файла', 'файлов')}`);
}

function pluralize(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' ' + one;
  if ([2,3,4].includes(m10) && ![12,13,14].includes(m100)) return n + ' ' + many;
  return n + ' ' + many;
}

document.getElementById('file-input').addEventListener('change', e => { uploadFiles([...e.target.files]); e.target.value = ''; });

const zone = document.getElementById('upload-zone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
zone.addEventListener('drop', e => {
  e.preventDefault(); zone.classList.remove('drag');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (files.length) uploadFiles(files);
});

(async () => {
  if (await checkAuth()) showApp();
})();
