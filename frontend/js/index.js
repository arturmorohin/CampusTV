const API = '/api';
const stage = document.getElementById('stage');
const progressBar = document.getElementById('progress-bar');
const emptyEl = document.getElementById('empty');
const tickerText = document.getElementById('ticker-text');

let playlist = [];
let current = 0;
let timer = null;
let progressRaf = null;
let progressStart = null;
let progressDuration = 0;
let knownDurations = {};

// ── Clock
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('bar-time').textContent = hh + ':' + mm;
  const days   = ['вс','пн','вт','ср','чт','пт','сб'];
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  document.getElementById('bar-date').textContent =
    days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()];
}
updateClock();
setInterval(updateClock, 10000);

// ── Ticker (RAF-driven)
const TICKER_SPEED_PX = 150;
let tickerRaf  = null;
let tickerPos  = 0;   // пикселей пройдено вправо→влево
let tickerLoop = 0;   // trackW + textW — полный путь одного цикла
let tickerTrackW = 0;
let tickerLastT  = null;

function stopTicker() {
  if (tickerRaf) { cancelAnimationFrame(tickerRaf); tickerRaf = null; }
  tickerLastT = null;
}

function tickerStep(ts) {
  if (tickerLastT === null) tickerLastT = ts;
  const dt = (ts - tickerLastT) / 1000;
  tickerLastT = ts;
  tickerPos += TICKER_SPEED_PX * dt;
  // Полный цикл: стартует за правым краем (x = trackW), заканчивается когда весь текст ушёл влево (x = -textW)
  if (tickerLoop > 0 && tickerPos >= tickerLoop) {
    tickerPos -= tickerLoop;
  }
  tickerText.style.transform = 'translateX(' + (tickerTrackW - tickerPos) + 'px)';
  tickerRaf = requestAnimationFrame(tickerStep);
}

function startTicker() {
  stopTicker();
  tickerPos = 0;
  tickerRaf = requestAnimationFrame(tickerStep);
}

async function loadTicker() {
  try {
    const r = await fetch(API + '/ticker');
    const data = await r.json();
    if (data.enabled && data.text && data.text.trim()) {
      const text = data.text.trim();
      tickerText.classList.remove('empty-ticker');
      tickerText.style.transform = '';

      // Измеряем реальную ширину текста вне overflow-контейнера
      const probe = document.createElement('span');
      probe.style.cssText = [
        'position:fixed', 'top:-9999px', 'left:-9999px',
        'white-space:nowrap', 'visibility:hidden', 'pointer-events:none',
        'font-family:Montserrat,sans-serif', 'font-weight:600',
        'font-size:1.9rem', 'letter-spacing:0.5px'
      ].join(';');
      probe.textContent = text;
      document.body.appendChild(probe);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        const textW  = probe.getBoundingClientRect().width;
        document.body.removeChild(probe);
        tickerText.textContent = text;
        tickerTrackW = tickerText.parentElement.getBoundingClientRect().width;
        tickerLoop   = tickerTrackW + textW;
        startTicker();
      }));
    } else {
      stopTicker();
      tickerText.textContent = '';
      tickerText.style.transform = '';
      tickerText.classList.add('empty-ticker');
    }
  } catch(e) { console.error('Ticker load failed', e); }
}

// ── Progress bar
function startProgress(duration) {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressBar.style.width = '0%';
  progressStart    = performance.now();
  progressDuration = duration;
  function step(now) {
    const pct = Math.min(100, ((now - progressStart) / progressDuration) * 100);
    progressBar.style.width = pct + '%';
    if (pct < 100) progressRaf = requestAnimationFrame(step);
  }
  progressRaf = requestAnimationFrame(step);
}

// ── Stage
const FADE_MS = 800;

function clearStage() {
  clearTimeout(timer); timer = null;
  if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
  progressBar.style.width = '0%';
  stage.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
  stage.innerHTML = '';
}

