/* VUSAL — browser UI. Pass & play runs the engine locally; online rooms talk to server.js. */
(function () {
  'use strict';
  var E = window.VusalEngine, C = E.CARDS;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function img(id) { return C[id] ? C[id].img : ''; }

  var ui = {
    screen: 'setup', mode: 'menu', localState: null, privacySeat: null,
    confirmCard: null, localPlayers: 2, onlinePlayers: 4,
    cardFilter: 'All', cardQuery: '', light: false, noPrivacy: false, toastTimer: null,
    prevState: null, practiceBot: false, botBusy: false, botTimer: null,
    cardBannerQueue: [], logModalOpen: false, logFilter: 'All', logQuery: '',
    logReverse: true, highlightedCite: null, lastSeenLogN: 0
  };
  var online = { code: '', seat: 0, token: '', version: 0, state: null };
  var pollGeneration = 0;
  var rendering = false;

  /* ---------------- jazz (optional) ---------------- */
  var actx = null, jazzOn = false, jazzTimer = null, jazzStep = 0;
  var PROG = [
    [146.83, 174.61, 220.00, 261.63],
    [98.00, 123.47, 146.83, 174.61],
    [130.81, 164.81, 196.00, 246.94],
    [110.00, 138.59, 164.81, 196.00]
  ];
  function note(freq, dur, type, vol, delay) {
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function chord() {
    if (!actx) return;
    var f = PROG[jazzStep++ % PROG.length];
    f.forEach(function (x, i) { note(x, 2.1, i === 0 ? 'triangle' : 'sine', i === 0 ? 0.028 : 0.017, i * 0.035); });
    note(f[0] * 4, 0.5, 'sine', 0.008, 0.9);
    note(f[2] * 4, 0.5, 'sine', 0.006, 1.35);
  }
  function toggleJazz(forceOn) {
    var want = forceOn === true ? true : !jazzOn;
    if (want === jazzOn) { if (want) chord(); return; }
    jazzOn = want;
    if (jazzOn) {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) { toast('NO AUDIO SUPPORT'); jazzOn = false; return; } actx = new AC(); }
      if (actx.state === 'suspended') actx.resume();
      chord();
      jazzTimer = setInterval(chord, 2500);
    } else { clearInterval(jazzTimer); jazzTimer = null; }
    $('#jazzBtn').style.textDecoration = jazzOn ? 'underline' : 'none';
    toast(jazzOn ? 'JAZZ ON' : 'JAZZ OFF');
  }
  function savePrefs() {
    try {
      localStorage.setItem('vusal.light', ui.light ? '1' : '0');
      localStorage.setItem('vusal.noPrivacy', ui.noPrivacy ? '1' : '0');
    } catch (e) {}
  }
  function toast(msg) {
    var t = $('#toast');
    t.style.background = 'var(--ink)';
    t.style.color = 'var(--paper)';
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }
  function cardToast(kind, id, text, actor, imgUrl) {
    var badge = kind === 'draw' ? 'DREW' : kind === 'play' ? 'PLAYED' : kind === 'effect' ? 'EFFECT' : 'CARD';
    var item = {
      kind: kind,
      badge: badge,
      id: id ? String(id).toUpperCase() : '',
      actor: actor || '',
      text: text || '',
      img: imgUrl || (id && C[String(id).toLowerCase()] ? C[String(id).toLowerCase()].img : '')
    };
    var tail = ui.cardBannerQueue[ui.cardBannerQueue.length - 1];
    if (tail && tail.kind === item.kind && tail.id === item.id && tail.actor === item.actor && tail.text === item.text) return;
    ui.cardBannerQueue.push(item);
    if (ui.cardBannerQueue.length > 8) ui.cardBannerQueue.shift();
    renderCardBanner();
  }
  function shiftCardBanner() {
    if (!ui.cardBannerQueue.length) return;
    ui.cardBannerQueue.shift();
    renderCardBanner();
  }
  function clearCardBanners() {
    ui.cardBannerQueue = [];
    renderCardBanner();
  }
  function renderCardBanner(v) {
    var el = $('#cardBanner');
    if (!el) return;
    var ov = $('#overlay');
    if (ui.screen !== 'game' || !ui.cardBannerQueue.length || (ov && !ov.hidden) || (v && (v.banner || v.reveal || v.prompt || v.gameover))) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var b = ui.cardBannerQueue[0];
    el.className = 'card-banner' + (b.kind === 'effect' ? ' alert' : '');
    el.hidden = false;
    var countTag = ui.cardBannerQueue.length > 1 ? '<span>1 OF ' + ui.cardBannerQueue.length + '</span>' : '';
    var thumb = b.img ? '<img src="' + esc(b.img) + '" alt="' + esc(b.id) + '">' : '';
    var title = (b.actor ? esc(b.actor) + ' · ' : '') + esc(b.badge) + (b.id ? ' ' + esc(b.id) : '');
    el.innerHTML = thumb +
      '<div class="cb-body">' +
      '<div class="cb-kicker"><span>' + title + '</span>' + countTag + '</div>' +
      '<div class="cb-text">' + esc(b.text) + '</div>' +
      '<div class="cb-actions">' +
      '<button type="button" class="primary small" data-dismiss-cb>' + (ui.cardBannerQueue.length > 1 ? 'NEXT (' + (ui.cardBannerQueue.length - 1) + ' MORE)' : 'GOT IT') + '</button>' +
      '<button type="button" class="ghost small" data-openlog>LOG</button>' +
      '</div></div>';
  }

  /* ---------------- navigation ---------------- */
  function go(screen) {
    if (screen === 'game' && ui.mode === 'menu') screen = 'setup';
    ui.screen = screen;
    render();
  }
  function render() {
    if (rendering) return;
    rendering = true;
    try {
      if (ui.mode === 'online' && online.state && online.state.phase !== 'lobby' && ui.screen === 'setup') ui.screen = 'game';
      $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + ui.screen); });
      $$('.nav-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.screen === ui.screen); });
      // Never let a game overlay (privacy, reveal, prompt, game over) linger over another screen.
      if (ui.screen !== 'game') {
        var ov = $('#overlay');
        ov.hidden = true; ov.innerHTML = '';
        ov.classList.remove('passive', 'privacy-screen');
        ui.confirmCard = null;
        ui.logModalOpen = false;
        $('#mobileBar').hidden = true;
        renderCardBanner();
      }
      $('#modeBadge').textContent = ui.mode === 'local'
        ? (ui.practiceBot ? 'PRACTICE' : 'PASS & PLAY')
        : (ui.mode === 'online' ? 'ROOM ' + online.code + ' · SEAT ' + (online.seat + 1) : 'NO GAME');
      if (ui.screen === 'setup') renderMenu();
      if (ui.screen === 'game') renderGame();
      if (ui.screen === 'cards') renderCards();
    } finally { rendering = false; }
  }

  /* ---------------- menu ---------------- */
  function renderNames() {
    var box = $('#localNames');
    var html = '';
    for (var i = 0; i < ui.localPlayers; i++) {
      html += '<label class="field">PLAYER ' + (i + 1) + '<input class="localName" data-i="' + i + '" maxlength="24" placeholder="Player ' + (i + 1) + '"></label>';
    }
    box.innerHTML = html;
  }
  function renderMenu() {
    var saved = null;
    try { saved = localStorage.getItem('vusal.local'); } catch (e) {}
    $('#resumeLocal').hidden = !saved;
    if (ui.mode === 'online') renderRoomCard();
  }
  function selectedPlayers(sel) {
    var b = $(sel + ' button.on');
    return b ? Number(b.dataset.n) : 2;
  }
  function stopBots() {
    clearTimeout(ui.botTimer);
    ui.botTimer = null;
    ui.botBusy = false;
  }
  function startLocal(resume) {
    stopBots();
    ui.prevState = null;
    clearCardBanners();
    ui.logModalOpen = false;
    ui.highlightedCite = null;
    if (resume) {
      try {
        var raw = localStorage.getItem('vusal.local');
        if (!raw) return;
        ui.localState = JSON.parse(raw);
        ui.localState.history = [];
        ui.practiceBot = !!(ui.localState.cfg && ui.localState.cfg.practiceBot);
        if (ui.practiceBot) ui.noPrivacy = true;
      } catch (e) { toast('SAVED GAME UNREADABLE'); return; }
    } else {
      var names = $$('.localName').map(function (i) { return i.value.trim(); });
      var cfg = {
        players: ui.localPlayers, names: names,
        manualDice: $('#optManual').checked, exactFinish: $('#optExact').checked,
        sequenceWin: $('#optSequence').checked, showMarkers: $('#optMarkers').checked,
        practiceBot: false
      };
      ui.noPrivacy = $('#optPrivacy').checked;
      ui.practiceBot = false;
      savePrefs();
      ui.localState = E.newGame(cfg);
      E.apply(ui.localState, { type: 'START' });
    }
    ui.mode = 'local';
    ui.privacySeat = ui.noPrivacy ? focusSeat() : null;
    ui.confirmCard = null;
    saveLocal();
    go('game');
  }
  function startPractice() {
    stopBots();
    ui.prevState = null;
    clearCardBanners();
    ui.logModalOpen = false;
    ui.highlightedCite = null;
    var name = $('#practiceName').value.trim() || 'Player 1';
    var nBots = selectedPlayers('#practiceBots');
    var totalPlayers = 1 + nBots;
    var names = [name];
    for (var i = 1; i <= nBots; i++) names.push('Bot ' + (i + 1));
    var cfg = {
      players: totalPlayers, names: names,
      manualDice: false, exactFinish: $('#optPracticeExact').checked,
      sequenceWin: $('#optPracticeSequence').checked, showMarkers: $('#optPracticeMarkers').checked,
      practiceBot: true
    };
    ui.localState = E.newGame(cfg);
    E.apply(ui.localState, { type: 'START' });
    ui.mode = 'local';
    ui.privacySeat = null;
    ui.noPrivacy = true;
    ui.confirmCard = null;
    ui.practiceBot = true;
    saveLocal();
    go('game');
  }
  function hasBlockingBanner(s) {
    if (!s || !s.banners || !s.banners.length) return false;
    var b = s.banners[0];
    return !b.pendingPids || b.pendingPids.indexOf(0) >= 0;
  }
  function maybeBotTurn() {
    if (ui.botBusy || !ui.practiceBot || ui.mode !== 'local' || ui.screen !== 'game' || !ui.localState) return;
    var v = ui.localState;
    if (v.phase !== 'turn' || v.gameover || v.lastElimination || hasBlockingBanner(v) || ui.confirmCard || ui.logModalOpen) return;
    var actorSeat = focusSeat();
    if (actorSeat <= 0 || !v.players[actorSeat]) return;
    ui.botBusy = true;
    ui.botTimer = setTimeout(botAct, 900);
  }
  function botAct() {
    if (!ui.practiceBot || ui.mode !== 'local' || ui.screen !== 'game' || !ui.localState) {
      ui.botBusy = false; return;
    }
    var v = ui.localState;
    if (v.phase !== 'turn' || v.gameover || v.lastElimination || hasBlockingBanner(v) || ui.confirmCard || ui.logModalOpen) {
      ui.botBusy = false; return;
    }
    var actorSeat = focusSeat();
    var p = v.players[actorSeat];
    if (actorSeat <= 0 || !p) { ui.botBusy = false; return; }

    if (v.reveal) {
      act({ type: 'ACK', seat: actorSeat }, true);
    } else if (v.banners && v.banners.length) {
      act({ type: 'ACK_BANNER', seat: actorSeat }, true);
    } else if (v.prompt) {
      botAnswer(actorSeat);
    } else if (!p.alive) {
      if (v.canEndTurn) act({ type: 'END_TURN', seat: actorSeat }, true);
      else { ui.botBusy = false; return; }
    } else if (!v.rolledThisTurn) {
      act({ type: 'ROLL', seat: actorSeat }, true);
    } else if (v.canEndTurn) {
      var card = (p.hand || []).find(function (c) { return !c.sticky && !c.passive && c.playable !== false; });
      if (card) act({ type: 'PLAY_CARD', uid: card.uid, seat: actorSeat }, true);
      else act({ type: 'END_TURN', seat: actorSeat }, true);
    } else {
      ui.botBusy = false;
      return;
    }
    ui.botTimer = setTimeout(function () {
      ui.botBusy = false;
      maybeBotTurn();
    }, 600);
  }
  function botAnswer(actorSeat) {
    if (!ui.practiceBot || !ui.localState || !ui.localState.prompt) return;
    var opts = ui.localState.prompt.options || [];
    var pick = opts.find(function (o) { return !o.disabled; });
    if (pick == null) return;
    act({ type: 'ANSWER', value: pick.value, seat: actorSeat }, true);
  }
  function saveLocal() {
    if (!ui.localState) return;
    try {
      var s = JSON.parse(JSON.stringify(ui.localState));
      delete s.history;
      localStorage.setItem('vusal.local', JSON.stringify(s));
    } catch (e) {}
  }

  /* ---------------- online rooms ---------------- */
  function exitOnlineToMenu(errMsg) {
    pollGeneration++;
    online = { code: '', seat: 0, token: '', version: 0, state: null };
    ui.mode = 'menu';
    ui.screen = 'setup';
    ui.prevState = null;
    clearCardBanners();
    ui.logModalOpen = false;
    ui.highlightedCite = null;
    $('#onlineForms').hidden = false;
    $('#roomCard').hidden = true;
    setRoomQuery('');
    renderShareLine();
    if (errMsg) {
      $('#onlineError').textContent = errMsg;
      toast(errMsg);
    }
    render();
  }
  function renderRoomCard() {
    if (!online.state) return;
    $('#onlineForms').hidden = true;
    $('#roomCard').hidden = false;
    $('#roomCodeText').textContent = online.code;
    var v = online.state;
    var you = v.players[online.seat];
    $('#roomSeatLine').textContent = 'You are seat ' + (online.seat + 1) + ' (' + (you ? you.name : '') + '). Share the game link or the room code.';
    var rl = $('#roomLinkText');
    if (rl) { rl.hidden = !isHosted(); rl.textContent = isHosted() ? linkFor(online.code) : ''; }
    var taken = v.takenSeats || [];
    var seatsFull = v.players.every(function (p) { return taken.indexOf(p.i) >= 0; });
    var isHost = online.seat === 0;
    $('#partySizeLabel').style.display = isHost ? 'block' : 'none';
    var curN = v.players.length;
    $$('#partySize button').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.n) === curN); });
    $('#roomSeats').innerHTML = v.players.map(function (p) {
      var tag = p.i === online.seat ? 'YOU' : (p.i === 0 ? 'HOST' : (taken.indexOf(p.i) >= 0 ? 'JOINED' : 'OPEN'));
      var kick = isHost && p.i !== online.seat && p.i !== 0 && taken.indexOf(p.i) >= 0 ? '<button class="kick" data-kick="' + p.i + '">KICK</button>' : '';
      return '<li><b>' + (p.i + 1) + '</b><span>' + esc(p.name) + '</span><em>' + tag + '</em>' + kick + '</li>';
    }).join('');
    $('#startOnline').hidden = online.seat !== 0 || !seatsFull;
  }
  function isHosted() { return /^https?:$/.test(location.protocol); }
  function gameUrl() { return location.href.split('#')[0].split('?')[0]; }
  function linkFor(code) { return gameUrl() + '?room=' + encodeURIComponent(code); }
  function copyText(t) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      toast(ok ? 'LINK COPIED' : t);
    }
    if (navigator.clipboard && window.isSecureContext) {
      try {
        navigator.clipboard.writeText(t).then(function () { toast('LINK COPIED'); }, fallback);
      } catch (e) { fallback(); }
    } else fallback();
  }
  function renderShareLine() {
    var line = $('#shareLine');
    if (!line) return;
    var web = isHosted();
    line.hidden = !web;
    var t = $('#gameLinkText');
    if (t) t.textContent = web ? gameUrl() : '';
    var rl = $('#roomLinkText');
    if (rl) rl.hidden = !web;
  }
  function setRoomQuery(code) {
    try { history.replaceState(null, '', code ? '?room=' + encodeURIComponent(code) : location.pathname); } catch (e) {}
  }
  async function api(path, payload) {
    var r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
    return r.json();
  }
  async function createRoom() {
    stopBots();
    ui.practiceBot = false;
    ui.prevState = null;
    clearCardBanners();
    ui.logModalOpen = false;
    ui.highlightedCite = null;
    $('#onlineError').textContent = '';
    var name = $('#createName').value.trim() || 'Player 1';
    ui.onlinePlayers = selectedPlayers('#onlinePlayers');
    try {
      var d = await api('/api/rooms', {
        name: name, players: ui.onlinePlayers, manualDice: $('#onlineManual').checked
      });
      if (d.error) { $('#onlineError').textContent = d.error; return; }
      online = { code: d.code, seat: d.seat, token: d.token, version: d.version, state: d.state };
      ui.mode = 'online';
      setRoomQuery(d.code);
      renderRoomCard(); startPoll();
      toast('ROOM ' + d.code + ' CREATED');
    } catch (e) { $('#onlineError').textContent = 'Could not reach the server.'; }
  }
  async function joinRoom() {
    stopBots();
    ui.practiceBot = false;
    ui.prevState = null;
    clearCardBanners();
    ui.logModalOpen = false;
    ui.highlightedCite = null;
    $('#onlineError').textContent = '';
    var code = $('#joinCode').value.trim().toUpperCase();
    var name = $('#joinName').value.trim() || 'Player';
    if (!code) { $('#onlineError').textContent = 'Enter a room code.'; return; }
    try {
      var d = await api('/api/rooms/' + code + '/join', { name: name });
      if (d.error) { $('#onlineError').textContent = d.error; return; }
      online = { code: d.code, seat: d.seat, token: d.token, version: d.version, state: d.state };
      ui.mode = 'online';
      setRoomQuery(d.code);
      renderRoomCard(); startPoll();
      toast('JOINED AS SEAT ' + (d.seat + 1));
    } catch (e) { $('#onlineError').textContent = 'Could not reach the server.'; }
  }
  function startPoll() {
    var gen = ++pollGeneration;
    (async function loop() {
      while (gen === pollGeneration && ui.mode === 'online' && online.token) {
        // Snapshot the request: a delayed reply from an older room or an older
        // game must never roll the current screen back to a stale GAME OVER.
        var code = online.code, seat = online.seat, token = online.token, requestVersion = online.version;
        try {
          var r = await fetch('/api/rooms/' + code + '/state?seat=' + seat + '&token=' + token + '&version=' + requestVersion);
          var d = await r.json();
          if (gen !== pollGeneration || ui.mode !== 'online' || online.code !== code || online.seat !== seat || online.token !== token) continue;
          if (d.error) {
            var msg = r.status === 401 ? 'You were removed from the room.' : d.error;
            exitOnlineToMenu(msg);
            break;
          }
          if (d.state && d.state.phase === 'lobby' && d.state.takenSeats && d.state.takenSeats.indexOf(seat) < 0) {
            exitOnlineToMenu('You were removed from the room.');
            break;
          }
          if (!online.state || (d.version >= requestVersion && d.version >= online.version)) {
            online.version = d.version; online.state = d.state;
            if (ui.screen === 'setup' && d.state.phase === 'lobby') renderRoomCard();
            else render();
          }
        } catch (e) { /* transient; retry */ }
        await new Promise(function (res) { setTimeout(res, 250); });
      }
    })();
  }
  async function postAction(action) {
    if (!online.token) return;
    var gen = pollGeneration, code = online.code, seat = online.seat, token = online.token;
    try {
      var d = await api('/api/rooms/' + code + '/action', { seat: seat, token: token, action: action });
      if (d.error) { toast(d.error); return; }
      if (gen !== pollGeneration || ui.mode !== 'online' || online.code !== code || online.seat !== seat || online.token !== token) return;
      if (!online.state || d.version >= online.version) {
        online.version = d.version; online.state = d.state;
        render();
      }
    } catch (e) { toast('CONNECTION ISSUE — RETRYING'); }
  }
  function leaveRoom() {
    stopBots();
    if (online.token) api('/api/rooms/' + online.code + '/leave', { seat: online.seat, token: online.token }).catch(function () {});
    exitOnlineToMenu('');
  }
  function kickPlayer(kickSeat) {
    if (!online.token) return;
    postAction({ type: 'KICK', seatToKick: kickSeat });
  }

  /* ---------------- actions ---------------- */
  function act(action, fromBot) {
    if (!fromBot && (!ui.practiceBot || focusSeat() === 0 || (action && (action.type === 'ACK_BANNER' || action.type === 'ACK_ELIM')))) {
      if (action && ['ROLL', 'PLAY_CARD', 'END_TURN', 'ANSWER', 'ACK', 'ACK_BANNER', 'ACK_ELIM'].indexOf(action.type) >= 0) {
        shiftCardBanner();
      }
    }
    if (action && action.type === 'RESET') {
      clearCardBanners();
      ui.logModalOpen = false;
      ui.highlightedCite = null;
    }
    if (ui.mode === 'local') {
      if (ui.practiceBot && !fromBot && action && action.seat == null && action.type && action.type.indexOf('DM_') !== 0 && action.type !== 'UNDO') {
        action = Object.assign({ seat: 0 }, action);
      }
      E.apply(ui.localState, action);
      saveLocal();
      render();
    } else if (ui.mode === 'online') postAction(action);
  }
  function focusSeat() {
    var s = ui.localState;
    if (!s) return 0;
    if (s.reveal) return s.reveal.pid;
    if (s.banners && s.banners.length && s.banners[0].pendingPids && s.banners[0].pendingPids.length) {
      return s.banners[0].pendingPids[0];
    }
    if (s.prompt) return s.prompt.forPid;
    return s.turnIndex;
  }
  function currentView() {
    if (ui.mode === 'local') {
      if (!ui.localState) return null;
      return E.view(ui.localState, ui.practiceBot ? 0 : focusSeat());
    }
    if (ui.mode === 'online') return online.state;
    return null;
  }

  /* ---------------- game rendering ---------------- */
  var POS = ['N', 'E', 'S', 'W'];
  function renderGame() {
    var v = currentView();
    if (!v) {
      $('#board').innerHTML = '<div class="empty-note">Start a game from the menu.</div>';
      $('#turnPanel').innerHTML = '<h3>NO GAME</h3><p class="muted">Choose PASS &amp; PLAY or an ONLINE ROOM.</p>';
      $('#mobileBar').hidden = true;
      renderOverlay(null);
      renderCardBanner(null);
      return;
    }
    $('#roundInfo').textContent = 'ROUND ' + v.round + ' · TURN ' + (v.turnIndex + 1) + ' · ' + (v.direction === 1 ? 'CLOCKWISE' : 'COUNTER-CLOCKWISE');
    $('#boardHint').textContent = v.cfg.showMarkers ? 'S = SNAKE · L = LADDER · × = CURSED TILE' : 'NO SNAKES OR LADDERS PRINTED HERE — LOOK IN THE RULES';
    renderBoard(v);
    renderTurn(v);
    renderPlayers(v);
    renderHand(v);
    renderDeck(v);
    renderCardActivity(v);
    renderDM(v);
    renderLog(v);
    checkCardActivity(v);
    renderOverlay(v);
    renderCardBanner(v);
    renderMobileBar(v);
    if (ui.practiceBot && ui.mode === 'local' && ui.localState && ui.localState.phase === 'turn' && !ui.localState.gameover) maybeBotTurn();
  }
  function revealItems(r) {
    if (!r) return [];
    if (r.cards && r.cards.length) return r.cards;
    if (r.card) return [{ card: r.card, text: r.text, kept: r.kept, public: r.public, jazz: r.jazz }];
    return [];
  }
  function revealKey(r) {
    if (!r) return '';
    return r.pid + ':' + revealItems(r).map(function (it) { return it.card ? it.card.uid : 'secret'; }).join(',');
  }
  function checkCardActivity(v) {
    if (!v || (ui.mode !== 'online' && !ui.practiceBot)) { ui.prevState = null; return; }
    if (v.phase === 'lobby') { ui.prevState = cloneView(v); return; }
    var prev = ui.prevState;
    if (!prev || v.version < prev.version || (v.turnCount === 0 && v.discardCount === 0 && prev.discardCount > 0)) {
      ui.prevState = cloneView(v);
      return;
    }
    // When a blocking banner or personal draw modal is already waiting for the user, don't duplicate it.
    if ((v.banner && v.canAckBanner) || (v.reveal && v.reveal.pid === (ui.mode === 'online' ? v.yourSeat : 0))) {
      ui.prevState = cloneView(v);
      return;
    }

    var newLogs = (v.log || []).filter(function (l) { return l.n > prev.lastLogN; });
    var actor = findActorByChange(v, prev, newLogs);
    var mySeat = ui.mode === 'online' ? v.yourSeat : 0;
    var curYou = v.players[mySeat] || null;
    var prevYou = prev.players ? prev.players[mySeat] : null;
    var actedByOther = actor ? actor.i !== mySeat : prev.turnIndex !== mySeat;

    var addedStatuses = [];
    if (curYou && prevYou) {
      (curYou.statuses || []).forEach(function (st) {
        if ((prevYou.statuses || []).indexOf(st) < 0) addedStatuses.push(st);
      });
    }
    var eliminatedMe = !!(curYou && prevYou && prevYou.alive && !curYou.alive);
    var lostCardsFromOther = !!(curYou && prevYou && actedByOther && curYou.handCount < prevYou.handCount);
    var movedByOther = !!(curYou && prevYou && actedByOther && curYou.tile !== prevYou.tile);
    var movedBackByCard = !!(curYou && prevYou && v.discardCount > prev.discardCount && curYou.tile < prevYou.tile && (!actor || actor.i === mySeat));
    var badStatusHit = addedStatuses.some(function (st) {
      return st !== 'POINT NEMO' && st.indexOf('3→7→13') !== 0 && st !== 'SNAKE IMMUNE' && st !== 'LOSE-PROOF';
    }) && (actedByOther || v.discardCount > prev.discardCount);

    var effectReason = '';
    if (eliminatedMe) {
      effectReason = (v.lastElimination && v.lastElimination.pid === mySeat && v.lastElimination.reason) || 'You were eliminated.';
    } else if (movedByOther) {
      effectReason = 'Moved from tile ' + prevYou.tile + ' to tile ' + curYou.tile + '.';
    } else if (lostCardsFromOther) {
      effectReason = 'Lost ' + (prevYou.handCount - curYou.handCount) + ' card(s) from your hand.';
    } else if (badStatusHit) {
      effectReason = addedStatuses[0];
    } else if (movedBackByCard && v.discardTop) {
      effectReason = v.discardTop.text;
    }

    if (effectReason) {
      var effCard = v.discardCount > prev.discardCount && v.discardTop
        ? v.discardTop.id.toUpperCase()
        : findLastCardId(newLogs) || 'CARD';
      var logDetail = findReasonLog(newLogs);
      var msg = logDetail && v.discardTop && v.discardTop.text ? v.discardTop.text + ' (' + effectReason + ')' : (logDetail || effectReason);
      cardToast('effect', effCard, msg, actor ? actor.name : '', v.discardTop ? v.discardTop.img : '');
    } else if (v.discardCount > prev.discardCount && v.discardTop) {
      var last = v.discardTop;
      cardToast('play', last.id.toUpperCase(), last.text, actor ? actor.name : '', last.img);
    } else if (v.reveal && (!prev.reveal || prev.reveal.key !== revealKey(v.reveal))) {
      var drawer = v.players[v.reveal.pid];
      var items = revealItems(v.reveal);
      var pubCards = items.filter(function (it) { return !!it.card; });
      if (items.length > 1) {
        var desc = pubCards.length
          ? 'drew ' + items.length + ' cards (' + pubCards.map(function (it) { return it.card.id.toUpperCase(); }).join(', ') + (pubCards.length < items.length ? ' + secret' : '') + ')'
          : 'drew ' + items.length + ' cards';
        cardToast('draw', pubCards[0] ? pubCards[0].card.id.toUpperCase() : 'CARDS', desc, v.reveal.pid === mySeat ? 'You' : (drawer ? drawer.name : ''), pubCards[0] ? pubCards[0].card.img : '');
      } else if (pubCards[0]) {
        cardToast('draw', pubCards[0].card.id.toUpperCase(), pubCards[0].card.text, v.reveal.pid === mySeat ? 'You' : (drawer ? drawer.name : ''), pubCards[0].card.img);
      } else {
        cardToast('draw', 'CARD', 'drew a secret card', drawer ? drawer.name : '');
      }
    } else if (v.waiting && v.waiting.kind === 'reveal' && (!prev.waiting || prev.waiting.pid !== v.waiting.pid || prev.waiting.kind !== 'reveal')) {
      var wc = v.waiting.count || 1;
      cardToast('draw', 'CARD', 'drew ' + (wc > 1 ? wc + ' secret cards' : 'a secret card'), v.waiting.name);
    } else if (curYou && prevYou && curYou.handCount > prevYou.handCount) {
      var drawn = curYou.handCount - prevYou.handCount;
      cardToast('draw', 'CARD', 'drew ' + drawn + ' card' + (drawn > 1 ? 's' : ''), 'You');
    } else {
      var otherGained = (v.players || []).find(function (p) {
        var pp = prev.players ? prev.players[p.i] : null;
        return pp && p.i !== mySeat && p.handCount > pp.handCount;
      });
      if (otherGained) {
        var d2 = otherGained.handCount - prev.players[otherGained.i].handCount;
        cardToast('draw', 'CARD', 'drew ' + d2 + ' card' + (d2 > 1 ? 's' : ''), otherGained.name);
      } else {
        var elim = (v.players || []).find(function (p) {
          var pp = prev.players ? prev.players[p.i] : null;
          return pp && pp.alive && !p.alive;
        });
        if (elim) cardToast('effect', 'OUT', elim.name + ' is out.', elim.name);
      }
    }

    ui.prevState = cloneView(v);
  }
  function cloneView(v) {
    if (!v) return null;
    var logs = v.log || [];
    return {
      version: v.version || 0,
      turnIndex: v.turnIndex,
      discardCount: v.discardCount,
      discardTop: v.discardTop,
      lastLogN: logs.length ? logs[logs.length - 1].n : 0,
      reveal: v.reveal ? { key: revealKey(v.reveal), pid: v.reveal.pid } : null,
      banner: v.banner ? v.banner.id : 0,
      waiting: v.waiting ? { kind: v.waiting.kind, pid: v.waiting.pid } : null,
      you: v.you ? { handCount: v.you.handCount } : null,
      players: (v.players || []).map(function (p) {
        return { i: p.i, name: p.name, tile: p.tile, alive: p.alive, handCount: p.handCount, statuses: (p.statuses || []).slice() };
      })
    };
  }
  function findActorByChange(v, prev, newLogs) {
    var losers = (v.players || []).filter(function (p) {
      var pp = prev.players ? prev.players[p.i] : null;
      return pp && p.handCount < pp.handCount;
    });
    if (losers.length === 1) return losers[0];
    for (var i = newLogs.length - 1; i >= 0; i--) {
      var txt = newLogs[i].text || '';
      var m = txt.match(/^(.+?)\s+(?:plays|drew)\s+/);
      if (m) {
        var found = (v.players || []).find(function (p) { return p.name === m[1]; });
        if (found) return found;
      }
    }
    return (v.players && v.players[prev.turnIndex]) || (v.players && v.players[v.turnIndex]) || null;
  }
  function findLastCardId(newLogs) {
    for (var i = newLogs.length - 1; i >= 0; i--) {
      if (newLogs[i].cardId) return String(newLogs[i].cardId).toUpperCase();
    }
    return '';
  }
  function findReasonLog(newLogs) {
    for (var i = newLogs.length - 1; i >= 0; i--) {
      var txt = newLogs[i].text || '';
      if (txt.indexOf('— Round') !== 0) return txt;
    }
    return '';
  }
  function renderMobileBar(v) {
    var bar = $('#mobileBar');
    if (ui.screen !== 'game' || v.phase === 'gameover' || v.phase === 'lobby') { bar.hidden = true; return; }
    bar.hidden = false;
    var isActor = v.yourSeat === v.turnIndex;
    var blocked = !!(v.reveal || v.prompt || v.waiting || v.banner || v.lastElimination);
    var turnName = v.players[v.turnIndex] ? v.players[v.turnIndex].name : '—';
    var tile = v.players[v.turnIndex] ? v.players[v.turnIndex].tile : '—';
    var latestN = v.log && v.log.length ? v.log[v.log.length - 1].n : 0;
    var hasNew = latestN > ui.lastSeenLogN;
    var h = '<div class="mb-info"><b>' + esc(turnName) + '</b><span>TILE ' + (tile < 0 ? '−' + Math.abs(tile) : tile) + ' · R' + v.round + '</span></div>';
    if (blocked) h += '<button class="mb-btn" disabled>CARD</button>';
    else if (!isActor) h += '<button class="mb-btn" disabled>WAIT</button>';
    else if (!v.rolledThisTurn) h += '<button class="mb-btn primary" data-roll>ROLL</button>';
    else if (v.canEndTurn) h += '<button class="mb-btn primary" data-end>END TURN</button>';
    else h += '<button class="mb-btn" disabled>•••</button>';
    h += '<button class="mb-btn" data-jumphand>HAND ' + (v.you ? v.you.hand.length : 0) + '</button>';
    h += '<button class="mb-btn' + (hasNew ? ' has-new' : '') + '" data-openlog>LOG' + (latestN ? ' ' + latestN : '') + '</button>';
    bar.innerHTML = h;
  }
  function renderBoard(v) {
    var cursed = v.cursedTiles || [];
    var here = v.players[v.turnIndex] ? v.players[v.turnIndex].tile : -999;
    var html = '';
    E.BOARD_GRID.forEach(function (row) {
      row.forEach(function (t) {
        var cls = ['tile'];
        if (t <= 0) cls.push('nemo');
        if (t === 100) cls.push('finish');
        if (t === here) cls.push('here');
        if (cursed.indexOf(t) >= 0) cls.push('cursed');
        var pawns = v.players.filter(function (p) { return p.alive && p.tile === t; })
          .map(function (p) { return '<span class="pawn' + (p.i === v.turnIndex ? ' turn' : '') + '" title="' + esc(p.name) + '">' + (p.i + 1) + '</span>'; }).join('');
        var mark = '';
        if (v.cfg.showMarkers && t > 0) {
          if (E.SNAKES[t] != null) mark = 'S ' + E.SNAKES[t];
          else if (E.LADDERS[t] != null) mark = 'L ' + E.LADDERS[t];
        }
        if (t === -9) mark = 'NEMO';
        if (t === 0) mark = 'EXIT';
        if (t === 100) mark = 'WIN';
        var dot = (v.cfg.sequenceWin && (t === 3 || t === 7 || t === 13)) ? '<span class="seqdot"></span>' : '';
        var num = t < 0 ? '−' + Math.abs(t) : String(t);
        html += '<div class="' + cls.join(' ') + '" data-tile="' + t + '" title="Tile ' + t + '">' +
          '<span class="num">' + num + '</span>' + dot +
          '<span class="mark">' + esc(mark) + '</span>' +
          '<span class="pawns">' + pawns + '</span></div>';
      });
    });
    $('#board').innerHTML = html;
  }
  function renderTurn(v) {
    var isActor = v.yourSeat === v.turnIndex;
    var turnName = v.players[v.turnIndex] ? v.players[v.turnIndex].name : '—';
    var blocked = !!(v.reveal || v.prompt || v.waiting || v.banner || v.lastElimination);
    var h = '<h3>TURN</h3><div class="turn-line"><b>' + esc(turnName) + '</b><span>SEAT ' + (v.turnIndex + 1) + ' / TILE ' + (v.players[v.turnIndex] ? v.players[v.turnIndex].tile : '—') + '</span></div>';
    h += '<div class="die">' + (v.lastDieRaw == null ? '–' : v.lastDieRaw) + '</div>';
    if (v.lastDieRaw != null && v.lastDie !== v.lastDieRaw) h += '<p class="muted" style="margin-top:-8px">modified roll → ' + v.lastDie + '</p>';
    if (v.phase === 'lobby') h += '<p class="muted">Waiting for the host to start.</p>';
    else if (blocked) h += '<div class="waiting-note">' + (v.banner ? 'Waiting for banner confirmation…' : 'Resolving a card…') + '</div>';
    else if (!isActor) h += '<div class="waiting-note">Waiting for ' + esc(turnName) + '.</div>';
    else if (!v.rolledThisTurn) {
      h += '<button class="bigbtn" data-roll>ROLL d6</button>';
      if (v.cfg.manualDice) {
        h += '<div class="muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:6px">OR ENTER YOUR OWN ROLL</div><div class="manual">' +
          [1, 2, 3, 4, 5, 6].map(function (n) { return '<button data-manual="' + n + '">' + n + '</button>'; }).join('') + '</div>';
      }
    } else if (v.canEndTurn) {
      h += '<button class="bigbtn" data-end>END TURN</button>';
      if (ui.mode === 'local' || online.seat === 0) h += '<button class="bigbtn secondary" data-undo>UNDO LAST ACTION</button>';
    } else h += '<div class="waiting-note">Resolving…</div>';
    $('#turnPanel').innerHTML = h;
  }
  function renderPlayers(v) {
    var now = v.serverNow || Date.now();
    var h = '<h3>PAWNS &amp; STATUS</h3><div class="plist">';
    v.players.forEach(function (p) {
      var disc = '';
      var sa = v.seatActive && v.seatActive[String(p.i)];
      if (sa && now - sa > 120000) disc = ' DISCONNECTED';
      else if (sa && now - sa > 60000 && p.i === v.turnIndex) disc = ' IDLE';
      h += '<div class="prow' + (p.i === v.turnIndex ? ' current' : '') + (p.alive ? '' : ' dead') + disc + '">' +
        '<span class="pnum">' + (p.i + 1) + '</span>' +
        '<span><span class="pname">' + esc(p.name) + '</span>' +
        '<span class="tags">' + p.statuses.map(function (s) { return '<span class="tag">' + esc(s) + '</span>'; }).join('') +
        '<span class="tag">' + p.handCount + ' CARD' + (p.handCount === 1 ? '' : 'S') + '</span></span></span>' +
        '<span class="ptile">' + (p.tile < 0 ? '−' + Math.abs(p.tile) : p.tile) + '</span></div>';
    });
    h += '</div><div class="seatmap">';
    var seats = { 0: 1, 1: 5, 2: 7, 3: 3 };
    for (var i = 0; i < 9; i++) {
      var pidx = -1;
      Object.keys(seats).forEach(function (k) { if (seats[k] === i) pidx = Number(k); });
      if (i === 4) h += '<div>·</div>';
      else if (pidx >= 0 && pidx < v.players.length) h += '<div class="' + (pidx === v.turnIndex ? 'on' : '') + '">' + POS[pidx] + ' · ' + (pidx + 1) + '</div>';
      else h += '<div>&nbsp;</div>';
    }
    h += '</div>';
    $('#playersPanel').innerHTML = h;
  }
  function renderHand(v) {
    var hand = v.you ? v.you.hand : [];
    var h = '<h3>YOUR HAND' + (v.yourSeat != null ? ' · SEAT ' + (v.yourSeat + 1) : '') + '</h3>';
    if (!hand.length) h += '<div class="empty-note">No cards in hand. Land on an even tile to draw.</div>';
    else {
      h += '<div class="handgrid">' + hand.map(function (c) {
        var flag = c.sticky ? 'ONGOING' : (c.passive ? 'PASSIVE' : '');
        return '<button class="hcard' + (c.sticky ? ' sticky' : '') + '" data-card="' + c.uid + '" title="' + esc(c.text) + '">' +
          (flag ? '<span class="flag">' + flag + '</span>' : '') +
          '<img src="' + c.img + '" alt="' + c.id.toUpperCase() + '" loading="lazy">' +
          '<span class="cid">' + c.id.toUpperCase() + '</span></button>';
      }).join('') + '</div>';
      h += '<p class="muted" style="font-size:10px;margin:8px 0 0">Tap a card to play it. Do not show anyone your hand.</p>';
    }
    $('#handPanel').innerHTML = h;
  }
  function renderDeck(v) {
    var last = v.discardTop || v.lastCard;
    var h = '<h3>DECK / DISCARD</h3><div class="deckrow"><div class="deckstat"><div><b>' + v.deckCount + '</b>FACE DOWN</div><div><b>' + v.discardCount + '</b>PLAYED</div></div>';
    h += last ? '<img class="lastcard" src="' + last.img + '" alt="' + last.id.toUpperCase() + '" title="' + last.id.toUpperCase() + ' — ' + esc(last.text) + '">' : '<div class="lastcard empty">NO CARD PLAYED</div>';
    h += '</div>';
    if (v.globalFlags && v.globalFlags.length) h += '<p class="muted" style="font-size:10px;margin:8px 0 0">' + esc(v.globalFlags.join(' · ')) + '</p>';
    $('#deckPanel').innerHTML = h;
  }
  function renderCardActivity(v) {
    var box = $('#cardActivity');
    var face = $('#cardActivityFace');
    var text = $('#cardActivityText');
    if (!box || !face || !text) return;
    var c = v.discardTop || v.lastCard;
    if (!c) {
      box.className = 'card-activity empty';
      face.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--mute);font-size:10px">—</div>';
      text.textContent = 'No card played yet.';
      return;
    }
    box.className = 'card-activity';
    face.innerHTML = '<img src="' + c.img + '" alt="' + c.id.toUpperCase() + '" title="' + c.id.toUpperCase() + '">';
    text.textContent = c.id.toUpperCase() + ' · ' + c.text;
  }
  function renderDM(v) {
    var allowed = ui.mode === 'local' || online.seat === 0;
    $('#dmPanel').hidden = !allowed;
    if (!allowed) return;
    var h = '<select id="dmPlayer">' + v.players.map(function (p) {
      return '<option value="' + p.i + '"' + (p.i === v.turnIndex ? ' selected' : '') + '>Player ' + (p.i + 1) + ' — ' + esc(p.name) + '</option>';
    }).join('') + '</select>';
    h += '<input id="dmTile" type="number" min="-9" max="100" value="1" placeholder="Tile number">';
    h += '<div class="dm-grid">' +
      '<button data-dm="settile">SET TILE</button><button data-dm="nemo">TO POINT NEMO</button>' +
      '<button data-dm="p1">+1</button><button data-dm="m1">−1</button>' +
      '<button data-dm="p5">+5</button><button data-dm="m5">−5</button>' +
      '<button data-dm="draw">DRAW A CARD</button><button data-dm="eliminate">ELIMINATE</button>' +
      '<button data-dm="reshuffle">RESHUFFLE</button><button data-dm="reverse">REVERSE ORDER</button>' +
      '<button data-dm="clear">CLEAR RULES</button><button data-dm="end">FORCE END TURN</button>' +
      '</div><button class="dm-wide" data-dm="undo">UNDO LAST ACTION</button>' +
      (v.banner ? '<button class="dm-wide" data-dm="skipbanner">SKIP ACTIVE BANNER</button>' : '') +
      (ui.mode === 'local' && !ui.practiceBot ? '<button class="dm-wide" data-dm="privacy">PASS-THE-DEVICE SCREENS: ' + (ui.noPrivacy ? 'OFF' : 'ON') + '</button>' : '') +
      '<button class="dm-wide" data-dm="new">' + (ui.mode === 'online' ? 'RESET ROOM (HOST)' : 'NEW GAME') + '</button>';
    h += '<p class="muted" style="font-size:10px;margin:8px 0 0">The table has the final say on anything the engine cannot judge.</p>';
    $('#dmControls').innerHTML = h;
  }
  function logCategory(l) {
    var txt = l.text || '';
    if (txt.indexOf('— Round') === 0 || txt.indexOf('rolls again') >= 0 || txt.indexOf('cannot roll') >= 0) return 'Turns';
    if (l.cardId || /\b(bc|gc|vc)\d+\b/i.test(txt) || /card|drew|steals|forfeit|discard/i.test(txt)) return 'Cards';
    return 'Moves';
  }
  function filterLogs(v) {
    var q = ui.logQuery.toLowerCase().trim();
    var arr = (v.log || []).filter(function (l) {
      if (ui.logFilter !== 'All' && logCategory(l) !== ui.logFilter) return false;
      if (q) {
        var hay = ('[' + l.n + '] ' + (l.cardId || '') + ' ' + l.text).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    return ui.logReverse ? arr.slice().reverse() : arr;
  }
  function renderLogLinesHtml(v, interactive) {
    var lines = filterLogs(v);
    if (!lines.length) return '<div class="empty-note" style="padding:12px 0">No matching log entries.</div>';
    return lines.map(function (l) {
      var thumb = l.cardId && C[l.cardId] ? '<img src="' + img(l.cardId) + '" alt="" loading="lazy">' : '';
      var isTurn = l.text.indexOf('— Round') === 0;
      var isHl = ui.highlightedCite === l.n;
      var numEl = interactive
        ? '<span class="ln">[' + l.n + ']</span>'
        : '<button type="button" class="ln-btn" data-openlog-n="' + l.n + '">[' + l.n + ']</button>';
      return '<div class="logline' + (isTurn ? ' turn' : '') + (isHl ? ' hl' : '') + '" data-log-n="' + l.n + '">' +
        numEl + thumb + '<span>' + esc(l.text) + '</span></div>';
    }).join('');
  }
  function renderLog(v) {
    var lines = (v.log || []).slice(-90).reverse();
    $('#logPanel').innerHTML = '<div class="log-head"><h3>LOG</h3><button type="button" class="ghost small" data-openlog>FULL LOG</button></div>' +
      lines.map(function (l) {
        var thumb = l.cardId && C[l.cardId] ? '<img src="' + img(l.cardId) + '" alt="" loading="lazy">' : '';
        return '<div class="logline' + (l.text.indexOf('— Round') === 0 ? ' turn' : '') + '">' +
          '<button type="button" class="ln-btn" data-openlog-n="' + l.n + '">[' + l.n + ']</button>' +
          thumb + '<span>' + esc(l.text) + '</span></div>';
      }).join('');
  }

  /* ---------------- overlays ---------------- */
  function overlayCardFace(c) {
    return '<div class="cardface"><img src="' + c.img + '" alt="' + c.id.toUpperCase() + '"><div class="ftext">' + esc(c.text) + '</div></div>';
  }
  function renderStoryProse(text) {
    var s = String(text || '');
    var out = '', last = 0;
    s.replace(/\[(\d+)\]/g, function (match, num, idx) {
      out += esc(s.slice(last, idx));
      var n = Number(num);
      var on = ui.highlightedCite === n ? ' on' : '';
      out += '<button type="button" class="cite-pill' + on + '" data-cite="' + n + '">[' + n + ']</button>';
      last = idx + match.length;
      return match;
    });
    out += esc(s.slice(last));
    return out;
  }
  function openLogModal(citeN) {
    ui.logModalOpen = true;
    if (citeN != null) {
      ui.highlightedCite = Number(citeN);
      ui.logReverse = false;
      ui.logFilter = 'All';
      ui.logQuery = '';
    }
    var v = currentView();
    if (v && v.log && v.log.length) ui.lastSeenLogN = v.log[v.log.length - 1].n;
    renderOverlay(v);
    renderCardBanner(v);
    if (citeN != null) {
      var row = $('#overlay .logline[data-log-n="' + citeN + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    }
  }
  function renderLogModalHtml(v) {
    var latestN = v.log && v.log.length ? v.log[v.log.length - 1].n : 0;
    if (latestN > ui.lastSeenLogN) ui.lastSeenLogN = latestN;
    var filters = ['All', 'Turns', 'Cards', 'Moves'];
    return '<div class="kicker"><span>MATCH LOG · ' + (v.log ? v.log.length : 0) + ' ENTRIES</span><span>ROUND ' + v.round + '</span></div>' +
      '<h2>GAME LOG</h2>' +
      '<div class="log-toolbar">' +
      '<div class="seg" id="logFilterSeg">' +
      filters.map(function (f) {
        return '<button type="button" data-logfilter="' + f + '"' + (ui.logFilter === f ? ' class="on"' : '') + '>' + f.toUpperCase() + '</button>';
      }).join('') +
      '</div>' +
      '<input id="logModalSearch" value="' + esc(ui.logQuery) + '" placeholder="Search card, player, or #number">' +
      '<button type="button" class="ghost small" data-logorder>' + (ui.logReverse ? 'NEWEST FIRST' : 'OLDEST FIRST') + '</button>' +
      '</div>' +
      '<div id="logModalList" class="log-scroll">' + renderLogLinesHtml(v, true) + '</div>' +
      '<div class="actions"><button type="button" class="primary" data-closelog>CLOSE LOG</button></div>';
  }
  function renderBannerHtml(v) {
    var b = v.banner;
    var kickerLeft = b.kind === 'out' ? 'PLAYER OUT' : (b.private ? 'PRIVATE CARD' : 'CARD EFFECT');
    var kickerRight = (v.bannersCount && v.bannersCount > 1) ? ('1 OF ' + v.bannersCount) : '';
    var pendingNames = (b.pendingPids || []).map(function (pid) {
      return v.players[pid] ? v.players[pid].name : 'Player ' + (pid + 1);
    }).join(', ');
    var bodyHtml = '';
    if (b.card) {
      bodyHtml = overlayCardFace(b.card) + '<p>' + esc(b.text) + '</p>';
    } else if (b.cardId && C[b.cardId]) {
      bodyHtml = '<div class="cardface"><img src="' + esc(C[b.cardId].img) + '" alt="' + esc(b.cardId.toUpperCase()) + '"><div class="ftext">' + esc(b.text) + '</div></div>';
    } else {
      bodyHtml = '<p>' + esc(b.text) + '</p>';
    }
    if (b.detail) bodyHtml += '<p class="muted">' + esc(b.detail) + '</p>';
    var btnHtml = v.canAckBanner
      ? '<button type="button" class="primary" data-ackbanner>CONTINUE</button>'
      : '<button type="button" class="ghost" disabled>WAITING FOR ' + esc(pendingNames || 'PLAYER') + '</button>';
    return '<div class="kicker"><span>' + kickerLeft + '</span>' + (kickerRight ? '<span>' + kickerRight + '</span>' : '') + '</div>' +
      '<h2>' + esc(b.title || 'NOTICE') + '</h2>' +
      bodyHtml +
      '<div class="actions">' + btnHtml + '<button type="button" class="ghost" data-openlog>LOG</button></div>';
  }
  function renderRevealHtml(v) {
    var r = v.reveal, owner = v.players[r.pid] ? v.players[r.pid].name : 'the player';
    var items = revealItems(r);
    var hasJazz = !!(r.jazz || items.some(function (it) { return it.jazz; }));
    var body = '';
    if (items.length <= 1) {
      var it = items[0] || { card: r.card, text: r.text, kept: r.kept };
      if (!it.card || it.secret) {
        body = '<div class="kicker">DRAWN CARD · SECRET</div><h2>SECRET CARD</h2>' +
          '<p>' + esc(it.text || 'Kept secret in hand.') + '</p>' +
          (it.statusNote ? '<div class="status-note">' + esc(it.statusNote) + '</div>' : '');
      } else {
        body = '<div class="kicker">DRAWN CARD · ' + it.card.type.toUpperCase() + ' · ' + (it.kept ? 'KEPT IN HAND' : 'PLAYED IMMEDIATELY') + '</div>' +
          '<h2>' + it.card.id.toUpperCase() + '</h2>' + overlayCardFace(it.card) +
          (it.statusNote ? '<div class="status-note">' + esc(it.statusNote) + '</div>' : '');
      }
    } else {
      body = '<div class="kicker"><span>DRAWN CARDS · ' + items.length + ' CARDS</span><span>' + esc(owner.toUpperCase()) + '</span></div>' +
        '<h2>DREW ' + items.length + ' CARDS</h2>' +
        '<div class="reveal-grid">' + items.map(function (it) {
          if (!it.card || it.secret) {
            return '<div class="rcard secret"><div class="rcard-id">SECRET CARD</div>' +
              '<div class="rcard-text">' + esc(it.text || 'Kept secret in hand.') + '</div>' +
              (it.statusNote ? '<div class="rcard-note">' + esc(it.statusNote) + '</div>' : '') + '</div>';
          }
          return '<div class="rcard">' +
            '<div class="rcard-top"><img src="' + esc(it.card.img) + '" alt="' + esc(it.card.id.toUpperCase()) + '">' +
            '<div class="rcard-meta"><div class="rcard-id">' + esc(it.card.id.toUpperCase()) + '</div>' +
            '<div class="rcard-type">' + esc(it.card.type.toUpperCase()) + '</div>' +
            '<span class="rcard-badge">' + (it.kept ? 'KEPT IN HAND' : 'RESOLVES NEXT') + '</span></div></div>' +
            '<div class="rcard-text">' + esc(it.card.text) + '</div>' +
            (it.statusNote ? '<div class="rcard-note">' + esc(it.statusNote) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
    }
    return {
      wide: items.length > 1,
      html: body +
        (hasJazz ? '<div style="margin-top:10px"><button type="button" class="ghost" data-jazz>PLAY JAZZ (GC25)</button></div>' : '') +
        '<div class="actions">' +
        (v.canAck ? '<button type="button" class="primary" data-ack>CONTINUE</button>' : '<button type="button" class="ghost" disabled>WAITING FOR ' + esc(owner) + '</button>') +
        '<button type="button" class="ghost" data-openlog>LOG</button></div>'
    };
  }
  function renderGameOverHtml(v) {
    var w = v.winner == null ? null : v.players[v.winner];
    var story = v.winStory;
    var partsHtml = story && story.parts
      ? '<p class="win-prose">' + story.parts.map(function (pt) { return renderStoryProse(pt.text); }).join(' ') + '</p>'
      : '<p>' + esc(v.endReason || 'The game has ended.') + '</p>';

    var citedHtml = '';
    if (story && story.citedLogs && story.citedLogs.length) {
      citedHtml = '<div class="cite-list">' + story.citedLogs.map(function (l) {
        var on = ui.highlightedCite === l.n ? ' on' : '';
        var thumb = l.cardId && C[l.cardId] ? '<img src="' + esc(C[l.cardId].img) + '" alt="">' : '';
        return '<button type="button" class="cite-item' + on + '" data-cite="' + l.n + '">' +
          '<span class="ln">[' + l.n + ']</span>' + thumb +
          '<span class="ct">' + esc(l.text) + '</span></button>';
      }).join('') + '</div>';
    }
    var seqExtra = '';
    if (w && w.seq === 3) {
      seqExtra = '<div class="seqsteps">3 → 7 → 13 (completed on separate turns)</div>';
    }
    var explainHeading = w ? ('WHY ' + w.name.toUpperCase() + ' WON') : 'WHY THE GAME ENDED';
    return '<div class="kicker">GAME OVER</div>' +
      '<h2>' + esc(story ? story.headline : (w ? w.name + ' WINS' : 'NO ONE WINS')) + '</h2>' +
      '<div class="seqbreak win-story">' +
      '<h3><span>' + esc(explainHeading) + '</span><button type="button" class="ghost small" data-openlog>FULL MATCH LOG</button></h3>' +
      seqExtra + partsHtml + citedHtml +
      '</div>' +
      '<p class="muted">Tap any bracketed number like [1] to highlight the exact log event below, or open the full match log.</p>' +
      '<div class="actions">' +
      '<button type="button" class="primary" data-newgame>NEW GAME</button>' +
      '<button type="button" class="ghost" data-menu>BACK TO MENU</button></div>';
  }
  function renderOverlay(v) {
    var ov = $('#overlay');
    if (!v) { ov.hidden = true; ov.innerHTML = ''; ov.classList.remove('passive', 'privacy-screen'); return; }
    if (ui.mode === 'local' && (ui.noPrivacy || ui.practiceBot || v.phase === 'gameover')) ui.privacySeat = focusSeat();
    var needPrivacy = (ui.mode === 'local' && !ui.noPrivacy && !ui.practiceBot && v.phase !== 'gameover' && ui.privacySeat !== focusSeat());

    // Keep search input focus alive while updating the Log Modal during polls/searches.
    if (ui.logModalOpen && !needPrivacy && !(v.banner && v.banner.kind === 'out') && ov.querySelector('#logModalSearch') && ov.querySelector('#logModalList')) {
      ov.querySelector('#logModalList').innerHTML = renderLogLinesHtml(v, true);
      var latestN = v.log && v.log.length ? v.log[v.log.length - 1].n : 0;
      if (latestN > ui.lastSeenLogN) ui.lastSeenLogN = latestN;
      return;
    }

    var h = '', cls = 'modal', passive = false, privacy = false;

    if (v.banner && v.banner.kind === 'out') {
      cls = 'modal banner';
      h = renderBannerHtml(v);
    } else if (ui.logModalOpen && !needPrivacy) {
      cls = 'modal wide log-modal';
      h = renderLogModalHtml(v);
    } else if (v.phase === 'gameover') {
      cls = 'modal wide';
      h = renderGameOverHtml(v);
    } else if (ui.confirmCard) {
      var c = ui.confirmCard;
      h = '<div class="kicker">PLAY A CARD · ' + c.type.toUpperCase() + '</div><h2>' + c.id.toUpperCase() + '</h2>' + overlayCardFace(c) +
        '<p>Playing resolves its effect and the card goes to the discard pile.</p><div class="actions">' +
        '<button type="button" class="primary" data-playconfirm>PLAY</button><button type="button" class="ghost" data-cancelconfirm>CANCEL</button></div>';
    } else if (needPrivacy) {
      ui.logModalOpen = false;
      var f = focusSeat(), nm = v.players[f] ? v.players[f].name : 'Player ' + (f + 1);
      privacy = true;
      h = '<div class="frame"><div class="kicker">PASS THE DEVICE</div>' +
        '<div class="pnum">' + (f + 1) + '</div><h2>' + esc(nm) + '</h2>' +
        '<p>The board and every hand stay hidden until you confirm it is your turn. Make sure nobody else can see the screen.</p>' +
        '<button type="button" class="primary" data-privacy>I’M ' + esc(nm) + ' — REVEAL</button>' +
        '<div class="hint">PRESS ENTER, OR TAP ANYWHERE ON THIS SCREEN</div>' +
        '<button type="button" class="skip" data-noprivacy>TURN OFF THESE SCREENS FOR THIS DEVICE</button></div>';
      cls = 'modal privacy';
    } else if (v.banner) {
      cls = 'modal banner';
      h = renderBannerHtml(v);
    } else if (v.lastElimination) {
      var le = v.lastElimination;
      h = '<div class="kicker">PLAYER OUT</div><h2>' + esc(le.name) + ' IS OUT</h2>' +
        '<p><strong>Why:</strong> ' + esc(le.reason) + '</p>' +
        '<p>Last tile: ' + (le.tile < 0 ? '−' + Math.abs(le.tile) : le.tile) + ' · Cards in hand when out: ' + le.handCount + '</p>' +
        '<div class="actions"><button type="button" class="primary" data-ackelim>CONTINUE</button></div>';
      cls = 'modal banner';
    } else if (v.reveal) {
      var rev = renderRevealHtml(v);
      cls = rev.wide ? 'modal wide' : 'modal';
      h = rev.html;
    } else if (v.prompt && v.canAnswer) {
      var p = v.prompt;
      h = '<div class="kicker"><span>' + (p.cardId ? p.cardId.toUpperCase() + ' · ' : '') + 'DECISION</span></div><h2>' + esc(p.title) + '</h2><p>' + esc(p.text) + '</p>';
      if (p.peek && p.peek.length) h += '<div class="peek">' + p.peek.map(function (c) { return '<img src="' + c.img + '" title="' + c.id.toUpperCase() + ' — ' + esc(c.text) + '">'; }).join('') + '</div>';
      h += '<div class="optlist">' + p.options.map(function (o, i) {
        return '<button type="button" class="opt" data-opt="' + i + '"' + (o.disabled ? ' disabled' : '') + '>' +
          (o.img ? '<img src="' + o.img + '" alt="">' : '') + '<span class="ol">' + esc(o.label) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="actions"><button type="button" class="ghost" data-openlog>LOG</button></div>';
    } else if (v.waiting) {
      h = '<div class="kicker">WAITING</div><h2>' + esc(v.waiting.name) + '</h2><p>' + esc(v.waiting.title || 'is looking at a card. Hands stay private until they are done.') + '</p>';
      cls = 'modal banner'; passive = true;
    }
    if (!h) { ov.hidden = true; ov.innerHTML = ''; ov.classList.remove('passive', 'privacy-screen'); return; }
    ov.hidden = false;
    ov.classList.toggle('passive', passive);
    ov.classList.toggle('privacy-screen', privacy);
    ov.innerHTML = '<div class="' + cls + '">' + h + '</div>';
  }

  /* ---------------- card index ---------------- */
  function renderCards() {
    var q = ui.cardQuery.toLowerCase().trim();
    var list = E.CARD_IDS.filter(function (id) {
      var c = C[id];
      if (ui.cardFilter !== 'All' && c.type !== ui.cardFilter) return false;
      if (q && (id + ' ' + c.text + ' ' + c.type).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    $('#cardCount').textContent = list.length + ' / 108';
    $('#cardGrid').innerHTML = list.map(function (id) {
      var c = C[id];
      return '<div class="carditem"><img src="' + c.img + '" alt="' + id.toUpperCase() + '" loading="lazy">' +
        '<div class="cid"><span>' + id.toUpperCase() + '</span><span>' + c.type.toUpperCase() + '</span></div>' +
        '<div class="ct">' + esc(c.text) + '</div></div>';
    }).join('');
  }

  /* ---------------- events ---------------- */
  function bind() {
    $('#nav').addEventListener('click', function (e) {
      var b = e.target.closest('.nav-btn'); if (b) go(b.dataset.screen);
    });
    $('#brandBtn').addEventListener('click', function () { if (ui.mode !== 'menu') go('game'); else go('setup'); });
    $('#jazzBtn').addEventListener('click', function () { toggleJazz(); });
    $('#invertBtn').addEventListener('click', function () {
      ui.light = !ui.light; document.body.classList.toggle('light', ui.light);
      $('#invertBtn').textContent = ui.light ? 'BLACK' : 'INVERT';
      savePrefs();
    });

    // menu: local
    $('#localPlayers').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#localPlayers button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ui.localPlayers = Number(b.dataset.n); renderNames();
    });
    $('#onlinePlayers').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#onlinePlayers button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ui.onlinePlayers = Number(b.dataset.n);
    });
    $('#startLocal').addEventListener('click', function () { startLocal(false); });
    $('#resumeLocal').addEventListener('click', function () { startLocal(true); });
    $('#practiceBots').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#practiceBots button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    });
    $('#startPractice').addEventListener('click', function () { startPractice(); });

    // menu: online
    $('#createRoom').addEventListener('click', createRoom);
    $('#joinRoom').addEventListener('click', joinRoom);
    $('#startOnline').addEventListener('click', function () { postAction({ type: 'START' }); });
    $('#copyLink').addEventListener('click', function () { copyText(linkFor(online.code)); });
    $('#copyGameLink').addEventListener('click', function () { copyText(gameUrl()); });
    $('#roomLinkText').addEventListener('click', function () { copyText(linkFor(online.code)); });
    $('#leaveRoom').addEventListener('click', leaveRoom);
    $('#partySize').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#partySize button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var n = Number(b.dataset.n);
      postAction({ type: 'SET_CONFIG', cfg: { players: n } });
    });
    $('#roomSeats').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kick]'); if (!b) return;
      kickPlayer(Number(b.dataset.kick));
    });

    // game: turn panel & mobile bar
    function turnButton(b) {
      if (!b) return;
      if (b.dataset.openlog !== undefined) { openLogModal(); renderMobileBar(currentView()); return; }
      if (b.dataset.jumphand !== undefined) {
        var hp = $('#handPanel');
        if (hp && hp.scrollIntoView) hp.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (b.dataset.roll !== undefined) act({ type: 'ROLL' });
      else if (b.dataset.manual) act({ type: 'ROLL', value: Number(b.dataset.manual) });
      else if (b.dataset.end !== undefined) act({ type: 'END_TURN' });
      else if (b.dataset.undo !== undefined) act({ type: 'UNDO' });
    }
    function onTurnClick(e) { turnButton(e.target.closest('button')); }
    $('#turnPanel').addEventListener('click', onTurnClick);
    $('#mobileBar').addEventListener('click', onTurnClick);
    var boardLogBtn = $('#boardLogBtn');
    if (boardLogBtn) boardLogBtn.addEventListener('click', function () { openLogModal(); });

    // sidebar log
    $('#logPanel').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.openlogN !== undefined) openLogModal(Number(b.dataset.openlogN));
      else if (b.dataset.openlog !== undefined) openLogModal();
    });

    // persistent card banner
    $('#cardBanner').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dismissCb !== undefined) { shiftCardBanner(); }
      else if (b.dataset.openlog !== undefined) { openLogModal(); }
    });

    // hand
    $('#handPanel').addEventListener('click', function (e) {
      var b = e.target.closest('[data-card]'); if (!b) return;
      var v = currentView(); if (!v || !v.you) return;
      if (ui.practiceBot && v.yourSeat !== v.turnIndex) { toast('WAIT FOR YOUR TURN'); return; }
      var c = v.you.hand.find(function (x) { return x.uid === Number(b.dataset.card); });
      if (c) { ui.confirmCard = c; renderOverlay(v); }
    });
    // dm
    $('#dmControls').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dm]'); if (!b) return;
      var pid = Number($('#dmPlayer').value), tile = Number($('#dmTile').value) || 1;
      var k = b.dataset.dm;
      if (k === 'settile') act({ type: 'DM_SET_TILE', pid: pid, tile: tile });
      else if (k === 'nemo') act({ type: 'DM_NEMO', pid: pid });
      else if (k === 'p1') act({ type: 'DM_MOVE', pid: pid, delta: 1 });
      else if (k === 'm1') act({ type: 'DM_MOVE', pid: pid, delta: -1 });
      else if (k === 'p5') act({ type: 'DM_MOVE', pid: pid, delta: 5 });
      else if (k === 'm5') act({ type: 'DM_MOVE', pid: pid, delta: -5 });
      else if (k === 'draw') act({ type: 'DM_DRAW', pid: pid, count: 1 });
      else if (k === 'eliminate') act({ type: 'DM_ELIMINATE', pid: pid });
      else if (k === 'reshuffle') act({ type: 'DM_RESHUFFLE' });
      else if (k === 'reverse') act({ type: 'DM_REVERSE' });
      else if (k === 'clear') act({ type: 'DM_CLEAR_RULES' });
      else if (k === 'end') act({ type: 'DM_END_TURN' });
      else if (k === 'skipbanner') act({ type: 'DM_SKIP_BANNER' });
      else if (k === 'undo') act({ type: 'UNDO' });
      else if (k === 'privacy') {
        ui.noPrivacy = !ui.noPrivacy; savePrefs();
        ui.privacySeat = ui.noPrivacy ? focusSeat() : null;
        toast(ui.noPrivacy ? 'PASS-THE-DEVICE SCREENS OFF' : 'PASS-THE-DEVICE SCREENS ON');
        render();
      }
      else if (k === 'new') {
        if (ui.mode === 'online') postAction({ type: 'RESET' });
        else if (ui.practiceBot) startPractice();
        else startLocal(false);
      }
    });

    // overlay search input (live update without losing focus)
    $('#overlay').addEventListener('input', function (e) {
      if (e.target && e.target.id === 'logModalSearch') {
        ui.logQuery = e.target.value;
        var listEl = $('#overlay #logModalList');
        var v = currentView();
        if (listEl && v) listEl.innerHTML = renderLogLinesHtml(v, true);
      }
    });

    // overlay clicks
    $('#overlay').addEventListener('click', function (e) {
      var isPrivacy = $('#overlay').classList.contains('privacy-screen');
      var b = e.target.closest('button');
      if (!b) { if (isPrivacy) { ui.privacySeat = focusSeat(); render(); } return; }
      if (b.dataset.noprivacy !== undefined) {
        ui.noPrivacy = true; savePrefs(); ui.privacySeat = focusSeat();
        toast('PASS-THE-DEVICE SCREENS OFF'); render(); return;
      }
      if (isPrivacy && b.dataset.privacy === undefined) { ui.privacySeat = focusSeat(); render(); return; }
      var v = currentView();
      if (b.dataset.privacy !== undefined) { ui.privacySeat = focusSeat(); render(); }
      else if (b.dataset.openlog !== undefined) { openLogModal(); }
      else if (b.dataset.closelog !== undefined) { ui.logModalOpen = false; renderOverlay(v); renderCardBanner(v); }
      else if (b.dataset.logfilter !== undefined) {
        ui.logFilter = b.dataset.logfilter;
        $$('#overlay #logFilterSeg button').forEach(function (x) { x.classList.toggle('on', x.dataset.logfilter === ui.logFilter); });
        var listEl = $('#overlay #logModalList');
        if (listEl && v) listEl.innerHTML = renderLogLinesHtml(v, true);
      }
      else if (b.dataset.logorder !== undefined) {
        ui.logReverse = !ui.logReverse;
        b.textContent = ui.logReverse ? 'NEWEST FIRST' : 'OLDEST FIRST';
        var listEl2 = $('#overlay #logModalList');
        if (listEl2 && v) listEl2.innerHTML = renderLogLinesHtml(v, true);
      }
      else if (b.dataset.cite !== undefined) {
        var citeN = Number(b.dataset.cite);
        if (ui.highlightedCite === citeN) {
          openLogModal(citeN);
        } else {
          ui.highlightedCite = citeN;
          renderOverlay(v);
          var item = $('#overlay .cite-item[data-cite="' + citeN + '"]');
          if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
        }
      }
      else if (b.dataset.ackbanner !== undefined) { act({ type: 'ACK_BANNER' }); }
      else if (b.dataset.ackelim !== undefined) { act({ type: 'ACK_ELIM' }); render(); }
      else if (b.dataset.ack !== undefined) act({ type: 'ACK' });
      else if (b.dataset.jazz !== undefined) toggleJazz(true);
      else if (b.dataset.opt !== undefined && v && v.prompt) {
        var o = v.prompt.options[Number(b.dataset.opt)];
        if (o && !o.disabled) act({ type: 'ANSWER', value: o.value });
      }
      else if (b.dataset.playconfirm !== undefined) {
        var c = ui.confirmCard; ui.confirmCard = null;
        if (c) act({ type: 'PLAY_CARD', uid: c.uid });
      }
      else if (b.dataset.cancelconfirm !== undefined) { ui.confirmCard = null; render(); }
      else if (b.dataset.newgame !== undefined) {
        if (ui.mode === 'online') postAction({ type: 'RESET' });
        else if (ui.practiceBot) startPractice();
        else startLocal(false);
      }
      else if (b.dataset.menu !== undefined) {
        stopBots(); pollGeneration++;
        clearCardBanners();
        ui.logModalOpen = false; ui.highlightedCite = null;
        ui.practiceBot = false; ui.prevState = null;
        ui.mode = 'menu'; ui.screen = 'setup';
        render();
      }
    });

    // card index
    $('#cardFilter').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#cardFilter button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ui.cardFilter = b.dataset.f; renderCards();
    });
    $('#cardSearch').addEventListener('input', function (e) { ui.cardQuery = e.target.value; renderCards(); });

    // keyboard: 1-6 manual dice, enter to continue
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (ui.logModalOpen && e.key === 'Escape') {
        e.preventDefault(); ui.logModalOpen = false; var vEsc = currentView(); renderOverlay(vEsc); renderCardBanner(vEsc); return;
      }
      if ($('#overlay').classList.contains('privacy-screen') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); ui.privacySeat = focusSeat(); render(); return;
      }
      var v = currentView();
      if (!ui.logModalOpen && v && (e.key === 'Enter' || e.key === ' ')) {
        if (v.banner && v.canAckBanner) { e.preventDefault(); act({ type: 'ACK_BANNER' }); return; }
        if (v.reveal && v.canAck) { e.preventDefault(); act({ type: 'ACK' }); return; }
      }
    });
  }

  function init() {
    bind();
    renderNames();
    renderShareLine();
    try {
      ui.light = localStorage.getItem('vusal.light') === '1';
      ui.noPrivacy = localStorage.getItem('vusal.noPrivacy') === '1';
    } catch (e) {}
    document.body.classList.toggle('light', ui.light);
    $('#optPrivacy').checked = ui.noPrivacy;
    $('#invertBtn').textContent = ui.light ? 'BLACK' : 'INVERT';
    var params = new URLSearchParams(location.search);
    if (params.get('room')) { $('#joinCode').value = params.get('room').toUpperCase(); $('#joinName').focus(); }
    if (!/^https?:$/.test(location.protocol)) {
      var note = document.createElement('p');
      note.className = 'muted';
      note.style.cssText = 'font-size:11px;margin-top:14px;border-top:1px solid var(--line2);padding-top:10px';
      note.textContent = 'Standalone file: PASS & PLAY works offline. ONLINE ROOMS need the server build (npm start). For different houses, tunnel or deploy it — see DEPLOY.md in the full-game ZIP.';
      $('#onlineForms').appendChild(note);
    }
    go('setup');
  }
  init();
})();
