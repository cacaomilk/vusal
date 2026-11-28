/* VUSAL — standalone server.
 * Serves the game files and hosts online rooms over plain HTTP long-polling
 * (no dependencies, works behind the preview proxy without WebSocket upgrades).
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var engine = require('./engine.js');

var ROOT = __dirname;
if (!fs.existsSync(path.join(ROOT, 'assets', 'cards', 'bc1.png')) &&
    fs.existsSync(path.join(ROOT, 'unpack-assets.js')) &&
    fs.existsSync(path.join(ROOT, 'assets.zip'))) {
  try { require('./unpack-assets.js'); } catch (e) { console.error('unpack-assets:', e.message); }
}

var PORT = Number(process.env.PORT || 3000);
var STORE = path.join(ROOT, 'rooms.json');
var rooms = Object.create(null);
var waiters = [];

var TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function code() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 5; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function token() { return crypto.randomBytes(18).toString('hex'); }
function send(res, status, obj, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(type && type.indexOf('json') < 0 ? obj : JSON.stringify(obj));
}
function json(res, status, obj) { send(res, status, obj); }
function body(req) {
  return new Promise(function (resolve) {
    var b = '';
    req.on('data', function (c) { b += c; if (b.length > 64000) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function publicRoom(room, seat) {
  var v = engine.view(room.state, seat);
  v.takenSeats = Object.keys(room.tokens).map(Number);
  v.seatActive = room.seatActive || {};
  v.serverNow = Date.now();
  return { state: v, version: room.version };
}

var saveTimer = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      var out = {};
      Object.keys(rooms).forEach(function (k) {
        var r = rooms[k];
        var s = JSON.parse(JSON.stringify(r.state));
        delete s.history;
        out[k] = { state: s, tokens: r.tokens, version: r.version, names: r.names, cfg: r.cfg };
      });
      fs.writeFileSync(STORE, JSON.stringify(out));
    } catch (e) { console.error('persist:', e.message); }
  }, 350);
}
function load() {
  try {
    var raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    Object.keys(raw).forEach(function (k) {
      var r = raw[k];
      if (r && r.state && r.tokens) {
        rooms[k] = {
          code: k,
          state: r.state,
          tokens: r.tokens,
          version: r.version || 1,
          names: r.names || {},
          cfg: r.cfg || {},
          seatActive: r.seatActive || {}
        };
      }
    });
    console.log('restored ' + Object.keys(rooms).length + ' room(s)');
  } catch (e) { /* no saved rooms */ }
}
function changed(room) {
  room.version = (room.version || 1) + 1;
  persist();
  waiters = waiters.filter(function (w) {
    if (w.code !== room.code) return true;
    clearTimeout(w.timer);
    try { json(w.res, 200, publicRoom(room, w.seat)); } catch (e) {}
    w.done = true;
    return false;
  });
}
function seatName(room, seat) { return room.state.players[seat] ? room.state.players[seat].name : 'Player ' + (seat + 1); }
function allSeatsJoined(room) {
  for (var i = 0; i < room.state.players.length; i++) if (!room.tokens[i]) return false;
  return true;
}
function freshStartedState(room) {
  // START and NEW GAME always begin from a clean state. This also recovers a
  // restored/persisted room whose last saved phase was gameover.
  var fresh = engine.newGame(room.cfg);
  Object.keys(room.names).forEach(function (k) {
    engine.apply(fresh, { type: 'SET_NAME', pid: Number(k), name: room.names[k] });
  });
  engine.apply(fresh, { type: 'START' });
  return fresh;
}

