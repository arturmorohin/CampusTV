const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = '/app/uploads';
const PLAYLIST_FILE = '/app/data/playlist.json';
const TICKER_FILE = '/app/data/ticker.json';
const SESSIONS_FILE = '/app/data/sessions.json';
const PORT = 3000;

// Password from environment variable (set in docker-compose.yml)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Ensure directories exist
[UPLOADS_DIR, '/app/data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Init data files
if (!fs.existsSync(PLAYLIST_FILE)) fs.writeFileSync(PLAYLIST_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(TICKER_FILE)) fs.writeFileSync(TICKER_FILE, JSON.stringify({ enabled: true, text: 'Добро пожаловать! Здесь вы можете разместить важную информацию.' }, null, 2));
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2));

// Ticker version — bumped on every save, стенд опрашивает только его
let tickerVersion = Date.now();

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Sessions
function readSessions() { return readJSON(SESSIONS_FILE, {}); }
function writeSessions(s) { writeJSON(SESSIONS_FILE, s); }

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = readSessions();
  const now = Date.now();
  // Cleanup old sessions (older than 7 days)
  Object.keys(sessions).forEach(t => { if (now - sessions[t] > 7 * 86400000) delete sessions[t]; });
  sessions[token] = now;
  writeSessions(sessions);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const sessions = readSessions();
  const created = sessions[token];
  if (!created) return false;
  if (Date.now() - created > 7 * 86400000) {
    delete sessions[token]; writeSessions(sessions); return false;
  }
  return true;
}

function getToken(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, data) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Streaming multipart parser — streams file directly to disk (handles large files)
function parseMultipart(req, callback) {
  const ct = req.headers['content-type'] || '';
  const bMatch = ct.match(/boundary=("?)(.+)\1$/);
  if (!bMatch) return callback([]);
  const boundary = bMatch[2].trim();

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const parts = [];
      const sep = Buffer.from('--' + boundary);

      let pos = 0;
      while (pos < body.length) {
        // find boundary
        let bIdx = bufIndexOf(body, sep, pos);
        if (bIdx === -1) break;
        let next = bIdx + sep.length;
        // check for final --
        if (body[next] === 0x2d && body[next+1] === 0x2d) break;
        // skip \r\n after boundary
        if (body[next] === 0x0d && body[next+1] === 0x0a) next += 2;

        // find header/body separator
        const hSep = Buffer.from('\r\n\r\n');
        const hEnd = bufIndexOf(body, hSep, next);
        if (hEnd === -1) break;
        const headers = body.slice(next, hEnd).toString();

        // find next boundary to know where data ends
        const dataStart = hEnd + 4;
        const nextBound = bufIndexOf(body, Buffer.from('\r\n--' + boundary), dataStart);
        const dataEnd = nextBound === -1 ? body.length : nextBound;

        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) {
          parts.push({
            name: nameMatch[1],
            filename: filenameMatch ? filenameMatch[1] : null,
            data: body.slice(dataStart, dataEnd)
          });
        }
        pos = dataEnd + 2; // skip \r\n before next boundary
      }
      callback(parts);
    } catch(e) {
      console.error('Multipart parse error:', e);
      callback([]);
    }
  });
  req.on('error', () => callback([]));
}