function showSlide(idx) {
  const item = playlist[idx];
  if (!item) return;

  clearTimeout(timer); timer = null;
  if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
  progressBar.style.width = '0%';

  // Запоминаем старые слайды ДО добавления нового в DOM
  const oldSlides = [...stage.querySelectorAll('.slide')];

  const slide = document.createElement('div');
  slide.className = 'slide';

  if (item.type === 'video') {
    // Видео: мгновенно убираем старое, показываем новое
    oldSlides.forEach(old => {
      old.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
      old.remove();
    });
    const vid = document.createElement('video');
    vid.src         = item.url;
    vid.autoplay    = true;
    vid.muted       = false;
    vid.playsInline = true;
    vid.loop        = false;
    slide.appendChild(vid);
    stage.appendChild(slide);
    requestAnimationFrame(() => slide.classList.add('active'));

    let safetyTimer = setTimeout(() => next(), 10000);
    vid.addEventListener('loadedmetadata', () => {
      clearTimeout(safetyTimer);
      const realMs = Math.round(vid.duration * 1000);
      if (!realMs || !isFinite(realMs) || realMs <= 0) { next(); return; }
      const customMs = (item.duration && item.duration > 0) ? item.duration * 1000 : null;
      if (customMs && customMs < realMs) {
        startProgress(customMs);
        timer = setTimeout(() => { vid.pause(); next(); }, customMs);
      } else {
        startProgress(realMs);
      }
    });
    vid.addEventListener('ended', () => { clearTimeout(timer); next(); });
    vid.addEventListener('error', () => { clearTimeout(safetyTimer); clearTimeout(timer); next(); });

  } else {
    // Фото: crossfade — новый поверх старого
    const img = document.createElement('img');
    img.src = item.url;
    slide.appendChild(img);
    stage.appendChild(slide);

    // Два RAF: первый — элемент попадает в DOM с opacity:0,
    // второй — добавляем .active → CSS запускает transition opacity 0→1.
    // Старые слайды убираем одновременно — они уже сохранены в oldSlides,
    // поэтому новый слайд в список не попадает.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      slide.classList.add('active');
      oldSlides.forEach(old => {
        old.classList.remove('active');
        setTimeout(() => old.remove(), FADE_MS + 50);
      });
    }));

    const dur = Math.max(1000, (item.duration || 10) * 1000);
    startProgress(dur);
    timer = setTimeout(next, dur);
  }
}

function next() {
  if (!playlist.length) return;
  current = (current + 1) % playlist.length;
  showSlide(current);
}

// ── Playlist polling
async function loadPlaylist() {
  try {
    const r    = await fetch(API + '/playlist');
    const data = await r.json();

    if (!data.length) {
      emptyEl.classList.add('show');
      clearStage();
      playlist = [];
      knownDurations = {};
      return;
    }
    emptyEl.classList.remove('show');

    const prevItem = playlist[current] || null;
    const newDurations = {};
    data.forEach(i => { newDurations[i.id] = i.duration; });

    // Нет активного слайда — запускаем с начала
    if (!stage.querySelector('.slide')) {
      playlist = data;
      knownDurations = newDurations;
      current = 0;
      showSlide(current);
      return;
    }

    playlist = data;

    if (!prevItem) { knownDurations = newDurations; return; }

    const newIdx = data.findIndex(i => i.id === prevItem.id);
    if (newIdx === -1) {
      // Текущий элемент удалён — переходим к следующему
      current = Math.min(current, data.length - 1);
      knownDurations = newDurations;
      showSlide(current);
      return;
    }

    current = newIdx;

    // Длительность текущего элемента изменилась — применим со следующего
    const oldDur = knownDurations[prevItem.id];
    const newDur = newDurations[prevItem.id];
    knownDurations = newDurations;

    if (oldDur !== undefined && newDur !== oldDur) {
      next();
    }

  } catch(e) { console.error('Playlist load failed', e); }
}

loadPlaylist();
loadTicker();
setInterval(loadPlaylist, 5000);

// Тикер обновляется только когда админ нажал "Сохранить"
// Опрашиваем лёгкий /api/ticker/version каждые 3 сек
let lastTickerVersion = null;
async function pollTickerVersion() {
  try {
    const r = await fetch(API + '/ticker/version');
    const d = await r.json();
    if (lastTickerVersion === null) {
      lastTickerVersion = d.version;
    } else if (d.version !== lastTickerVersion) {
      lastTickerVersion = d.version;
      loadTicker(); // только сейчас грузим полный текст
    }
  } catch {}
}
pollTickerVersion();
setInterval(pollTickerVersion, 3000);