function serveStatic(req, res, pathname) {
  var rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { rel = pathname; }
  if (rel === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : 'OK\n');
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  var file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }
  var parts = url.pathname.split('/').filter(Boolean); // api, rooms, [code, action]
  var data = req.method === 'POST' ? await body(req) : {};

  if (parts[1] === 'rooms' && !parts[2] && req.method === 'POST') {
    var c;
    do { c = code(); } while (rooms[c]);
    var players = Math.max(2, Math.min(4, Number(data.players) || 4));
    var cfg = {
      players: players, online: true,
      manualDice: !!data.manualDice, exactFinish: data.exactFinish !== false,
      sequenceWin: data.sequenceWin !== false, showMarkers: !!data.showMarkers
    };
    var state = engine.newGame(cfg);
    var t = token();
    var room = { code: c, state: state, tokens: { 0: t }, version: 1, names: { 0: data.name || 'Player 1' }, cfg: cfg, seatActive: { '0': Date.now() } };
    engine.apply(state, { type: 'SET_NAME', pid: 0, name: data.name || 'Player 1' });
    rooms[c] = room;
    persist();
    return json(res, 200, Object.assign({ code: c, seat: 0, token: t }, publicRoom(room, 0)));
  }

  var c2 = (parts[2] || '').toUpperCase();
  var room = rooms[c2];
  if (!room) return json(res, 404, { error: 'Room not found.' });

  if (parts[3] === 'join' && req.method === 'POST') {
    if (room.state.phase !== 'lobby') return json(res, 409, { error: 'That game has already started.' });
    var free = -1;
    for (var i = 0; i < room.state.players.length; i++) if (!room.tokens[i]) { free = i; break; }
    if (free < 0) return json(res, 409, { error: 'That room is full.' });
    var t2 = token();
    room.tokens[free] = t2;
    room.names[free] = data.name || ('Player ' + (free + 1));
    room.seatActive = room.seatActive || {};
    room.seatActive[String(free)] = Date.now();
    engine.apply(room.state, { type: 'SET_NAME', pid: free, name: data.name || ('Player ' + (free + 1)) });
    changed(room);
    return json(res, 200, Object.assign({ code: c2, seat: free, token: t2 }, publicRoom(room, free)));
  }

  var seat = Number(url.searchParams.has('seat') ? url.searchParams.get('seat') : data.seat);
  var tok = url.searchParams.get('token') || data.token || '';
  if (!Number.isInteger(seat) || room.tokens[seat] !== tok || tok === '') return json(res, 401, { error: 'Invalid seat or token.' });
  room.seatActive = room.seatActive || {};
  room.seatActive[String(seat)] = Date.now();

  if (parts[3] === 'state' && req.method === 'GET') {
    var version = Number(url.searchParams.get('version') || 0);
    if (version !== room.version) return json(res, 200, publicRoom(room, seat));
    var w = { code: c2, seat: seat, res: res, done: false };
    w.timer = setTimeout(function () {
      if (w.done) return;
      waiters = waiters.filter(function (x) { return x !== w; });
      try { json(res, 200, publicRoom(room, seat)); } catch (e) {}
    }, 8000);
    waiters.push(w);
    res.on('close', function () { clearTimeout(w.timer); w.done = true; waiters = waiters.filter(function (x) { return x !== w; }); });
    return;
  }

  function kickSeatFn(kickSeat) {
    if (seat !== 0) return { status: 403, error: 'Only the host can kick.' };
    if (room.state.phase !== 'lobby') return { status: 409, error: 'Can only kick players in the lobby.' };
    if (!Number.isInteger(kickSeat) || kickSeat < 0 || kickSeat >= room.state.players.length) {
      return { status: 400, error: 'Invalid seat to kick.' };
    }
    if (kickSeat === 0) return { status: 403, error: 'Cannot kick the host.' };
    if (!room.tokens[kickSeat]) return { status: 409, error: 'That seat is empty.' };
    delete room.tokens[kickSeat];
    delete room.names[kickSeat];
    if (room.seatActive) delete room.seatActive[String(kickSeat)];
    engine.apply(room.state, { type: 'SET_NAME', pid: kickSeat, name: '' });
    return null;
  }

  if (parts[3] === 'action' && req.method === 'POST') {
    if (Number(data.seat) !== seat) return json(res, 401, { error: 'Seat mismatch.' });
    var a = Object.assign({}, data.action || {});
    if (a.type === 'START' || a.type === 'RESET') {
      if (seat !== 0) return json(res, 403, { error: 'Only the host can do that.' });
      if (!allSeatsJoined(room)) {
        return json(res, 409, { error: 'Wait for all ' + room.state.players.length + ' selected seats to join before starting.' });
      }
      if (a.type === 'RESET' || room.state.phase === 'lobby' || room.state.phase === 'gameover' || room.state.gameover) {
        room.state = freshStartedState(room);
      }
      // A repeated START during an active turn is ignored, never replayed.
    } else if (a.type === 'KICK') {
      var kickErr = kickSeatFn(Number(a.seatToKick));
      if (kickErr) return json(res, kickErr.status, { error: kickErr.error });
    } else if (a.type === 'SET_CONFIG') {
      if (seat !== 0) return json(res, 403, { error: 'Only the host can do that.' });
      if (room.state.phase !== 'lobby') return json(res, 409, { error: 'Can only change room settings in the lobby.' });
      var nextCfg = Object.assign({}, room.cfg, a.cfg || {});
      var n = Math.max(2, Math.min(4, Number(nextCfg.players) || room.state.players.length));
      nextCfg.players = n;
      room.cfg = nextCfg;
      for (var pid = n; pid < room.state.players.length; pid++) {
        delete room.tokens[pid];
        delete room.names[pid];
        if (room.seatActive) delete room.seatActive[String(pid)];
      }
      engine.apply(room.state, { type: 'SET_CONFIG', cfg: nextCfg });
    } else {
      a.seat = seat;
      engine.apply(room.state, a);
    }
    changed(room);
    return json(res, 200, publicRoom(room, seat));
  }

  if (parts[3] === 'leave' && req.method === 'POST') {
    delete room.tokens[seat];
    if (room.seatActive) delete room.seatActive[String(seat)];
    if (room.state.phase === 'lobby') {
      delete room.names[seat];
      engine.apply(room.state, { type: 'SET_NAME', pid: seat, name: '' });
    }
    changed(room);
    return json(res, 200, { ok: true });
  }

  if (parts[3] === 'kick' && req.method === 'POST') {
    var kickSeat2 = Number(data.seatToKick);
    var kickErr2 = kickSeatFn(kickSeat2);
    if (kickErr2) return json(res, kickErr2.status, { error: kickErr2.error });
    changed(room);
    return json(res, 200, { ok: true, kicked: kickSeat2 });
  }

  return json(res, 404, { error: 'Unknown endpoint.' });
}

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.indexOf('/api/') === 0) {
    handleApi(req, res, url).catch(function (e) { console.error(e); json(res, 500, { error: e.message }); });
  } else serveStatic(req, res, url.pathname);
});

load();
server.listen(PORT, '0.0.0.0', function () {
  console.log('VUSAL running on http://0.0.0.0:' + PORT);
});