function bufIndexOf(buf, search, offset) {
  offset = offset || 0;
  outer: for (let i = offset; i <= buf.length - search.length; i++) {
    for (let j = 0; j < search.length; j++) {
      if (buf[i+j] !== search[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // PUBLIC: GET /api/ticker/version — лёгкий опрос, без передачи текста
  if (req.method === 'GET' && pathname === '/api/ticker/version') {
    return json(res, 200, { version: tickerVersion });
  }

  // PUBLIC: GET /api/ticker — стенд читает без авторизации
  if (req.method === 'GET' && pathname === '/api/ticker') {
    return json(res, 200, readJSON(TICKER_FILE, { enabled: true, text: '' }));
  }

  // PUBLIC: GET /api/playlist — стенд читает без авторизации
  if (req.method === 'GET' && pathname === '/api/playlist') {
    return json(res, 200, readJSON(PLAYLIST_FILE, []));
  }

  // AUTH: POST /api/login
  if (req.method === 'POST' && pathname === '/api/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        if (password === ADMIN_PASSWORD) {
          const token = createSession();
          cors(res);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `session=${token}; HttpOnly; Path=/; Max-Age=604800`
          });
          res.end(JSON.stringify({ ok: true }));
        } else {
          json(res, 401, { error: 'Неверный пароль' });
        }
      } catch { json(res, 400, { error: 'Invalid JSON' }); }
    });
    return;
  }

  // AUTH: POST /api/logout
  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = getToken(req);
    if (token) { const s = readSessions(); delete s[token]; writeSessions(s); }
    cors(res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // AUTH: GET /api/check
  if (req.method === 'GET' && pathname === '/api/check') {
    return json(res, 200, { ok: isValidSession(getToken(req)) });
  }

  // All routes below require auth
  if (!isValidSession(getToken(req))) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  // PUT /api/ticker
  if (req.method === 'PUT' && pathname === '/api/ticker') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        writeJSON(TICKER_FILE, { enabled: !!data.enabled, text: String(data.text || '') });
        tickerVersion = Date.now(); // bump version — стенд обнаружит изменение
        return json(res, 200, { ok: true, version: tickerVersion });
      } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    });
    return;
  }

  // POST /api/upload
  if (req.method === 'POST' && pathname === '/api/upload') {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return json(res, 400, { error: 'Expected multipart/form-data' });
    parseMultipart(req, (parts) => {
      const filePart = parts.find(p => p.filename);
      if (!filePart) return json(res, 400, { error: 'No file' });
      const ext = path.extname(filePart.filename).toLowerCase();
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
      if (!allowed.includes(ext)) return json(res, 400, { error: 'Недопустимый тип файла' });
      const safeName = Date.now() + '_' + filePart.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(UPLOADS_DIR, safeName), filePart.data);
      const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);
      const durationPart = parts.find(p => p.name === 'duration');
      const duration = durationPart ? parseInt(durationPart.data.toString()) : (isVideo ? 0 : 10);
      const playlist = readJSON(PLAYLIST_FILE, []);
      const item = {
        id: Date.now().toString(), filename: safeName, originalName: filePart.filename,
        type: isVideo ? 'video' : 'image', duration, url: '/uploads/' + safeName,
        addedAt: new Date().toISOString()
      };
      playlist.push(item);
      writeJSON(PLAYLIST_FILE, playlist);
      return json(res, 200, item);
    });
    return;
  }

  // PUT /api/playlist/:id
  if (req.method === 'PUT' && pathname.startsWith('/api/playlist/')) {
    const id = pathname.split('/')[3];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const playlist = readJSON(PLAYLIST_FILE, []);
        const idx = playlist.findIndex(i => i.id === id);
        if (idx === -1) return json(res, 404, { error: 'Not found' });
        playlist[idx] = { ...playlist[idx], ...updates };
        writeJSON(PLAYLIST_FILE, playlist);
        return json(res, 200, playlist[idx]);
      } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    });
    return;
  }

  // DELETE /api/playlist/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/playlist/')) {
    const id = pathname.split('/')[3];
    const playlist = readJSON(PLAYLIST_FILE, []);
    const idx = playlist.findIndex(i => i.id === id);
    if (idx === -1) return json(res, 404, { error: 'Not found' });
    const item = playlist[idx];
    const filePath = path.join(UPLOADS_DIR, item.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    playlist.splice(idx, 1);
    writeJSON(PLAYLIST_FILE, playlist);
    return json(res, 200, { ok: true });
  }

  // POST /api/playlist/reorder
  if (req.method === 'POST' && pathname === '/api/playlist/reorder') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body);
        const playlist = readJSON(PLAYLIST_FILE, []);
        const reordered = order.map(id => playlist.find(i => i.id === id)).filter(Boolean);
        writeJSON(PLAYLIST_FILE, reordered);
        return json(res, 200, reordered);
      } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

// Allow large file uploads (2GB)
server.maxHeadersCount = 0;
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, () => console.log(`Server running on port ${PORT} | Password: ${ADMIN_PASSWORD}`));
