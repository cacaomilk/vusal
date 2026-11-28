/* VUSAL — very unfair snakes and ladders
 * Shared rules engine. Runs in the browser (pass & play) and on the Node server (online rooms).
 * Pure state, no DOM. All state is JSON-serialisable.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards_data.js'));
  else root.VusalEngine = factory(root.VUSAL_CARDS);
})(typeof self !== 'undefined' ? self : globalThis, function (CARDS) {
  'use strict';

  var SNAKES = { 17: 14, 46: 27, 73: 63, 84: 68, 99: 1, 13: -1 };
  var LADDERS = { 14: 40, 21: 33, 28: 34, 57: 79, 62: 90 };
  var LADDER_TOPS = [40, 33, 34, 79, 90];
  var BOARD_GRID = [
    [91, 92, 93, 94, 95, 96, 97, 98, 99, 100],
    [90, 89, 88, 87, 86, 85, 84, 83, 82, 81],
    [71, 72, 73, 74, 75, 76, 77, 78, 79, 80],
    [70, 69, 68, 67, 66, 65, 64, 63, 62, 61],
    [51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
    [50, 49, 48, 47, 46, 45, 44, 43, 42, 41],
    [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
    [30, 29, 28, 27, 26, 25, 24, 23, 22, 21],
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0]
  ];
  var ALPHA_MAP = { 1: 5, 2: 4, 3: 1, 4: 6, 5: 3, 6: 2 };
  var STICKY = ['bc2', 'bc7', 'bc14', 'vc25'];
  var PASSIVE_GOOD = ['gc6', 'gc8', 'gc11', 'gc13', 'gc20', 'gc21', 'gc24', 'gc33'];
  var IMMEDIATE_GOOD = ['gc10', 'gc25'];
  var INSTANT_RESULT = ['gc10', 'bc30', 'vc20'];
  var CARD_IDS = Object.keys(CARDS);

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function ri(n) { return Math.floor(Math.random() * n); }
  function d6() { return 1 + ri(6); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = ri(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function typeOf(id) { return CARDS[id] ? CARDS[id].type : null; }
  function label(id) { return String(id == null ? '' : id).toUpperCase(); }
  function N(state) { return state.players.length; }
  function P(state, pid) { return state.players[pid]; }
  function cur(state) { return state.players[state.turnIndex]; }
  function nextSeat(state, pid) { return (pid + state.direction + N(state) * 2) % N(state); }
  function nextAliveSeat(state, pid) {
    var n = N(state);
    for (var k = 1; k <= n; k++) {
      var s = (pid + k * state.direction + n * 2) % n;
      if (P(state, s) && P(state, s).alive) return s;
    }
    return nextSeat(state, pid);
  }
  function cardView(c) {
    if (!c) return null;
    var known = !!CARDS[c.id];
    return {
      uid: c.uid, id: c.id,
      img: known ? CARDS[c.id].img : '',
      text: known ? CARDS[c.id].text : '',
      type: typeOf(c.id),
      sticky: !!c.sticky, playable: c.playable !== false, passive: !!c.passive
    };
  }

  function log(state, text, cardId) {
    state.nextLogN = (state.nextLogN || (state.log.length ? state.log[state.log.length - 1].n : 0)) + 1;
    var n = state.nextLogN;
    state.log.push({ n: n, text: text, cardId: cardId || null });
    if (state.log.length > 600) state.log.splice(0, state.log.length - 600);
    return n;
  }
  function milestone(state, type, data) {
    if (!state.milestones) state.milestones = [];
    state.milestones.push(Object.assign({ type: type, round: state.round }, data || {}));
    if (state.milestones.length > 260) {
      // Preserve earliest start, sequence milestones, eliminations, and finals if trimming very long games.
      var keep = [];
      for (var i = 0; i < state.milestones.length; i++) {
        var m = state.milestones[i];
        if (i === 0 || m.type === 'seq' || m.type === 'elim' || m.type === 'win' || m.type === 'no_win' || i >= state.milestones.length - 180) {
          keep.push(m);
        }
      }
      state.milestones = keep;
    }
  }
  function nameOf(state, pid) { return P(state, pid) ? (P(state, pid).name || 'Player ' + (pid + 1)) : 'Player ' + (pid + 1); }

  function pushBanner(state, o) {
    if (!state.banners) state.banners = [];
    var seen = {};
    var pids = (o.pendingPids || []).filter(function (pid) {
      if (typeof pid !== 'number' || !P(state, pid) || seen[pid]) return false;
      seen[pid] = true;
      return true;
    });
    if (!pids.length) return null;
    var b = {
      id: state.nextUid++,
      kind: o.kind || 'effect',
      cardId: o.cardId || null,
      card: o.card || null,
      cards: o.cards || null,
      title: o.title || 'CARD NOTICE',
      text: o.text || '',
      detail: o.detail || '',
      actor: o.actor != null ? o.actor : null,
      private: !!o.private,
      pendingPids: pids,
      allPids: pids.slice()
    };
    state.banners.push(b);
    return b;
  }

  function makePlayer(i, name) {
    return {
      i: i, name: name || ('Player ' + (i + 1)),
      tile: 1, alive: true, hand: [],
      status: { skipTurns: 0, skipUntilRound: 0, needSix: false, nextCardType: null,
                alphabeticalUntilRound: 0, extraRolls: 0, badImmuneRolls: 0,
                nextCardGiveToNext: false, curseTile: null },
      history: [1], prevTile: 1, lastRoll: 0, seq: 0, seqTurn: -1, drawnTypes: [], drewThisTurn: false
    };
  }
  function newGame(cfg) {
    cfg = cfg || {};
    var n = clamp(cfg.players || 2, 1, 4);
    var players = [];
    for (var i = 0; i < n; i++) {
      players.push(makePlayer(i, (cfg.names && cfg.names[i]) || ('Player ' + (i + 1))));
    }
    return {
      version: 1,
      cfg: { players: n, exactFinish: cfg.exactFinish !== false, sequenceWin: cfg.sequenceWin !== false,
             manualDice: !!cfg.manualDice, showMarkers: !!cfg.showMarkers, online: !!cfg.online,
             practiceBot: !!cfg.practiceBot },
      phase: 'lobby', gameover: false, winner: null, endReason: '',
      players: players,
      turnIndex: 0, direction: 1, turnCount: 0, round: 1,
      deck: [], discard: [], curses: {}, flags: {}, watchers: [],
      queue: [], reveal: null, prompt: null, banners: [], lastCard: null,
      canEndTurn: false, rolledThisTurn: false, turnStartTile: 1,
      lastDieRaw: null, lastDie: null, jazzCue: false,
      log: [], nextLogN: 0, milestones: [], nextUid: 1, history: [], lastElimination: null
    };
  }

  function makeCard(state, id) { return { uid: state.nextUid++, id: id, meta: {} }; }
  function cardObj(state, id) { return makeCard(state, id); }

  function startGame(state) {
    if (state.phase !== 'lobby') return;
    state.deck = shuffle(CARD_IDS.map(function (id) { return makeCard(state, id); }));
    state.discard = [];
    state.phase = 'turn';
    state.turnIndex = 0;
    var sn = log(state, 'A new game begins. 108 cards shuffled. Everyone starts on tile 1.');
    milestone(state, 'start', { n: sn });
    beginTurn(state);
  }

  /* ---------- state helpers ---------- */
  function hasCard(state, pid, id) {
    return P(state, pid).hand.some(function (c) { return c.id === id; });
  }
  function findHandCard(state, pid, uid) {
    return P(state, pid).hand.find(function (c) { return c.uid === uid; });
  }
  function pluckCard(state, pid, uid) {
    var h = P(state, pid).hand, idx = -1;
    for (var i = 0; i < h.length; i++) if (h[i].uid === uid) { idx = i; break; }
    return idx < 0 ? null : h.splice(idx, 1)[0];
  }
  function addHand(state, pid, card) { P(state, pid).hand.push(card); }
  function discardCard(state, card) {
    card.sticky = false; card.passive = false; card.playable = true;
    state.discard.push(card);
    state.lastCard = cardView(card);
  }
  function reshuffle(state) {
    if (!state.discard.length) return;
    state.discard.forEach(function (c) { c.meta = {}; c.sticky = false; c.passive = false; c.playable = true; });
    state.deck = state.deck.concat(shuffle(state.discard.splice(0)));
    log(state, 'Discard pile shuffled back into the deck.');
  }
  function takeFromDeck(state, count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      if (!state.deck.length) reshuffle(state);
      if (!state.deck.length) break;
      out.push(state.deck.pop());
    }
    return out;
  }
  function takeBadFromDeck(state) {
    for (var i = state.deck.length - 1; i >= 0; i--) {
      if (typeOf(state.deck[i].id) === 'Bad') return state.deck.splice(i, 1)[0];
    }
    reshuffle(state);
    for (var j = state.deck.length - 1; j >= 0; j--) {
      if (typeOf(state.deck[j].id) === 'Bad') return state.deck.splice(j, 1)[0];
    }
    return null;
  }
  function returnHandToDeck(state, pid) {
    var p = P(state, pid);
    p.hand.forEach(function (c) { c.meta = {}; c.sticky = false; c.passive = false; c.playable = true; });
    state.deck = state.deck.concat(p.hand.splice(0));
    shuffle(state.deck);
  }
  function discardHand(state, pid, filter) {
    var p = P(state, pid), kept = [];
    p.hand.forEach(function (c) {
      if (!filter || filter(c)) { discardCard(state, c); } else kept.push(c);
    });
    p.hand = kept;
  }
  function transferCard(state, fromPid, toPid, card) {
    if (!card || fromPid === toPid) return;
    var curse = card.meta && card.meta.cursedWith;
    addHand(state, toPid, card);
    if (curse) {
      delete card.meta.cursedWith;
      var cn = log(state, label(card.id) + ' was cursed — the hidden ' + label(curse.id) + ' triggers on ' + nameOf(state, toPid) + '.', curse.id);
      milestone(state, 'curse_hit', { n: cn, pid: toPid, cardId: curse.id, tile: P(state, toPid).tile });
      state.queue.push({ t: 'banner', banner: {
        kind: 'effect', cardId: curse.id, card: cardView(curse),
        title: 'CURSED CARD — ' + label(curse.id),
        text: label(card.id) + ' was cursed! The hidden ' + label(curse.id) + ' triggers on ' + nameOf(state, toPid) + '.',
        actor: fromPid, pendingPids: [toPid]
      } });
      state.queue.push({ t: 'apply', card: curse, pid: toPid, fromPid: 'curse' });
    }
  }
  function handGood(state, pid) { return P(state, pid).hand.filter(function (c) { return typeOf(c.id) === 'Good'; }); }
  function globalBannerPids(state, actor) {
    if (state.cfg.practiceBot) return [0];
    if (state.cfg.online) {
      var alive = state.players.filter(function (q) { return q.alive; }).map(function (q) { return q.i; });
      return alive.length ? alive : [0];
    }
    return [actor != null ? actor : state.turnIndex];
  }
  function elimBannerPids(state, pid) {
    if (state.cfg.practiceBot) return [0];
    if (state.cfg.online) {
      return state.players.filter(function (q) { return q.alive || q.i === pid; }).map(function (q) { return q.i; });
    }
    return [state.turnIndex];
  }

  /* ---------- movement / landing ---------- */
  function setRawTile(state, pid, tile) {
    var p = P(state, pid);
    tile = clamp(Math.round(tile), -9, 100);
    if (p.tile === tile) return;
    p.prevTile = p.tile;
    p.tile = tile;
    p.history.push(tile);
    if (p.history.length > 60) p.history.shift();
  }
  function setTile(state, pid, tile, opts) {
    opts = opts || {};
    tile = clamp(Math.round(tile), -9, 100);
    setRawTile(state, pid, tile);
    if (opts.landing !== false) checkLanding(state, pid, opts);
  }
  function moveBy(state, pid, delta, fromPid, opts) {
    var p = P(state, pid), amt = Math.abs(delta);
    if (delta < 0 && fromPid != null && fromPid !== pid &&
        (hasCard(state, pid, 'gc24') || hasCard(state, pid, 'gc6'))) {
      var rn = log(state, nameOf(state, pid) + ' reflects the drag back onto ' + nameOf(state, fromPid) + '.');
      milestone(state, 'reflect', { n: rn, pid: pid, target: fromPid });
      pushBanner(state, {
        kind: 'effect', cardId: hasCard(state, pid, 'gc24') ? 'gc24' : 'gc6',
        title: 'DRAG REFLECTED',
        text: nameOf(state, pid) + ' reflected the −' + amt + ' move back onto ' + nameOf(state, fromPid) + '.',
        actor: pid, pendingPids: state.cfg.practiceBot ? [0] : [fromPid, pid]
      });
      moveBy(state, fromPid, -amt, null, opts);
      return;
    }
    setTile(state, pid, p.tile + delta, Object.assign({ landing: true }, opts || {}));
  }
  function forward(state, pid, n, opts) { moveBy(state, pid, Math.abs(n), null, opts); }
  function back(state, pid, n, fromPid, opts) { moveBy(state, pid, -Math.abs(n), fromPid == null ? null : fromPid, opts); }
  function toNemo(state, pid, cardId) {
    setRawTile(state, pid, -1);
    var nn = log(state, nameOf(state, pid) + ' is sent to Point Nemo (tile −1). No cards can be drawn there.', cardId || null);
    milestone(state, 'nemo_in', { n: nn, pid: pid, cardId: cardId || null });
  }

  function instantBlocked(state) {
    return state.players.some(function (p) { return p.alive && hasCard(state, p.i, 'vc25'); });
  }
  function win(state, pid, reason, instant) {
    if (state.gameover) return;
    if (instant && instantBlocked(state)) {
      var bn = log(state, 'An instant result card tried to fire, but VC25 blocks it.', 'vc25');
      milestone(state, 'vc25_block', { n: bn, pid: pid, cardId: 'vc25' });
      pushBanner(state, {
        kind: 'effect', cardId: 'vc25',
        title: 'VC25 — BLOCKED',
        text: 'An instant result card tried to fire, but VC25 blocked it.',
        pendingPids: globalBannerPids(state, pid)
      });
      return;
    }
    if (/^gc10/i.test(String(reason || ''))) {
      var guard = state.players.find(function (q) { return q.i !== pid && q.alive && hasCard(state, q.i, 'gc11'); });
      if (guard) {
        var gn = log(state, nameOf(state, guard.i) + ' holds GC11 — ' + nameOf(state, pid) + ' goes to the start instead of winning.', 'gc11');
        milestone(state, 'gc11_block', { n: gn, pid: guard.i, target: pid });
        pushBanner(state, {
          kind: 'effect', cardId: 'gc11',
          title: 'GC11 — WIN REDIRECTED',
          text: nameOf(state, guard.i) + ' holds GC11 — ' + nameOf(state, pid) + ' goes to tile 1 instead of winning.',
          actor: guard.i, pendingPids: state.cfg.practiceBot ? [0] : [pid, guard.i]
        });
        setTile(state, pid, 1, { landing: false });
        return;
      }
    }
    state.gameover = true; state.winner = pid; state.endReason = reason; state.phase = 'gameover';
    var wn = log(state, nameOf(state, pid) + ' WINS — ' + reason + '.');
    milestone(state, 'win', { n: wn, pid: pid, reason: reason });
    state.queue.length = 0; state.prompt = null; state.reveal = null;
    state.banners = (state.banners || []).filter(function (b) { return b.kind === 'out'; });
  }
  function lose(state, pid, reason, instant) {
    var p = P(state, pid);
    if (!p.alive || state.gameover) return;
    if (hasCard(state, pid, 'gc13')) {
      var save = p.hand.find(function (c) { return c.id === 'gc13'; });
      if (save) { pluckCard(state, pid, save.uid); discardCard(state, save); }
      var sn = log(state, nameOf(state, pid) + ' would lose, but GC13 says: you will not, in fact, lose.', 'gc13');
      milestone(state, 'gc13_save', { n: sn, pid: pid });
      pushBanner(state, {
        kind: 'effect', cardId: 'gc13',
        title: 'GC13 — SAVED FROM LOSS',
        text: nameOf(state, pid) + ' would lose (' + reason + '), but GC13 saved them.',
        actor: pid, pendingPids: globalBannerPids(state, pid)
      });
      return;
    }
    if (instant && instantBlocked(state)) {
      var bn = log(state, 'The instant loss was blocked by VC25.', 'vc25');
      milestone(state, 'vc25_block', { n: bn, pid: pid, cardId: 'vc25' });
      pushBanner(state, {
        kind: 'effect', cardId: 'vc25',
        title: 'VC25 — BLOCKED',
        text: 'The instant loss on ' + nameOf(state, pid) + ' was blocked by VC25.',
        pendingPids: globalBannerPids(state, pid)
      });
      return;
    }
    var handCount = p.hand.length;
    p.alive = false;
    returnHandToDeck(state, pid);
    state.lastElimination = { pid: pid, name: nameOf(state, pid), reason: reason, tile: p.tile, handCount: handCount };
    var en = log(state, nameOf(state, pid) + ' is out — ' + reason + '.');
    milestone(state, 'elim', { n: en, pid: pid, reason: reason, tile: p.tile });
    pushBanner(state, {
      kind: 'out',
      title: nameOf(state, pid) + ' IS OUT',
      text: reason,
      detail: 'Last tile: ' + (p.tile < 0 ? '−' + Math.abs(p.tile) : p.tile) + ' · Cards in hand when out: ' + handCount,
      actor: pid,
      pendingPids: elimBannerPids(state, pid)
    });
    var alive = state.players.filter(function (q) { return q.alive; });
    if (alive.length === 1) win(state, alive[0].i, 'last player standing', false);
  }

  function sequenceStep(state, pid, tile) {
    var p = P(state, pid);
    if (!state.cfg.sequenceWin || p.seq >= 3) return false;
    // Older saved rooms predate this field; treat them as not having advanced yet.
    if (p.seqTurn == null) p.seqTurn = -1;
    var seq = [3, 7, 13], want = seq[p.seq];
    if (tile !== want) return false;
    if (p.seqTurn === state.turnCount) {
      log(state, nameOf(state, pid) + ' already advanced the 3 → 7 → 13 sequence this turn.');
      return false;
    }
    p.seq += 1;
    p.seqTurn = state.turnCount;
    var qn = log(state, nameOf(state, pid) + ' completes ' + want + ' of the 3 → 7 → 13 sequence (' + p.seq + '/3).');
    milestone(state, 'seq', { n: qn, pid: pid, step: p.seq, tile: want });
    if (p.seq === 3) { win(state, pid, 'landed on 3 → 7 → 13 in order', false); return true; }
    return false;
  }

  function checkLanding(state, pid, opts) {
    opts = opts || {};
    var p = P(state, pid), t = p.tile;
    state.lastLanded = { pid: pid, tile: t };
    var checkedThirteen = false;
    var boardEvent = null;

    // The final 13 is resolved before its snake, per the table interpretation.
    if (t === 13 && p.seq === 2) {
      checkedThirteen = true;
      if (sequenceStep(state, pid, t)) return;
    }

    // Resolution order: movement, then snake/ladder, then win/loss, then draw, then immediate effects.
    if (t > 0) {
      var head = t, tail = SNAKES[head];
      if (tail != null) {
        if (hasCard(state, pid, 'gc8') && !state.flags.snakeImmunityBanned) {
          var i8 = log(state, nameOf(state, pid) + ' is immune to the snake at ' + head + '.', 'gc8');
          milestone(state, 'snake_immune', { n: i8, pid: pid, from: head });
          boardEvent = { cardId: 'gc8', title: 'SNAKE IMMUNE (GC8)', text: nameOf(state, pid) + ' stayed on tile ' + head + ' — immune to the snake.' };
        } else if (hasCard(state, pid, 'gc21')) {
          setRawTile(state, pid, head + 1);
          var i21 = log(state, 'GC21 second chance: ' + head + ' → ' + P(state, pid).tile + ' (the tile ahead of the snake).', 'gc21');
          milestone(state, 'snake_second_chance', { n: i21, pid: pid, from: head, to: P(state, pid).tile });
          boardEvent = { cardId: 'gc21', title: 'GC21 — SECOND CHANCE', text: nameOf(state, pid) + ' avoided the snake at ' + head + ' and stepped ahead to tile ' + P(state, pid).tile + '.' };
          if (P(state, pid).tile >= 100) win(state, pid, 'GC21 put them on tile 100', false);
        } else if (state.flags.snakeMirror === pid) {
          delete state.flags.snakeMirror;
          setRawTile(state, pid, head + (head - tail));
          var i15 = log(state, 'GC15: the snake at ' + head + ' acts as a ladder — ' + head + ' → ' + P(state, pid).tile + '.', 'gc15');
          milestone(state, 'snake_mirror', { n: i15, pid: pid, from: head, to: P(state, pid).tile });
          boardEvent = { cardId: 'gc15', title: 'GC15 — SNAKE MIRRORED', text: 'The snake at ' + head + ' acted as a ladder — ' + nameOf(state, pid) + ' climbed to tile ' + P(state, pid).tile + '.' };
          if (P(state, pid).tile >= 100) win(state, pid, 'GC15 mirrored a snake onto tile 100', false);
        } else {
          setRawTile(state, pid, tail);
          var sn = log(state, nameOf(state, pid) + ' hit the snake at ' + head + ' → ' + tail + '.');
          milestone(state, 'snake', { n: sn, pid: pid, from: head, to: tail });
          boardEvent = { title: 'SNAKE · ' + head + ' → ' + (tail < 0 ? '−' + Math.abs(tail) : tail), text: nameOf(state, pid) + ' slid down the snake from ' + head + ' to tile ' + (tail < 0 ? '−' + Math.abs(tail) : tail) + '.' };
        }
      } else if (LADDERS[head] != null) {
        setRawTile(state, pid, LADDERS[head]);
        var ln = log(state, nameOf(state, pid) + ' climbed the ladder at ' + head + ' → ' + LADDERS[head] + '.');
        milestone(state, 'ladder', { n: ln, pid: pid, from: head, to: LADDERS[head] });
        boardEvent = { title: 'LADDER · ' + head + ' → ' + LADDERS[head], text: nameOf(state, pid) + ' climbed the ladder from ' + head + ' to tile ' + LADDERS[head] + '.' };
      }
    }
    if (state.gameover) return;

    t = p.tile;
    state.lastLanded = { pid: pid, tile: t };
    if (t <= -9) { lose(state, pid, 'landed on tile −9', false); return; }
    if (t >= 100) { win(state, pid, 'reached tile 100', false); return; }
    if (!checkedThirteen && sequenceStep(state, pid, t)) return;

    if (boardEvent && !opts.noBoardBanner) {
      pushBanner(state, {
        kind: 'effect', cardId: boardEvent.cardId || null,
        title: boardEvent.title, text: boardEvent.text,
        actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid]
      });
    }

    if (t > 0 && t % 2 === 0) enqueueDraw(state, pid, 1);
    if (state.curses[t]) {
      var c = state.curses[t]; delete state.curses[t];
      var cn = log(state, 'Tile ' + t + ' was cursed with ' + label(c.id) + '. It fires on ' + nameOf(state, pid) + '.', c.id);
      milestone(state, 'curse_hit', { n: cn, pid: pid, tile: t, cardId: c.id });
      pushBanner(state, {
        kind: 'effect', cardId: c.id, card: cardView(c),
        title: 'CURSED TILE ' + t + ' — ' + label(c.id),
        text: 'Tile ' + t + ' was cursed with ' + label(c.id) + '. It fires on ' + nameOf(state, pid) + '.',
        actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid]
      });
      state.queue.push({ t: 'apply', card: c, pid: pid, fromPid: 'curse' });
    }
  }

  /* ---------- queue / draws ---------- */
  function enqueueDraw(state, pid, count) {
    for (var i = 0; i < count; i++) state.queue.push({ t: 'draw', pid: pid });
  }
  function advance(state) {
    var guard = 0;
    while (state.queue.length && !state.gameover && !state.prompt && !state.reveal && !(state.banners && state.banners.length) && guard++ < 600) {
      var task = state.queue.shift();
      try { runTask(state, task); }
      catch (e) { log(state, 'Rules engine caught an error while resolving ' + (task.card ? label(task.card.id) : task.t) + ': ' + e.message); }
    }
  }
  function settle(state) {
    advance(state);
    if (state.gameover) { state.phase = 'gameover'; state.canEndTurn = false; return; }
    if (!state.prompt && !state.reveal && !(state.banners && state.banners.length) && !state.queue.length && state.rolledThisTurn) state.canEndTurn = true;
  }
  function runTask(state, task) {
    if (task.t === 'draw') return doDraw(state, task);
    if (task.t === 'card') return doCard(state, task);
    if (task.t === 'apply') return applyEffect(state, task.card, task.pid, task.fromPid);
    if (task.t === 'banner') return pushBanner(state, task.banner);
    if (task.t === 'gc19_prompt') {
      setPrompt(state, { title: 'GC19 — place your bad card', text: 'Choose the top of any ladder. You move there instead of resolving ' + label(task.badCardId) + '.',
        cardId: 'gc19', kind: 'options', multi: 0, data: { op: 'gc19_ladder', pid: task.pid },
        options: LADDER_TOPS.map(function (t) { return { label: 'Tile ' + t, value: t }; }) });
      return;
    }
    if (task.t === 'bc7_lose') return lose(state, task.pid, task.reason, false);
    if (task.t === 'instant_win') return win(state, task.pid, task.reason, true);
  }
  function doDraw(state, task) {
    var pid = task.pid, p = P(state, pid);
    // Batch all consecutive queued draws for this player so multiple cards drawn at once are shown together.
    var count = 1;
    while (state.queue.length && state.queue[0].t === 'draw' && state.queue[0].pid === pid) {
      state.queue.shift();
      count++;
    }
    if (!p.alive) return;
    if (hasCard(state, pid, 'bc2')) {
      log(state, nameOf(state, pid) + ' cannot draw cards while holding BC2.');
      return;
    }
    var cards = takeFromDeck(state, count);
    if (!cards.length) { log(state, 'The deck is empty.'); return; }
    p.drewThisTurn = true;

    var items = [];
    var deferred = [];
    cards.forEach(function (card) {
      var id = card.id;
      p.drawnTypes.push(typeOf(id));
      if (p.drawnTypes.length > 12) p.drawnTypes.shift();

      var pl = decide(state, card);
      var ic = interceptors(state, card, pid, pl, deferred);
      if (ic && ic.outcome === 'discard') {
        discardCard(state, card);
        items.push({
          card: cardView(card), text: CARDS[id].text, kept: false, public: true,
          jazz: false, statusNote: ic.note || 'INTERCEPTED'
        });
      } else if (ic && ic.outcome === 'transfer') {
        items.push({
          card: cardView(card), text: CARDS[id].text, kept: false, public: true,
          jazz: false, statusNote: ic.note || 'TRANSFERRED'
        });
      } else {
        if (pl.hand) {
          card.sticky = pl.sticky; card.playable = pl.playable; card.passive = pl.passive;
          addHand(state, pid, card);
        } else {
          discardCard(state, card);
        }
        // Kept cards stay secret: only the drawing player sees the card face.
        log(state, nameOf(state, pid) + ' drew a ' + typeOf(id).toLowerCase() + ' card' +
          (pl.hand ? ' (kept in hand)' : ' — ' + label(id) + ' (played immediately)') + '.', pl.hand ? null : id);
        items.push({
          card: cardView(card), text: CARDS[id].text, kept: pl.hand, public: !pl.hand,
          jazz: id === 'gc25', statusNote: pl.hand ? 'KEPT IN HAND' : 'PLAYED IMMEDIATELY'
        });
        if (pl.resolveNow) deferred.push({ t: 'apply', card: card, pid: pid, fromPid: null });
      }
    });

    if (!items.length) return;
    state.reveal = {
      card: items[0].card,
      cards: items,
      pid: pid,
      public: items.some(function (x) { return x.public; }),
      text: items[0].text,
      jazz: items.some(function (x) { return x.jazz; }),
      kept: items.every(function (x) { return x.kept; })
    };
    for (var j = deferred.length - 1; j >= 0; j--) state.queue.unshift(deferred[j]);
  }

  function decide(state, card) {
    var id = card.id, ty = typeOf(id);
    if (STICKY.indexOf(id) >= 0) {
      return { hand: true, sticky: true, playable: false, passive: true, resolveNow: id !== 'vc25' };
    }
    if (id === 'vc34' || id === 'vc35') {
      return { hand: true, sticky: false, playable: true, passive: true, resolveNow: false };
    }
    if (ty === 'Good' && IMMEDIATE_GOOD.indexOf(id) < 0) {
      return { hand: true, sticky: false, playable: true, passive: PASSIVE_GOOD.indexOf(id) >= 0, resolveNow: false };
    }
    return { hand: false, sticky: false, playable: false, passive: false, resolveNow: true };
  }

  function doCard(state, task) {
    var card = task.card, pid = task.pid, id = card.id;
    if (task.source !== 'draw') {
      state.queue.unshift({ t: 'apply', card: card, pid: pid, fromPid: task.fromPid });
      return;
    }
    var pl = decide(state, card);
    var deferred = [];
    var ic = interceptors(state, card, pid, pl, deferred);
    if (ic && ic.outcome === 'discard') {
      discardCard(state, card);
      for (var d1 = deferred.length - 1; d1 >= 0; d1--) state.queue.unshift(deferred[d1]);
      return;
    }
    if (ic && ic.outcome === 'transfer') {
      for (var d2 = deferred.length - 1; d2 >= 0; d2--) state.queue.unshift(deferred[d2]);
      return;
    }
    if (pl.hand) {
      card.sticky = pl.sticky; card.playable = pl.playable; card.passive = pl.passive;
      addHand(state, pid, card);
    } else {
      discardCard(state, card);
    }
    log(state, nameOf(state, pid) + ' drew a ' + typeOf(id).toLowerCase() + ' card' +
      (pl.hand ? ' (kept in hand)' : ' — ' + label(id) + ' (played immediately)') + '.', pl.hand ? null : id);
    var item = { card: cardView(card), text: CARDS[id].text, kept: pl.hand, public: !pl.hand, jazz: id === 'gc25', statusNote: pl.hand ? 'KEPT IN HAND' : 'PLAYED IMMEDIATELY' };
    state.reveal = {
      card: item.card, cards: [item], pid: pid, public: !pl.hand,
      text: CARDS[id].text, jazz: id === 'gc25', kept: pl.hand
    };
    if (pl.resolveNow) deferred.push({ t: 'apply', card: card, pid: pid, fromPid: null });
    for (var j = deferred.length - 1; j >= 0; j--) state.queue.unshift(deferred[j]);
  }

  function interceptors(state, card, pid, pl, deferred) {
    var id = card.id, ty = typeOf(id), p = P(state, pid);
    deferred = deferred || state.queue;

    if (state.flags.negateNextCard != null) {
      var by = state.flags.negateNextCard; delete state.flags.negateNextCard;
      var nn = log(state, label(id) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').', id);
      milestone(state, 'vc32_negate', { n: nn, pid: by, cardId: id });
      deferred.push({ t: 'banner', banner: {
        kind: 'effect', cardId: 'vc32', card: cardView(card),
        title: 'VC32 — CARD NEGATED',
        text: label(id) + ' drawn by ' + nameOf(state, pid) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').',
        actor: by, pendingPids: state.cfg.practiceBot ? [0] : (by !== pid ? [pid, by] : [pid])
      } });
      return { outcome: 'discard', note: 'NEGATED BY VC32' };
    }
    if (ty === 'Bad' && p.status.badImmuneRolls > 0 && state.rolledThisTurn) {
      p.status.badImmuneRolls--;
      log(state, nameOf(state, pid) + ' is immune to bad cards on this roll (GC2). ' + label(id) + ' fizzles.', id);
      return { outcome: 'discard', note: 'BLOCKED BY GC2' };
    }
    if (state.flags.nextDrawGiveTo != null && state.flags.nextDrawGiveTo !== pid) {
      var owner = state.flags.nextDrawGiveTo; delete state.flags.nextDrawGiveTo;
      addHand(state, owner, card);
      var v12n = log(state, 'VC12: ' + nameOf(state, pid) + ' must hand their card to ' + nameOf(state, owner) + '.', id);
      milestone(state, 'steal', { n: v12n, pid: owner, target: pid, cardId: 'vc12' });
      deferred.push({ t: 'banner', banner: {
        kind: 'card', cardId: 'vc12', card: cardView(card), private: true,
        title: 'VC12 — CARD RECEIVED',
        text: nameOf(state, pid) + ' drew a card and had to hand ' + label(id) + ' to ' + nameOf(state, owner) + '.',
        actor: pid, pendingPids: [owner]
      } });
      return { outcome: 'transfer', note: 'GIVEN TO ' + nameOf(state, owner).toUpperCase() + ' (VC12)' };
    }
    if (p.status.nextCardGiveToNext) {
      p.status.nextCardGiveToNext = false;
      var tgt = nextAliveSeat(state, pid);
      transferCard(state, pid, tgt, card);
      log(state, 'VC14: the card goes to ' + nameOf(state, tgt) + '; ' + nameOf(state, pid) + ' draws another.', id);
      deferred.push({ t: 'banner', banner: {
        kind: 'card', cardId: 'vc14', card: cardView(card), private: true,
        title: 'VC14 — CARD PASSED TO YOU',
        text: nameOf(state, pid) + ' passed ' + label(id) + ' to ' + nameOf(state, tgt) + '.',
        actor: pid, pendingPids: [tgt]
      } });
      enqueueDraw(state, pid, 1);
      return { outcome: 'transfer', note: 'PASSED TO ' + nameOf(state, tgt).toUpperCase() + ' (VC14)' };
    }
    if (p.status.nextCardType) {
      var req = p.status.nextCardType; p.status.nextCardType = null;
      if (ty !== req.type) {
        log(state, 'The next card was ' + ty + ', not ' + req.type + '. ' + nameOf(state, pid) + ' pays the price.');
        if (req.fail === 'lose') deferred.push({ t: 'bc7_lose', pid: pid, reason: 'failed a card-type prediction' });
        else if (req.fail === 'nemo') toNemo(state, pid);
        else setTile(state, pid, 1, { landing: false });
      } else log(state, 'The card-type prediction was right (' + req.type + ').');
    }
    if (hasCard(state, pid, 'bc7') || (id === 'bc7' && pl.hand)) {
      var d = p.drawnTypes;
      if (d.length >= 2 && d[d.length - 1] === d[d.length - 2]) {
        deferred.push({ t: 'bc7_lose', pid: pid, reason: 'drew the same card type twice in a row while holding BC7' });
      }
    }
    if (ty === 'Bad' && state.flags.nextBadToLadderTop === pid) {
      delete state.flags.nextBadToLadderTop;
      log(state, 'GC19: the bad card is placed at the top of a ladder instead of taking effect.', id);
      deferred.push({ t: 'gc19_prompt', pid: pid, badCardId: id });
      return { outcome: 'discard', note: 'REPLACED BY GC19 LADDER' };
    }
    if (ty === 'Bad' && p.status.curseTile != null) {
      var t = p.status.curseTile; p.status.curseTile = null;
      state.curses[t] = card;
      log(state, 'GC12: tile ' + t + ' is now cursed with ' + label(id) + '.', id);
      return { outcome: 'discard', note: 'CURSED ONTO TILE ' + t + ' (GC12)' };
    }
    if (id === 'gc10') {
      var guard = state.players.find(function (q) { return q.i !== pid && q.alive && hasCard(state, q.i, 'gc11'); });
      if (guard) {
        var g11 = log(state, 'GC11 (held by ' + nameOf(state, guard.i) + '): ' + nameOf(state, pid) + ' is sent to the start instead of winning.', id);
        milestone(state, 'gc11_block', { n: g11, pid: guard.i, target: pid });
        setTile(state, pid, 1, { landing: false });
        return { outcome: 'discard', note: 'BLOCKED BY GC11' };
      }
    }
    if (INSTANT_RESULT.indexOf(id) >= 0 && instantBlocked(state)) {
      var v25 = log(state, 'VC25 blocks the instant result on ' + label(id) + '.', id);
      milestone(state, 'vc25_block', { n: v25, pid: pid, cardId: id });
      return { outcome: 'discard', note: 'BLOCKED BY VC25' };
    }
    if ((id === 'vc34' || id === 'vc35') && pl.hand) {
      var other = id === 'vc34' ? 'vc35' : 'vc34';
      if (hasCard(state, pid, other)) {
        log(state, 'Both variants are in hand — ' + label(id) + ' + ' + label(other) + '.', id);
        deferred.push({ t: 'instant_win', pid: pid, reason: 'both VC34 and VC35 variants' });
      }
    }
    return null;
  }

  /* ---------- prompts ---------- */
  function setPrompt(state, o) {
    var forPid = o.forPid != null ? o.forPid : (o.data && o.data.pid != null ? o.data.pid : state.turnIndex);
    state.prompt = Object.assign({ forPid: forPid, kind: 'options', multi: 0, options: [] }, o);
    state.prompt.forPid = forPid;
  }
  function playerOptions(state, exclude, filter) {
    return state.players.filter(function (p) {
      return p.alive && p.i !== exclude && (!filter || filter(p));
    }).map(function (p) { return { label: nameOf(state, p.i) + ' · tile ' + p.tile, value: p.i }; });
  }
  function cardOptions(state, pid, filter) {
    return P(state, pid).hand.filter(function (c) { return !filter || filter(c); })
      .map(function (c) { return { label: label(c.id) + ' · ' + CARDS[c.id].text.slice(0, 46), value: c.uid, img: CARDS[c.id].img }; });
  }
  function promptPlayers(state, o) {
    var opts = playerOptions(state, o.exclude == null ? state.turnIndex : o.exclude, o.filter);
    if (!opts.length) { log(state, o.emptyText || 'No valid target — nothing happens.'); return false; }
    setPrompt(state, { title: o.title, text: o.text, cardId: o.cardId, kind: 'options', multi: 0,
      data: Object.assign({ pid: state.turnIndex }, o.data), options: opts });
    return true;
  }
  function promptOutcome(state, pid, cardId, text, fail) {
    setPrompt(state, { title: label(cardId) + ' — table call', text: text, cardId: cardId, kind: 'options', multi: 0,
      data: { op: 'outcome', pid: pid, fail: fail },
      options: [{ label: 'YES — accepted / correct', value: 'ok' }, { label: 'NO — failed', value: 'fail' }] });
  }
  function promptChoice(state, pid, cardId, text, options) {
    setPrompt(state, { title: label(cardId) + ' — choose', text: text, cardId: cardId, kind: 'options', multi: 0,
      data: { op: 'choice', pid: pid }, options: options });
  }

  function answer(state, value) {
    var pr = state.prompt;
    if (!pr) return;
    state.prompt = null;
    var pid = pr.data.pid == null ? pr.forPid : pr.data.pid;
    var op = pr.data.op, p = P(state, pid);
    var selected = function (uid) { return pluckCard(state, pid, uid); };
    var bannersBefore = (state.banners || []).length;
    switch (op) {
      case 'outcome':
        if (value === 'fail') {
          if (pr.data.fail === 'lose') lose(state, pid, 'failed a table call', false);
          else if (pr.data.fail === 'nemo') {
            toNemo(state, pid, pr.cardId);
            pushBanner(state, { kind: 'effect', cardId: pr.cardId, title: label(pr.cardId) + ' — TO POINT NEMO',
              text: nameOf(state, pid) + ' failed the table call and went to Point Nemo (tile −1).',
              actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid] });
          } else if (pr.data.fail === 'start') {
            setTile(state, pid, 1, { landing: false });
            pushBanner(state, { kind: 'effect', cardId: pr.cardId, title: label(pr.cardId) + ' — BACK TO START',
              text: nameOf(state, pid) + ' failed the table call and returned to tile 1.',
              actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid] });
          }
        } else log(state, nameOf(state, pid) + ' succeeded. Nothing else happens.');
        break;
      case 'choice':
        switch (value) {
          case 'bc22_discard': discardHand(state, pid, function (c) { return typeOf(c.id) === 'Good'; }); log(state, nameOf(state, pid) + ' discards all Good cards.'); break;
          case 'bc22_lose': lose(state, pid, 'could not discard Good cards (BC22)', false); break;
          case 'bc23_discard': {
            var g = handGood(state, pid).slice(0, 2);
            g.forEach(function (c) { selected(c.uid); discardCard(state, c); });
            log(state, nameOf(state, pid) + ' discards ' + g.length + ' Good cards.');
            break;
          }
          case 'bc23_back': case 'bc24_back': back(state, pid, 4, null); break;
          case 'bc24_take': {
            var victims24 = [];
            state.players.forEach(function (q) {
              if (q.i === pid || !q.alive) return;
              var bads = q.hand.filter(function (c) { return typeOf(c.id) === 'Bad'; });
              if (bads.length) victims24.push(q.i);
              bads.forEach(function (c) {
                pluckCard(state, q.i, c.uid); transferCard(state, q.i, pid, c);
              });
            });
            log(state, nameOf(state, pid) + ' takes everyone’s Bad cards.');
            if (victims24.length) {
              pushBanner(state, { kind: 'effect', cardId: 'bc24', title: 'BC24 — BAD CARDS TAKEN',
                text: nameOf(state, pid) + ' took everyone’s Bad cards.',
                actor: pid, pendingPids: state.cfg.practiceBot ? [0] : victims24 });
            }
            break;
          }
        }
        break;
      case 'bc8_worse': {
        var cards = pr.data.cards;
        var chosen = cards.find(function (c) { return c.uid === value; }) || cards[0];
        var other = cards.find(function (c) { return c.uid !== chosen.uid; });
        if (other) { state.deck.push(other); shuffle(state.deck); }
        log(state, nameOf(state, pid) + ' keeps the objectively worse card (' + label(chosen.id) + '); the other goes back into the deck.', chosen.id);
        state.queue.push({ t: 'card', card: chosen, pid: pid, source: 'draw' });
        break;
      }
      case 'bc26_type':
        p.status.nextCardType = { type: value, fail: 'start' };
        log(state, 'The table called “' + value + '”. If the next card is not ' + value + ', ' + nameOf(state, pid) + ' goes to the start.');
        pushBanner(state, { kind: 'effect', cardId: 'bc26', title: 'BC26 — TYPE CALLED: ' + value.toUpperCase(),
          text: nameOf(state, pr.data.target) + ' called “' + value + '”. If ' + nameOf(state, pid) + '’s next card is not ' + value + ', they go back to tile 1.',
          actor: pr.data.target, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid] });
        break;
      case 'bc9_target': case 'bc10_target': {
        var need = op === 'bc9_target' ? 2 : 1;
        var card910 = op === 'bc9_target' ? 'bc9' : 'bc10';
        var give = handGood(state, pid);
        if (give.length < need) { log(state, 'Not enough Good cards — ' + label(card910) + ' is discarded.'); break; }
        var sent910 = give.slice(0, need);
        sent910.forEach(function (c) { selected(c.uid); transferCard(state, pid, value, c); });
        log(state, nameOf(state, pid) + ' gives ' + need + ' Good card(s) to ' + nameOf(state, value) + '.');
        pushBanner(state, { kind: 'card', cardId: card910, cards: sent910.map(cardView), private: true,
          title: label(card910) + ' — CARDS RECEIVED',
          text: nameOf(state, pid) + ' gave ' + sent910.map(function (c) { return label(c.id); }).join(' & ') + ' to ' + nameOf(state, value) + '.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      }
      case 'bc11_target':
        log(state, nameOf(state, pid) + ' chooses ' + nameOf(state, value) + ' to lose with them.');
        lose(state, value, 'chosen by BC11', false);
        lose(state, pid, 'BC11', false);
        break;
      case 'gc3_target':
        setTile(state, value, 1, { landing: true });
        log(state, nameOf(state, value) + ' is sent to the start.');
        pushBanner(state, { kind: 'effect', cardId: 'gc3', title: 'GC3 — SENT TO START',
          text: nameOf(state, pid) + ' played GC3 and sent ' + nameOf(state, value) + ' back to tile 1.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      case 'gc5_target': {
        var a = p.tile, b = P(state, value).tile;
        setRawTile(state, pid, b); setRawTile(state, value, a);
        var s5 = log(state, nameOf(state, pid) + ' swaps tiles with ' + nameOf(state, value) + '.', 'gc5');
        milestone(state, 'swap', { n: s5, pid: pid, target: value, cardId: 'gc5' });
        pushBanner(state, { kind: 'effect', cardId: 'gc5', title: 'GC5 — TILES SWAPPED',
          text: nameOf(state, pid) + ' swapped tiles with ' + nameOf(state, value) + ' (' + nameOf(state, value) + ' is now on tile ' + a + ').',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      }
      case 'gc7_tile': setTile(state, pid, Number(value), { landing: true }); break;
      case 'gc14_vertical': {
        var t2 = verticalTile(p.tile, value);
        if (t2 == null) log(state, 'There is no tile vertically ' + value + ' from here.');
        else { log(state, nameOf(state, pid) + ' moves vertically ' + value + ' to tile ' + t2 + '.'); setTile(state, pid, t2, { landing: true }); }
        break;
      }
      case 'gc16_target':
        P(state, value).status.skipTurns += 1;
        log(state, nameOf(state, value) + ' is immobile for a turn.');
        pushBanner(state, { kind: 'effect', cardId: 'gc16', title: 'GC16 — IMMOBILE NEXT TURN',
          text: nameOf(state, pid) + ' played GC16 — ' + nameOf(state, value) + ' misses their next turn.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      case 'gc19_ladder': setTile(state, pid, Number(value), { landing: true }); log(state, nameOf(state, pid) + ' goes to ladder top ' + value + '.'); break;
      case 'gc23_target': {
        var b23 = (state.banners || []).length;
        back(state, value, 2, pid);
        if ((state.banners || []).length === b23 && !state.gameover) {
          pushBanner(state, { kind: 'effect', cardId: 'gc23', title: 'GC23 — DRAGGED BACK 2',
            text: nameOf(state, pid) + ' played GC23 and dragged ' + nameOf(state, value) + ' back 2 spaces to tile ' + P(state, value).tile + '.',
            actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        }
        break;
      }
      case 'gc30_target':
        P(state, value).status.extraRolls += 1;
        log(state, nameOf(state, value) + ' is forced to roll an extra time on their next turn.');
        pushBanner(state, { kind: 'effect', cardId: 'gc30', title: 'GC30 — EXTRA ROLL FORCED',
          text: nameOf(state, pid) + ' played GC30 — ' + nameOf(state, value) + ' must roll an extra time on their next turn.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      case 'gc34_target': {
        var b34 = (state.banners || []).length;
        back(state, value, 10, pid);
        if ((state.banners || []).length === b34 && !state.gameover) {
          pushBanner(state, { kind: 'effect', cardId: 'gc34', title: 'GC34 — DRAGGED BACK 10',
            text: nameOf(state, pid) + ' played GC34 and dragged ' + nameOf(state, value) + ' back 10 spaces to tile ' + P(state, value).tile + '.',
            actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        }
        break;
      }
      case 'gc36_tile': setTile(state, pid, Number(value), { landing: true }); break;
      case 'vc1_target': {
        var opts1 = cardOptions(state, pid);
        if (!opts1.length) { log(state, 'No cards to give.'); break; }
        setPrompt(state, { title: 'VC1 — choose a card to give', text: 'Give one of your cards to ' + nameOf(state, value) + '.', cardId: 'vc1',
          kind: 'cards', multi: 0, data: { op: 'vc1_card', pid: pid, target: value }, options: opts1 });
        break;
      }
      case 'vc1_card': {
        var c1 = selected(value); if (!c1) break;
        transferCard(state, pid, pr.data.target, c1);
        log(state, nameOf(state, pid) + ' gives ' + label(c1.id) + ' to ' + nameOf(state, pr.data.target) + '.', c1.id);
        pushBanner(state, { kind: 'card', cardId: 'vc1', card: cardView(c1), private: true,
          title: 'VC1 — CARD RECEIVED',
          text: nameOf(state, pid) + ' gave ' + label(c1.id) + ' to ' + nameOf(state, pr.data.target) + '.',
          actor: pid, pendingPids: [state.cfg.practiceBot && pr.data.target > 0 ? 0 : pr.data.target] });
        break;
      }
      case 'vc6_target': {
        var peek = P(state, value).hand.map(cardView);
        var cost = cardOptions(state, pid, function (c) { return typeOf(c.id) === 'Good'; });
        if (!cost.length) { log(state, 'No Good card to pay with — VC6 fails.'); break; }
        setPrompt(state, { title: 'VC6 — look at ' + nameOf(state, value) + '’s cards', text: 'These are their cards. Pay one of your Good cards to keep this knowledge.',
          cardId: 'vc6', kind: 'cards', multi: 0, peek: peek,
          data: { op: 'vc6_cost', pid: pid, target: value }, options: cost });
        break;
      }
      case 'vc6_cost': {
        var c6 = selected(value); if (!c6) break;
        discardCard(state, c6);
        log(state, nameOf(state, pid) + ' pays ' + label(c6.id) + ' to look at ' + nameOf(state, pr.data.target) + '’s cards.', c6.id);
        pushBanner(state, { kind: 'effect', cardId: 'vc6', title: 'VC6 — YOUR HAND WAS VIEWED',
          text: nameOf(state, pid) + ' paid ' + label(c6.id) + ' to look at ' + nameOf(state, pr.data.target) + '’s cards.',
          actor: pid, pendingPids: [state.cfg.practiceBot && pr.data.target > 0 ? 0 : pr.data.target] });
        break;
      }
      case 'vc7_forfeit': {
        var c7 = selected(value); if (!c7) break;
        discardCard(state, c7);
        log(state, nameOf(state, pid) + ' forfeits ' + label(c7.id) + '.', c7.id);
        break;
      }
      case 'vc21_curse': {
        var host = selected(value); if (!host) break;
        var bad = takeBadFromDeck(state);
        if (!bad) { log(state, 'No Bad card left to curse with.'); addHand(state, pid, host); break; }
        host.meta.cursedWith = bad;
        addHand(state, pid, host);
        log(state, label(host.id) + ' is cursed. The hidden Bad card triggers only if it is stolen.', host.id);
        break;
      }
      case 'vc26_target': {
        var hA = P(state, pid).hand.splice(0), hB = P(state, value).hand.splice(0);
        hA.forEach(function (c) { transferCard(state, pid, value, c); });
        hB.forEach(function (c) { transferCard(state, value, pid, c); });
        var s26 = log(state, nameOf(state, pid) + ' swaps hands with ' + nameOf(state, value) + '.', 'vc26');
        milestone(state, 'steal', { n: s26, pid: pid, target: value, cardId: 'vc26' });
        pushBanner(state, { kind: 'card', cardId: 'vc26', cards: hA.map(cardView), private: true,
          title: 'VC26 — HANDS SWAPPED',
          text: nameOf(state, pid) + ' swapped hands with ' + nameOf(state, value) + '. Received ' + hA.length + ' card(s).',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      }
      case 'vc31_target':
        log(state, nameOf(state, value) + ' must draw a card.');
        pushBanner(state, { kind: 'effect', cardId: 'vc31', title: 'VC31 — DRAW A CARD',
          text: nameOf(state, pid) + ' played VC31 — ' + nameOf(state, value) + ' must draw a card.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        enqueueDraw(state, value, 1);
        break;
      case 'vc33_target': {
        var opts33 = cardOptions(state, value);
        if (!opts33.length) { log(state, nameOf(state, value) + ' has no cards to discard.'); break; }
        setPrompt(state, { title: 'VC33 — discard one of their cards', text: 'Choose a card from ' + nameOf(state, value) + '’s hand to discard.',
          cardId: 'vc33', kind: 'cards', multi: 0, data: { op: 'vc33_card', pid: pid, target: value }, options: opts33 });
        break;
      }
      case 'vc33_card': {
        var c33 = pluckCard(state, pr.data.target, value);
        if (c33) {
          discardCard(state, c33);
          log(state, label(c33.id) + ' is discarded from ' + nameOf(state, pr.data.target) + '’s hand.', c33.id);
          pushBanner(state, { kind: 'effect', cardId: 'vc33', card: cardView(c33),
            title: 'VC33 — CARD DISCARDED',
            text: nameOf(state, pid) + ' discarded ' + label(c33.id) + ' from ' + nameOf(state, pr.data.target) + '’s hand.',
            actor: pid, pendingPids: [state.cfg.practiceBot && pr.data.target > 0 ? 0 : pr.data.target] });
        }
        break;
      }
      case 'vc36_target':
        discardHand(state, value);
        log(state, nameOf(state, value) + ' discards their whole hand.');
        pushBanner(state, { kind: 'effect', cardId: 'vc36', title: 'VC36 — HAND DISCARDED',
          text: nameOf(state, pid) + ' played VC36 — ' + nameOf(state, value) + ' discarded their entire hand.',
          actor: pid, pendingPids: [state.cfg.practiceBot && value > 0 ? 0 : value] });
        break;
      default: log(state, 'Unhandled choice: ' + op);
    }
    // If another card effect is still waiting in queue after resolving this prompt, pause for the owner before moving on.
    if (!state.gameover && !state.prompt && !state.reveal && (state.banners || []).length === bannersBefore &&
        state.queue.some(function (x) { return x.t === 'apply'; })) {
      pushBanner(state, { kind: 'effect', cardId: pr.cardId || null,
        title: (pr.cardId ? label(pr.cardId) : 'CARD') + ' RESOLVED',
        text: pr.cardId && CARDS[pr.cardId] ? CARDS[pr.cardId].text : 'Effect resolved.',
        actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid] });
    }
  }

  /* ---------- card effects ---------- */
  function clearRules(state) {
    state.players.forEach(function (p) {
      p.hand.filter(function (c) { return c.sticky; }).forEach(function (c) { pluckCard(state, p.i, c.uid); discardCard(state, c); });
      p.status = { skipTurns: 0, skipUntilRound: 0, needSix: false, nextCardType: null,
                   alphabeticalUntilRound: 0, extraRolls: 0, badImmuneRolls: 0,
                   nextCardGiveToNext: false, curseTile: null };
    });
    state.flags = {}; state.curses = {}; state.watchers = [];
    log(state, 'GC22: every rule placed by a previous card is removed.');
  }
  function rotateTiles(state, dir) {
    var n = N(state), tiles = state.players.map(function (p) { return p.tile; });
    state.players.forEach(function (p, i) { setRawTile(state, p.i, tiles[(i - dir + n) % n]); });
  }
  function rotateHands(state, dir) {
    var n = N(state), hands = state.players.map(function (p) { return p.hand.splice(0); });
    state.players.forEach(function (p, i) {
      hands[(i - dir + n) % n].forEach(function (c) { transferCard(state, (i - dir + n) % n, i, c); });
    });
  }
  function discardEveryoneGood(state) {
    state.players.forEach(function (p) { discardHand(state, p.i, function (c) { return typeOf(c.id) === 'Good'; }); });
  }
  function everyoneTo(state, tile) {
    state.players.forEach(function (p) { if (p.alive) setTile(state, p.i, tile, { landing: true }); });
  }
  function forwardEveryone(state, n) {
    state.players.forEach(function (p) { if (p.alive) forward(state, p.i, n); });
  }
  function nearestLadder(tile) {
    return Object.keys(LADDERS).map(Number).reduce(function (best, t) {
      return Math.abs(t - tile) < Math.abs(best - tile) ? t : best;
    }, Object.keys(LADDERS).map(Number)[0]);
  }
  function tileCoords(t) {
    if (t <= 0) return { row: 10, col: t + 9 };
    var row = 10 - Math.floor((t - 1) / 10) - 1;
    var idx = (t - 1) % 10;
    return { row: row, col: row % 2 === 0 ? idx : 9 - idx };
  }
  function tileAt(row, col) {
    if (row < 0 || row > 10 || col < 0 || col > 9) return null;
    if (row === 10) return col - 9;
    var base = (9 - row) * 10 + 1;
    return base + (row % 2 === 0 ? col : 9 - col);
  }
  function verticalTile(t, dir) {
    var c = tileCoords(t);
    return tileAt(c.row + (dir === 'up' ? -1 : 1), c.col);
  }

  function applyEffect(state, card, pid, fromPid) {
    if (state.gameover || !P(state, pid).alive) return;
    var id = card.id, p = P(state, pid);
    var nxt = nextAliveSeat(state, pid);
    var aliveCount = state.players.filter(function (q) { return q.alive; }).length;
    var bannersBefore = (state.banners || []).length;
    var effLogN = log(state, label(id) + ': ' + (CARDS[id] ? CARDS[id].text : 'engine effect'), id);

    // GC20: a bad card used against you still takes effect, but you also move five ahead.
    if (typeOf(id) === 'Bad' && fromPid != null && fromPid !== pid && typeof fromPid === 'number' && hasCard(state, pid, 'gc20')) {
      state.queue.push({ t: 'apply', card: cardObj(state, '__gc20'), pid: pid, fromPid: null });
    }

    switch (id) {
      /* ---------------- BAD ---------------- */
      case 'bc1': promptOutcome(state, pid, id, 'Guess the forecast of Manila for the next hour. The table decides whether you got it right.', 'nemo'); break;
      case 'bc2': log(state, 'BC2 stays in your hand: you cannot draw cards while it is there.'); break;
      case 'bc3':
        log(state, 'Table call: buy food for ' + nameOf(state, nxt) + '.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'BC3 — TABLE CALL', text: nameOf(state, pid) + ' must buy food for ' + nameOf(state, nxt) + '.',
          actor: pid, pendingPids: state.cfg.practiceBot ? [0] : (nxt !== pid ? [nxt, pid] : [pid]) });
        break;
      case 'bc4': p.status.needSix = true; log(state, 'Your next roll must be a 6, or Point Nemo.'); break;
      case 'bc5': promptOutcome(state, pid, id, 'Solve today’s Wordle and tell the table the answer.', 'lose'); break;
      case 'bc6': promptOutcome(state, pid, id, 'Solve today’s Wordle and tell the table the answer.', 'nemo'); break;
      case 'bc7': log(state, 'BC7 stays in your hand: two of the same card type in a row and you lose.'); break;
      case 'bc8': {
        var two = takeFromDeck(state, 2);
        if (two.length < 2) { two.forEach(function (c) { state.deck.push(c); }); log(state, 'Not enough cards in the deck.'); break; }
        p.drawnTypes.push(typeOf(two[0].id), typeOf(two[1].id));
        setPrompt(state, { title: 'BC8 — take the objectively worse one', text: 'Both cards were drawn. The table decides which is worse; the other goes back into the deck.',
          cardId: 'bc8', kind: 'cards', multi: 0, data: { op: 'bc8_worse', pid: pid, cards: two },
          options: two.map(function (c) { return { label: label(c.id) + ' · ' + CARDS[c.id].text, value: c.uid, img: CARDS[c.id].img }; }) });
        break;
      }
      case 'bc9': case 'bc10': {
        var need = id === 'bc9' ? 2 : 1;
        if (handGood(state, pid).length < need) { log(state, 'You have fewer than ' + need + ' Good card(s) — ' + label(id) + ' is discarded.'); break; }
        promptPlayers(state, { title: label(id) + ' — give Good cards', text: 'Choose who receives ' + need + ' of your Good cards.', cardId: id,
          data: { op: id + '_target' } });
        break;
      }
      case 'bc11':
        if (aliveCount <= 2) { log(state, 'Only two players in the game — BC11 is discarded.'); break; }
        promptPlayers(state, { title: 'BC11 — choose someone to lose with you', text: 'You lose, and so does the player you choose.',
          cardId: id, data: { op: 'bc11_target' } });
        break;
      case 'bc12':
        discardEveryoneGood(state);
        log(state, 'Everyone loses their Good cards.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'BC12 — ALL GOOD CARDS DISCARDED', text: 'Everyone discards all Good cards in hand.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'bc13': setTile(state, pid, 1, { landing: true }); break;
      case 'bc14': log(state, 'BC14 stays in your hand: every roll is reduced by 1.'); break;
      case 'bc15': setTile(state, pid, p.prevTile - p.lastRoll, { landing: true }); break;
      case 'bc16': setTile(state, pid, p.prevTile, { landing: true }); break;
      case 'bc17': p.status.skipUntilRound = state.round + 3; log(state, 'No rolling for three rounds.'); break;
      case 'bc18': p.status.skipUntilRound = state.round + 2; log(state, 'No rolling for two rounds.'); break;
      case 'bc19': p.status.skipUntilRound = state.round + 1; log(state, 'No rolling for a round.'); break;
      case 'bc20': setTile(state, pid, Math.ceil(p.tile / 2), { landing: true }); break;
      case 'bc21': toNemo(state, pid, id); break;
      case 'bc22': {
        var good22 = handGood(state, pid).length;
        promptChoice(state, pid, id, 'Discard all Good cards in your possession, or lose. Having none also means you lose.',
          [{ label: 'Discard all Good cards (' + good22 + ')', value: 'bc22_discard', disabled: good22 === 0 },
           { label: 'I cannot — I lose', value: 'bc22_lose' }]);
        break;
      }
      case 'bc23': {
        var good23 = handGood(state, pid).length;
        promptChoice(state, pid, id, 'Discard two Good cards, or move back four spaces.',
          [{ label: 'Discard two Good cards (' + good23 + ')', value: 'bc23_discard', disabled: good23 < 2 },
           { label: 'Move back four spaces', value: 'bc23_back' }]);
        break;
      }
      case 'bc24':
        promptChoice(state, pid, id, 'Take everyone’s Bad cards, or move back four spaces.',
          [{ label: 'Take everyone’s Bad cards', value: 'bc24_take' }, { label: 'Move back four spaces', value: 'bc24_back' }]);
        break;
      case 'bc25':
        everyoneTo(state, 1);
        milestone(state, 'warp', { n: effLogN, pid: pid, tile: 1, cardId: id });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'BC25 — EVERYONE TO TILE 1', text: nameOf(state, pid) + ' drew BC25 — everyone returns to tile 1!',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'bc26': {
        var bc26Next = nextAliveSeat(state, pid);
        setPrompt(state, { title: 'BC26 — the next player calls a card type', text: 'Call a card type for ' + nameOf(state, pid) + '. If their next card is not that type, they go to the start.',
          cardId: id, kind: 'options', multi: 0, forPid: bc26Next, data: { op: 'bc26_type', pid: pid, target: bc26Next },
          options: [{ label: 'Good', value: 'Good' }, { label: 'Bad', value: 'Bad' }, { label: 'Vertigo', value: 'Vertigo' }] });
        break;
      }
      case 'bc27': p.status.nextCardType = { type: 'Bad', fail: 'lose' }; log(state, 'Your next card must be Bad, or you lose.'); break;
      case 'bc28': p.status.nextCardType = { type: 'Good', fail: 'lose' }; log(state, 'Your next card must be Good, or you lose.'); break;
      case 'bc29': p.status.nextCardType = { type: 'Vertigo', fail: 'lose' }; log(state, 'Your next card must be Vertigo, or you lose.'); break;
      case 'bc30': lose(state, pid, 'BC30 — You lose.', true); break;
      case 'bc31': back(state, pid, 10, null); break;
      case 'bc32': back(state, pid, 8, null); break;
      case 'bc33': back(state, pid, 6, null); break;
      case 'bc34': back(state, pid, 2, null); break;
      case 'bc35':
        state.watchers.push({ owner: pid, target: nxt, requireDraw: false });
        log(state, 'If ' + nameOf(state, nxt) + ' does not draw a card on their turn, you go to Point Nemo.');
        if (nxt !== pid) {
          pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
            title: 'BC35 — WATCHING NEXT TURN', text: 'If ' + nameOf(state, nxt) + ' does not draw a card on their next turn, ' + nameOf(state, pid) + ' goes to Point Nemo.',
            actor: pid, pendingPids: state.cfg.practiceBot ? [0] : [nxt] });
        }
        break;
      case 'bc36':
        state.watchers.push({ owner: pid, target: nxt, requireDraw: true });
        log(state, 'If ' + nameOf(state, nxt) + ' draws a card on their turn, you go to Point Nemo.');
        if (nxt !== pid) {
          pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
            title: 'BC36 — WATCHING NEXT TURN', text: 'If ' + nameOf(state, nxt) + ' draws a card on their next turn, ' + nameOf(state, pid) + ' goes to Point Nemo.',
            actor: pid, pendingPids: state.cfg.practiceBot ? [0] : [nxt] });
        }
        break;

      /* ---------------- GOOD ---------------- */
      case 'gc1': forward(state, pid, 3); break;
      case 'gc2': p.status.badImmuneRolls += 1; log(state, 'Immune to Bad cards on your next roll.'); break;
      case 'gc3': promptPlayers(state, { title: 'GC3 — send someone to the start', text: 'Choose a player. They go to tile 1.', cardId: id, data: { op: 'gc3_target' } }); break;
      case 'gc4': forward(state, pid, 5); break;
      case 'gc5':
        promptPlayers(state, { title: 'GC5 — swap with someone ahead', text: 'Choose a player ahead of you.', cardId: id,
          data: { op: 'gc5_target' }, filter: function (q) { return q.tile > p.tile; }, emptyText: 'No one is ahead — nothing happens.' });
        break;
      case 'gc6': case 'gc8': case 'gc11': case 'gc13': case 'gc20': case 'gc21': case 'gc24': case 'gc33':
        log(state, label(id) + ' is passive: keep it in your hand for it to keep working.');
        break;
      case 'gc7': {
        var hist = Array.from(new Set(p.history.filter(function (t) { return t !== p.tile; }))).slice(-16);
        if (!hist.length) { log(state, 'No previous tiles to return to.'); break; }
        setPrompt(state, { title: 'GC7 — return to a previous tile', text: 'Choose any tile you have been on.', cardId: id,
          kind: 'options', multi: 0, data: { op: 'gc7_tile', pid: pid },
          options: hist.map(function (t) { return { label: 'Tile ' + t, value: t }; }) });
        break;
      }
      case 'gc9': {
        var base = nearestLadder(p.tile);
        log(state, 'Nearest ladder is at ' + base + ' → ' + LADDERS[base] + '.');
        setTile(state, pid, base, { landing: true });
        break;
      }
      case 'gc10':
        win(state, pid, 'GC10 — You win.', true);
        break;
      case 'gc12': p.status.curseTile = p.tile; log(state, 'Tile ' + p.tile + ' will be cursed with the next Bad card you draw.'); break;
      case 'gc14': {
        var up = verticalTile(p.tile, 'up'), down = verticalTile(p.tile, 'down');
        setPrompt(state, { title: 'GC14 — move vertically by one tile', text: 'The board is 10 columns wide. Pick a direction.', cardId: id,
          kind: 'options', multi: 0, data: { op: 'gc14_vertical', pid: pid },
          options: [{ label: 'Up → tile ' + (up == null ? '—' : up), value: 'up', disabled: up == null },
                    { label: 'Down → tile ' + (down == null ? '—' : down), value: 'down', disabled: down == null }] });
        break;
      }
      case 'gc15': state.flags.snakeMirror = pid; log(state, 'The next snake you come across will act as a ladder.'); break;
      case 'gc16': promptPlayers(state, { title: 'GC16 — make someone immobile', text: 'Choose a player to skip their next turn.', cardId: id, data: { op: 'gc16_target' } }); break;
      case 'gc17': setTile(state, pid, p.prevTile, { landing: true }); p.status.extraRolls += 1; log(state, 'Return to your last tile, then roll again.'); break;
      case 'gc18':
        forwardEveryone(state, 1);
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'GC18 — EVERYONE +1 SPACE', text: nameOf(state, pid) + ' played GC18 — everyone moves forward 1 space.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'gc19': state.flags.nextBadToLadderTop = pid; log(state, 'Your next Bad card goes to the top of a ladder instead of resolving.'); break;
      case 'gc22':
        clearRules(state);
        milestone(state, 'clear', { n: effLogN, pid: pid });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'GC22 — ALL RULES CLEARED', text: nameOf(state, pid) + ' played GC22 — every card rule, status, and curse is removed.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'gc23': promptPlayers(state, { title: 'GC23 — drag someone back two', text: 'Choose a player ahead of you.', cardId: id,
        data: { op: 'gc23_target' }, filter: function (q) { return q.tile > p.tile; }, emptyText: 'No one is ahead — nothing happens.' }); break;
      case 'gc25': state.jazzCue = true; log(state, 'Play jazz. Immediately.'); break;
      case 'gc26':
        log(state, 'Table call: ' + nameOf(state, nxt) + ' has to buy you food.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'GC26 — TABLE CALL', text: nameOf(state, nxt) + ' has to buy ' + nameOf(state, pid) + ' food.',
          actor: pid, pendingPids: state.cfg.practiceBot ? [0] : (nxt !== pid ? [nxt, pid] : [pid]) });
        break;
      case 'gc27':
        state.flags.snakeImmunityBanned = true;
        state.players.forEach(function (q) { q.hand.filter(function (c) { return c.id === 'gc8'; }).forEach(function (c) { pluckCard(state, q.i, c.uid); discardCard(state, c); }); });
        log(state, 'No one can ever be immune to snakes again. Ever.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'GC27 — NO SNAKE IMMUNITY', text: 'No one can ever be immune to snakes again. Any GC8 in hand is discarded.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'gc28':
        P(state, nxt).status.skipTurns += 1;
        log(state, nameOf(state, nxt) + ' misses their next turn.');
        if (nxt !== pid) {
          pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
            title: 'GC28 — TURN SKIPPED', text: nameOf(state, pid) + ' played GC28 — ' + nameOf(state, nxt) + ' misses their next turn.',
            actor: pid, pendingPids: [state.cfg.practiceBot && nxt > 0 ? 0 : nxt] });
        }
        break;
      case 'gc29': {
        var h29 = P(state, nxt).hand;
        if (!h29.length) { log(state, nameOf(state, nxt) + ' has no cards to steal.'); break; }
        var stolen = pluckCard(state, nxt, h29[ri(h29.length)].uid);
        var stN = log(state, nameOf(state, pid) + ' steals a random card from ' + nameOf(state, nxt) + '.', stolen.id);
        milestone(state, 'steal', { n: stN, pid: pid, target: nxt, cardId: 'gc29' });
        pushBanner(state, { kind: 'card', cardId: 'gc29', card: cardView(stolen), private: true,
          title: 'GC29 — CARD STOLEN',
          text: nameOf(state, pid) + ' stole ' + label(stolen.id) + ' from ' + nameOf(state, nxt) + '.',
          actor: pid, pendingPids: state.cfg.practiceBot ? [0] : (nxt !== pid ? [nxt, pid] : [pid]) });
        transferCard(state, nxt, pid, stolen);
        break;
      }
      case 'gc30': promptPlayers(state, { title: 'GC30 — force another player to roll', text: 'They get an extra roll on their next turn.', cardId: id, data: { op: 'gc30_target' } }); break;
      case 'gc31': forward(state, pid, 7); break;
      case 'gc32': {
        var r32 = d6();
        log(state, 'Roll again: ' + r32 + '. ' + (r32 >= 4 ? '4–6, so three more tiles.' : '1–3, so stay where you are.'));
        if (r32 >= 4) forward(state, pid, 3);
        break;
      }
      case 'gc34': promptPlayers(state, { title: 'GC34 — drag anyone back 10', text: 'Choose a player.', cardId: id, data: { op: 'gc34_target' } }); break;
      case 'gc35': forward(state, pid, 9); break;
      case 'gc36': {
        var lo = Math.max(-9, p.tile - 10), hi = Math.min(100, p.tile + 10), tiles = [];
        for (var t = lo; t <= hi; t++) if (t !== p.tile) tiles.push({ label: 'Tile ' + t, value: t });
        setPrompt(state, { title: 'GC36 — move to any tile within 10', text: 'Choose a tile from ' + lo + ' to ' + hi + '.', cardId: id,
          kind: 'options', multi: 0, data: { op: 'gc36_tile', pid: pid }, options: tiles });
        break;
      }

      /* ---------------- VERTIGO ---------------- */
      case 'vc1': promptPlayers(state, { title: 'VC1 — give a card away', text: 'Choose who gets one of your cards.', cardId: id, data: { op: 'vc1_target' } }); break;
      case 'vc2':
        rotateTiles(state, -state.direction);
        var v2n = log(state, 'All players swap tiles opposite turn order.', id);
        milestone(state, 'swap', { n: v2n, pid: pid, cardId: id });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC2 — ALL TILES ROTATED', text: 'All players swapped tiles opposite turn order!',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc3':
        rotateTiles(state, state.direction);
        var v3n = log(state, 'All players swap tiles in turn order.', id);
        milestone(state, 'swap', { n: v3n, pid: pid, cardId: id });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC3 — ALL TILES ROTATED', text: 'All players swapped tiles in turn order!',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc4': enqueueDraw(state, pid, 3); break;
      case 'vc5': enqueueDraw(state, pid, 2); break;
      case 'vc6': promptPlayers(state, { title: 'VC6 — look at someone’s cards', text: 'Look at another player’s cards at the cost of one of your Good cards.', cardId: id, data: { op: 'vc6_target' } }); break;
      case 'vc7': {
        var opts7 = cardOptions(state, pid);
        if (!opts7.length) { log(state, 'No cards to forfeit.'); break; }
        setPrompt(state, { title: 'VC7 — forfeit a card', text: 'Choose any card in your hand to discard.', cardId: id,
          kind: 'cards', multi: 0, data: { op: 'vc7_forfeit', pid: pid }, options: opts7 });
        break;
      }
      case 'vc8': enqueueDraw(state, pid, 1); break;
      case 'vc9': {
        var closest = state.players.filter(function (q) { return q.alive && q.i !== pid; })
          .sort(function (a, b) { return Math.abs(a.tile - p.tile) - Math.abs(b.tile - p.tile); })[0];
        if (!closest) { log(state, 'No one to swap with.'); break; }
        var t9 = p.tile; setRawTile(state, pid, closest.tile); setRawTile(state, closest.i, t9);
        var v9n = log(state, 'Swapped places with ' + nameOf(state, closest.i) + ' (closest).', id);
        milestone(state, 'swap', { n: v9n, pid: pid, target: closest.i, cardId: id });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC9 — TILES SWAPPED',
          text: nameOf(state, pid) + ' swapped places with ' + nameOf(state, closest.i) + ' (closest pawn — now on tile ' + t9 + ').',
          actor: pid, pendingPids: [state.cfg.practiceBot && closest.i > 0 ? 0 : closest.i] });
        break;
      }
      case 'vc10': p.status.alphabeticalUntilRound = state.round + 4; log(state, 'Alphabetical rolling for the next four rounds: 1→5, 2→4, 3→1, 4→6, 5→3, 6→2.'); break;
      case 'vc11':
        everyoneTo(state, 50);
        milestone(state, 'warp', { n: effLogN, pid: pid, tile: 50, cardId: id });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC11 — EVERYONE TO TILE 50',
          text: 'Everyone moved to tile 50! Each player will draw a card for landing on 50.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc12': state.flags.nextDrawGiveTo = pid; log(state, 'The next person to draw has to give their card to you.'); break;
      case 'vc13':
        state.flags.noMoveUntilTurnOf = pid;
        log(state, 'No one moves until it is your turn again.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC13 — MOVEMENT FROZEN',
          text: 'No one moves until it is ' + nameOf(state, pid) + '’s turn again.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc14': p.status.nextCardGiveToNext = true; log(state, 'Your next card goes to the next player, and you draw another.'); break;
      case 'vc15':
        state.players.forEach(function (q) { discardHand(state, q.i); });
        log(state, 'Everyone’s cards are discarded.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC15 — ALL HANDS DISCARDED',
          text: 'Everyone discards all cards in their hand.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc16': {
        var cnt = p.hand.length;
        if (cnt <= 1) { log(state, 'This is your only card (or none) — VC16 is discarded.'); break; }
        discardHand(state, pid);
        enqueueDraw(state, pid, cnt);
        log(state, 'Discard ' + cnt + ' cards, draw ' + cnt + '.');
        break;
      }
      case 'vc17': log(state, 'Nothing happens.'); break;
      case 'vc18':
        state.direction *= -1;
        var v18n = log(state, 'Play order direction is now ' + (state.direction === 1 ? 'clockwise' : 'counter-clockwise') + '.', id);
        milestone(state, 'direction', { n: v18n, pid: pid });
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC18 — ORDER REVERSED',
          text: 'Play order direction is now ' + (state.direction === 1 ? 'clockwise' : 'counter-clockwise') + '.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc19':
        rotateHands(state, state.direction);
        log(state, 'Everyone swaps hands in the play order’s direction.');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC19 — ALL HANDS ROTATED',
          text: 'Everyone swapped hands in play order! Check your hand to see your new cards.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      case 'vc20':
        if (instantBlocked(state)) {
          var v20b = log(state, 'VC25 blocks the instant result.', 'vc25');
          milestone(state, 'vc25_block', { n: v20b, pid: pid, cardId: 'vc20' });
          pushBanner(state, { kind: 'effect', cardId: 'vc25',
            title: 'VC25 — BLOCKED',
            text: 'VC20 tried to end the game, but VC25 blocked the instant result!',
            pendingPids: globalBannerPids(state, pid) });
        } else {
          state.gameover = true; state.winner = null; state.endReason = 'VC20 — the game ends. No one wins.';
          state.phase = 'gameover'; state.queue.length = 0; state.prompt = null; state.reveal = null;
          var v20n = log(state, 'Game over — VC20: the game ends. No one wins.', 'vc20');
          milestone(state, 'no_win', { n: v20n, pid: pid, cardId: 'vc20' });
        }
        break;
      case 'vc21': {
        var opts21 = cardOptions(state, pid);
        if (!opts21.length) { log(state, 'No card in hand to curse.'); break; }
        setPrompt(state, { title: 'VC21 — curse a card in your hand', text: 'The hidden Bad card only activates when that card is stolen.', cardId: id,
          kind: 'cards', multi: 0, data: { op: 'vc21_curse', pid: pid }, options: opts21 });
        break;
      }
      case 'vc22': state.flags.snatchNextGood = pid; log(state, 'The next Good card someone else plays is snatched into your hand.'); break;
      case 'vc23': log(state, 'Table call: tell a fun fact.'); break;
      case 'vc24': log(state, 'Table call: you now owe £1 to the Rothschilds family. (This is a joke, not a transaction.)'); break;
      case 'vc25': log(state, 'VC25 stays in your hand and cannot be played: no instant result card will work.'); break;
      case 'vc26': promptPlayers(state, { title: 'VC26 — swap hands', text: 'Choose a player. You may not look until you have their hand.', cardId: id, data: { op: 'vc26_target' } }); break;
      case 'vc27': log(state, 'Table call: insult another player.'); break;
      case 'vc28': log(state, 'Table call: compliment another player.'); break;
      case 'vc29': state.flags.cubedUntilRound = state.round + 1; log(state, 'Every rolled number is squared for a round.'); break;
      case 'vc30': {
        var counts = state.players.map(function (q) { return q.hand.length; });
        state.players.forEach(function (q) { q.hand.splice(0).forEach(function (c) { c.meta = {}; c.sticky = false; c.passive = false; c.playable = true; state.deck.push(c); }); });
        state.discard.splice(0).forEach(function (c) { c.meta = {}; state.deck.push(c); });
        shuffle(state.deck);
        state.players.forEach(function (q, i) { var k = i === pid ? Math.max(0, counts[i] - 1) : counts[i]; if (k) enqueueDraw(state, q.i, k); });
        log(state, 'All cards go back, the deck is reshuffled, and everyone redraws their hand (you draw one less).');
        pushBanner(state, { kind: 'effect', cardId: id, card: cardView(card),
          title: 'VC30 — EVERYONE REDRAWS',
          text: 'All hands were reshuffled into the deck. Each player will redraw their cards.',
          actor: pid, pendingPids: globalBannerPids(state, pid) });
        break;
      }
      case 'vc31': promptPlayers(state, { title: 'VC31 — someone else draws', text: 'Choose another player to draw a card.', cardId: id, data: { op: 'vc31_target' } }); break;
      case 'vc32': state.flags.negateNextCard = pid; log(state, 'The next card, yours or not, is negated.'); break;
      case 'vc33': promptPlayers(state, { title: 'VC33 — discard someone else’s card', text: 'Choose a player, then one of their cards.', cardId: id, data: { op: 'vc33_target' } }); break;
      case 'vc34': case 'vc35': log(state, 'Hold both variants (VC34 + VC35) to win.'); break;
      case 'vc36': promptPlayers(state, { title: 'VC36 — make someone discard their hand', text: 'Choose a player.', cardId: id, data: { op: 'vc36_target' } }); break;

      /* internal helper effect */
      case '__gc20': forward(state, pid, 5); log(state, 'GC20: the Bad card still worked, but you also move five tiles ahead.'); break;
      default: log(state, 'No automated effect for ' + label(id) + ' — the table resolves it.');
    }

    // Do not rush onto the next queued card until whoever is responsible acknowledges this card.
    if (!state.gameover && !state.prompt && !state.reveal && (state.banners || []).length === bannersBefore &&
        state.queue.length > 0 && id !== 'vc4' && id !== 'vc5' && id !== 'vc8' && id !== 'vc16') {
      pushBanner(state, {
        kind: 'effect', cardId: id, card: cardView(card),
        title: label(id) + ' RESOLVED',
        text: CARDS[id] ? CARDS[id].text : 'Effect resolved.',
        actor: pid, pendingPids: [state.cfg.practiceBot && pid > 0 ? 0 : pid]
      });
    }
  }

  /* ---------- turns ---------- */
  function beginTurn(state) {
    var p = cur(state);
    state.rolledThisTurn = false; p.drewThisTurn = false; state.canEndTurn = false;
    state.turnStartTile = p.tile;
    var tn = log(state, '— Round ' + state.round + ' · ' + nameOf(state, p.i) + '’s turn (tile ' + p.tile + ') —');
    state.lastTurnLogN = tn;
  }
  function doRoll(state, action) {
    var p = cur(state);
    if (state.rolledThisTurn || state.prompt || state.reveal || (state.banners && state.banners.length)) return;
    var raw = action && action.value != null && action.value !== '' ? clamp(Number(action.value) || 1, 1, 6) : d6();
    var die = raw;
    if (p.status.alphabeticalUntilRound >= state.round) die = ALPHA_MAP[raw] || raw;
    if (state.flags.cubedUntilRound >= state.round) die = Math.pow(die, 2);
    if (hasCard(state, p.i, 'bc14')) die = Math.max(0, die - 1);
    state.lastDieRaw = raw; state.lastDie = die;
    p.lastRoll = die;
    var rn = log(state, nameOf(state, p.i) + ' rolled ' + raw + (die !== raw ? ' → ' + die : '') + '.');
    milestone(state, 'roll', { n: rn, pid: p.i, raw: raw, die: die, turnLogN: state.lastTurnLogN });
    state.rolledThisTurn = true;
    state.canEndTurn = false;

    if (p.status.needSix) {
      p.status.needSix = false;
      if (raw !== 6) {
        log(state, 'BC4: the roll was not a 6.');
        toNemo(state, p.i, 'bc4');
        pushBanner(state, { kind: 'effect', cardId: 'bc4', title: 'BC4 — TO POINT NEMO',
          text: nameOf(state, p.i) + ' did not roll a 6 and went to Point Nemo (tile −1).',
          actor: p.i, pendingPids: [state.cfg.practiceBot && p.i > 0 ? 0 : p.i] });
        return;
      }
      log(state, 'BC4: the roll was a 6. Safe.');
    }
    // Point Nemo includes tile 0: at the start of a turn there, the drag takes
    // the player to −1 before the roll is applied.
    if (p.tile <= 0) {
      setRawTile(state, p.i, p.tile - 1);
      log(state, 'Point Nemo drags ' + nameOf(state, p.i) + ' back to tile ' + (p.tile < 0 ? '−' + Math.abs(p.tile) : p.tile) + '.');
      if (p.tile <= -9) { lose(state, p.i, 'landed on tile −9', false); return; }
    }
    if (state.flags.noMoveUntilTurnOf != null && state.flags.noMoveUntilTurnOf !== p.i) {
      log(state, 'VC13: no one moves until ' + nameOf(state, state.flags.noMoveUntilTurnOf) + '’s turn.');
      return;
    }
    if (p.tile < 0) {
      var t = p.tile + die;
      if (t === 0) {
        var eo = log(state, 'Exact roll onto zero — escaped onto tile 1.');
        milestone(state, 'nemo_out', { n: eo, pid: p.i });
        setTile(state, p.i, 1, { landing: true });
      }
      else if (t > 0) { setRawTile(state, p.i, 0); log(state, 'Overshot zero — you land on 0 and need a 1 to escape.'); }
      else setRawTile(state, p.i, t);
      return;
    }
    var target = p.tile + die;
    if (target > 100) {
      if (hasCard(state, p.i, 'gc33')) {
        var g33n = log(state, 'GC33: no exact roll needed.', 'gc33');
        milestone(state, 'gc33', { n: g33n, pid: p.i });
        setTile(state, p.i, 100, { landing: true });
      }
      else {
        var emn = log(state, 'Exact roll needed for tile 100 — ' + nameOf(state, p.i) + ' stays on ' + p.tile + '.');
        milestone(state, 'exact_miss', { n: emn, pid: p.i, tile: p.tile });
      }
    } else setTile(state, p.i, target, { landing: true });
  }
  function endTurn(state) {
    if (state.gameover || state.prompt || state.reveal || (state.banners && state.banners.length) || state.queue.length) return;
    var leaving = state.turnIndex;
    state.watchers.filter(function (w) { return w.target === leaving; }).forEach(function (w) {
      var did = P(state, w.target).drewThisTurn;
      if (did !== w.requireDraw) {
        var cid = 'bc' + (w.requireDraw ? '36' : '35');
        log(state, label(cid) + ': the watched player ' + (did ? 'drew' : 'did not draw') + ' a card.');
        toNemo(state, w.owner, cid);
        pushBanner(state, { kind: 'effect', cardId: cid,
          title: label(cid) + ' — TO POINT NEMO',
          text: nameOf(state, w.target) + ' ' + (did ? 'drew' : 'did not draw') + ' a card, sending ' + nameOf(state, w.owner) + ' to Point Nemo.',
          actor: w.owner, pendingPids: [state.cfg.practiceBot && w.owner > 0 ? 0 : w.owner] });
      }
    });
    state.watchers = state.watchers.filter(function (w) { return w.target !== leaving; });

    var p = P(state, leaving);
    if (p.status.extraRolls > 0) {
      p.status.extraRolls--;
      state.rolledThisTurn = false; state.canEndTurn = false; p.drewThisTurn = false;
      log(state, nameOf(state, leaving) + ' rolls again.');
      return;
    }
    state.turnCount++;
    state.round = Math.floor(state.turnCount / N(state)) + 1;
    // expire round-based effects
    state.players.forEach(function (q) { if (q.status.skipUntilRound && q.status.skipUntilRound < state.round) q.status.skipUntilRound = 0; });
    if (state.flags.cubedUntilRound && state.flags.cubedUntilRound < state.round) delete state.flags.cubedUntilRound;

    var guard = 0;
    while (guard++ < 24) {
      state.turnIndex = (state.turnIndex + state.direction + N(state)) % N(state);
      var q = P(state, state.turnIndex);
      if (!q.alive) continue;
      if (q.status.skipTurns > 0) {
        q.status.skipTurns--;
        log(state, nameOf(state, q.i) + ' cannot roll this turn.');
        continue;
      }
      if (q.status.skipUntilRound && state.round <= q.status.skipUntilRound) {
        log(state, nameOf(state, q.i) + ' cannot roll (round ' + state.round + ' of ' + q.status.skipUntilRound + ').');
        continue;
      }
      break;
    }
    if (state.flags.noMoveUntilTurnOf === state.turnIndex) {
      delete state.flags.noMoveUntilTurnOf;
      log(state, 'VC13 ends — ' + nameOf(state, state.turnIndex) + ' can move again.');
    }
    beginTurn(state);
    if (P(state, state.turnIndex).status.skipUntilRound) state.canEndTurn = true;
  }

  /* ---------- actions ---------- */
  function snapshot(state) {
    var s = clone(state);
    delete s.history;
    state.history.push(s);
    if (state.history.length > 40) state.history.shift();
  }
  function undo(state) {
    if (!state.history.length) return state;
    var currentVersion = state.version;
    var prev = state.history.pop(), h = state.history;
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.assign(state, prev);
    state.history = h;
    state.version = currentVersion + 1;
    return state;
  }
  function playCard(state, action) {
    var pid = state.turnIndex;
    var card = findHandCard(state, pid, action.uid);
    if (!card || card.sticky || state.prompt || state.reveal || (state.banners && state.banners.length)) return;
    if (state.flags.snatchNextGood != null && state.flags.snatchNextGood !== pid && typeOf(card.id) === 'Good') {
      var thief = state.flags.snatchNextGood; delete state.flags.snatchNextGood;
      pluckCard(state, pid, card.uid);
      var v22n = log(state, 'VC22: ' + nameOf(state, thief) + ' snatches ' + label(card.id) + ' the moment it is played.', card.id);
      milestone(state, 'steal', { n: v22n, pid: thief, target: pid, cardId: 'vc22' });
      pushBanner(state, { kind: 'card', cardId: 'vc22', card: cardView(card), private: true,
        title: 'VC22 — CARD SNATCHED',
        text: nameOf(state, thief) + ' snatched ' + label(card.id) + ' from ' + nameOf(state, pid) + ' the moment it was played.',
        actor: thief, pendingPids: state.cfg.practiceBot ? [0] : [pid, thief] });
      transferCard(state, pid, thief, card);
      return;
    }
    if (state.flags.negateNextCard != null) {
      var by = state.flags.negateNextCard; delete state.flags.negateNextCard;
      pluckCard(state, pid, card.uid); discardCard(state, card);
      var v32n = log(state, label(card.id) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').', card.id);
      milestone(state, 'vc32_negate', { n: v32n, pid: by, cardId: card.id });
      pushBanner(state, { kind: 'effect', cardId: 'vc32', card: cardView(card),
        title: 'VC32 — CARD NEGATED',
        text: label(card.id) + ' played by ' + nameOf(state, pid) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').',
        actor: by, pendingPids: state.cfg.practiceBot ? [0] : (by !== pid ? [pid, by] : [pid]) });
      return;
    }
    pluckCard(state, pid, card.uid);
    discardCard(state, card);
    log(state, nameOf(state, pid) + ' plays ' + label(card.id) + '.', card.id);
    state.queue.push({ t: 'apply', card: card, pid: pid, fromPid: pid });
  }

  function apply(state, action) {
    if (!action || !action.type) return state;
    if (!state.banners) state.banners = [];
    if (!state.milestones) state.milestones = [];
    var t = action.type;
    if (t === 'UNDO') return undo(state);
    if (t === 'SET_NAME' && state.phase === 'lobby' && state.players[action.pid]) {
      state.players[action.pid].name = String(action.name || '').slice(0, 24) || ('Player ' + (action.pid + 1));
      state.version++;
      return state;
    }
    if (t === 'START') { startGame(state); state.version++; return state; }
    if (t === 'SET_CONFIG') {
      if (state.phase !== 'lobby' && action.cfg && action.cfg.players != null) return state;
      Object.assign(state.cfg, action.cfg || {});
      var n = clamp(Number(state.cfg.players) || state.players.length, 1, 4);
      state.cfg.players = n;
      while (state.players.length > n) state.players.pop();
      while (state.players.length < n) {
        var idx = state.players.length;
        state.players.push(makePlayer(idx, (state.cfg.names && state.cfg.names[idx]) || ('Player ' + (idx + 1))));
      }
      if (state.turnIndex >= state.players.length) state.turnIndex = 0;
      state.version++;
      return state;
    }
    if (t === 'ACK_BANNER') {
      if (!state.banners.length) { state.lastElimination = null; state.version++; return state; }
      var b = state.banners[0];
      if (action.seat != null) {
        var pos = b.pendingPids.indexOf(action.seat);
        if (pos < 0) return state;
        b.pendingPids.splice(pos, 1);
      } else {
        b.pendingPids.shift();
      }
      if (!b.pendingPids.length) {
        state.banners.shift();
        if (b.kind === 'out' && !state.banners.some(function (x) { return x.kind === 'out'; })) {
          state.lastElimination = null;
        }
      }
      state.version++;
      settle(state);
      return state;
    }
    if (t === 'ACK_ELIM') {
      if (state.banners.length && state.banners[0].kind === 'out') {
        var ob = state.banners[0];
        if (action.seat != null && ob.pendingPids.indexOf(action.seat) >= 0) {
          ob.pendingPids.splice(ob.pendingPids.indexOf(action.seat), 1);
        } else {
          ob.pendingPids.length = 0;
        }
        if (!ob.pendingPids.length) state.banners.shift();
      }
      if (!state.banners.some(function (x) { return x.kind === 'out'; })) state.lastElimination = null;
      state.version++;
      settle(state);
      return state;
    }
    if (t === 'DM_SKIP_BANNER') {
      if (action.seat != null && action.seat !== 0) return state;
      if (state.banners.length) {
        var sb = state.banners.shift();
        if (sb.kind === 'out' && !state.banners.some(function (x) { return x.kind === 'out'; })) state.lastElimination = null;
      }
      state.version++;
      settle(state);
      return state;
    }
    if (state.phase !== 'turn' || state.gameover) return state;
    if (state.banners.length && t.indexOf('DM_') !== 0) return state;
    if (action.seat != null && (t === 'ROLL' || t === 'PLAY_CARD' || t === 'END_TURN') && action.seat !== state.turnIndex) return state;
    if (action.seat != null && t === 'ANSWER' && action.seat !== (state.prompt ? state.prompt.forPid : state.turnIndex)) return state;
    if (action.seat != null && t === 'ACK' && action.seat !== (state.reveal ? state.reveal.pid : state.turnIndex)) return state;
    if (action.seat != null && t.indexOf('DM_') === 0 && action.seat !== 0) return state;
    snapshot(state);
    switch (t) {
      case 'ROLL': doRoll(state, action); break;
      case 'PLAY_CARD': playCard(state, action); break;
      case 'ANSWER': answer(state, action.value); break;
      case 'ACK':
        if (state.reveal) { state.reveal = null; state.jazzCue = false; }
        break;
      case 'END_TURN': endTurn(state); break;
      case 'DM_SET_TILE': setTile(state, action.pid, action.tile, { landing: action.landing !== false }); break;
      case 'DM_MOVE': moveBy(state, action.pid, action.delta, null); break;
      case 'DM_NEMO': toNemo(state, action.pid); break;
      case 'DM_DRAW': enqueueDraw(state, action.pid == null ? state.turnIndex : action.pid, action.count || 1); break;
      case 'DM_ELIMINATE': lose(state, action.pid, 'removed by the table', false); break;
      case 'DM_RESHUFFLE': reshuffle(state); break;
      case 'DM_CLEAR_RULES': clearRules(state); break;
      case 'DM_REVERSE': state.direction *= -1; log(state, 'Table reverses play order direction.'); break;
      case 'DM_END_TURN': state.queue.length = 0; state.prompt = null; state.reveal = null; state.banners.length = 0; state.lastElimination = null; state.rolledThisTurn = true; endTurn(state); break;
      default: break;
    }
    state.version++;
    settle(state);
    return state;
  }

  /* ---------- win chronicle / premade phrases ---------- */
  var WIN_PHRASES = {
    openers: [
      'All pawns set out together from tile 1 [{start}].',
      'With 108 cards shuffled into the deck, everyone began on tile 1 [{start}].',
      'Pawns lined up shoulder-to-shoulder at the base of the board [{start}].',
      'Across {rounds} chaotic rounds that started on tile 1 [{start}], the match took shape.',
      'From the opening deal on tile 1 [{start}], every roll carried risk.',
      'Once every pawn took its place on tile 1 [{start}], the race began.'
    ],
    turnContext: [
      'By Round {round}, the decisive stretch was underway [{turn}].',
      'Heading into Round {round}, the balance of the match shifted [{turn}].',
      'In Round {round}, the final push began [{turn}].',
      'Round {round} set up the closing stretch [{turn}].'
    ],
    ladders: [
      '{name} caught a massive break up the {from} → {to} ladder [{n}]',
      '{name} climbed the ladder from tile {from} straight up to {to} [{n}]',
      '{name} skipped ahead of the pack by climbing {from} → {to} [{n}]',
      '{name} hit the hidden ladder at {from} and rocketed onto {to} [{n}]'
    ],
    snakes: [
      '{name} had to claw back after sliding down the snake at {from} → {to} [{n}]',
      '{name} took a brutal drop on the {from} → {to} snake yet stayed in it [{n}]',
      '{name} survived a nasty snake bite from tile {from} down to {to} [{n}]',
      '{name} shook off a sharp slide from tile {from} down to {to} [{n}]'
    ],
    snakeMiracles: {
      snake_immune: [
        '{name} walked straight past the snake at {from} with snake immunity [{n}]',
        '{name} stayed untouched on tile {from} thanks to GC8 [{n}]'
      ],
      snake_second_chance: [
        '{name} turned the snake at {from} into a step ahead to tile {to} via GC21 [{n}]',
        'GC21 rescued {name} right at snake {from}, bumping them onto {to} [{n}]'
      ],
      snake_mirror: [
        '{name} flipped the snake at {from} into a ladder up to {to} with GC15 [{n}]',
        'GC15 mirrored the snake at {from} upward onto tile {to} for {name} [{n}]'
      ]
    },
    nemoIn: [
      '{name} was banished below zero into Point Nemo [{n}]',
      '{name} survived exile down in Point Nemo [{n}]',
      '{name} endured a drop below zero into Point Nemo [{n}]'
    ],
    nemoOut: [
      '{name} rolled an exact escape through zero back to tile 1 [{n}]',
      '{name} broke out of Point Nemo on an exact roll back into contention [{n}]'
    ],
    seq1: [
      '{name} opened the 3 → 7 → 13 run by landing on tile 3 [{n}]',
      '{name} claimed tile 3 as the first step of the sequence [{n}]',
      '{name} started the secret sequence by touching down on tile 3 [{n}]'
    ],
    seq2: [
      '{name} returned on a separate turn to lock in tile 7 [{n}]',
      '{name} reached 2/3 of the sequence by landing on tile 7 [{n}]',
      '{name} stepped onto tile 7 to move one rung from a sequence win [{n}]'
    ],
    seq3: [
      '{name} landed on tile 13 before the snake could bite to finish 3 → 7 → 13 [{n}]',
      '{name} stepped onto tile 13 on a fresh turn to seal the sequence [{n}]'
    ],
    dramatic: {
      swap: [
        '{name} pulled off a pivotal tile swap via {card} [{n}]',
        'a timely {card} tile swap reshaped positions on the board [{n}]'
      ],
      steal: [
        '{name} snatched a card away from {target} with {card} [{n}]',
        '{card} forced a sudden hand shake-up involving {name} [{n}]'
      ],
      warp1: [
        'BC25 dragged the entire table all the way back to tile 1 [{n}]',
        'everyone was reset back to the starting tile by BC25 [{n}]'
      ],
      warp50: [
        'VC11 warped every surviving pawn straight onto tile 50 [{n}]',
        'every pawn jumped together to tile 50 after VC11 fired [{n}]'
      ],
      gc13_save: [
        '{name} defied elimination when GC13 blocked a loss on the spot [{n}]',
        'GC13 kept {name} alive when defeat looked certain [{n}]'
      ],
      gc11_block: [
        '{name} used GC11 to intercept {target}’s instant win and send them to tile 1 [{n}]',
        'GC11 stopped an instant victory cold and reset {target} to the start [{n}]'
      ],
      vc25_block: [
        'VC25 stepped in to block an instant game-ender [{n}]',
        'an instant result card was shut down by VC25 before it could resolve [{n}]'
      ],
      vc32_negate: [
        '{name} used VC32 to negate a card on impact [{n}]',
        'VC32 canceled a card before its effect could land [{n}]'
      ],
      curse_hit: [
        'a hidden curse on tile {tile} sprang onto {name} [{n}]',
        'stepping onto a cursed tile triggered a hidden trap on {name} [{n}]'
      ],
      clear: [
        'GC22 wiped every ongoing card rule clean off the table [{n}]'
      ],
      direction: [
        'VC18 flipped the turn order into reverse [{n}]'
      ],
      exact_miss: [
        '{name} was turned back from tile 100 by the exact-roll rule [{n}]',
        'an overshoot stalled {name} shy of tile 100 [{n}]'
      ],
      gc33: [
        'GC33 let {name} ignore the exact-roll rule at tile 100 [{n}]'
      ]
    },
    elims: {
      nemo9: [
        '{name} sank all the way to tile −9 and was eliminated [{n}]',
        '{name} hit the −9 floor of Point Nemo and dropped out [{n}]'
      ],
      bc30: [
        '{name} drew BC30 and lost on the spot [{n}]',
        'the instant-loss card BC30 knocked {name} out immediately [{n}]'
      ],
      bc22: [
        '{name} had no Good cards to satisfy BC22 and was knocked out [{n}]'
      ],
      bc7: [
        '{name} drew matching card types back-to-back while holding BC7 and lost [{n}]'
      ],
      bc11: [
        '{name} went down in a mutual BC11 elimination [{n}]'
      ],
      prediction: [
        '{name} missed a card-type prediction and was eliminated [{n}]'
      ],
      tableCall: [
        '{name} failed a table call and exited the match [{n}]'
      ],
      dm: [
        '{name} was removed from the match by the table [{n}]'
      ],
      other: [
        '{name} was knocked out ({reason}) [{n}]'
      ]
    },
    closers: {
      tile100: [
        'With a roll of {roll} [{rollN}], {winner} landed squarely on tile 100 to take the win [{winN}].',
        'Stepping onto tile 100 after rolling {roll} [{rollN}] sealed victory for {winner} [{winN}].',
        'With a roll of {roll} [{rollN}], {winner} reached tile 100 ahead of the field to clinch the match [{winN}].'
      ],
      tile100NoRoll: [
        'Finally, {winner} arrived on tile 100 to claim victory [{winN}].',
        'Landing squarely on tile 100 put {winner} over the top for the win [{winN}].'
      ],
      sequence: [
        'Completing 3 [{s1}], 7 [{s2}], and 13 [{s3}] on separate turns bypassed tile 100 and handed {winner} the sequence win [{winN}].',
        'By landing on 3 [{s1}], then 7 [{s2}], then 13 [{s3}] in turn order, {winner} triggered the secret sequence victory [{winN}].'
      ],
      lastStanding: [
        'With every other rival out of the running, {winner} stood alone as the last player standing [{winN}].',
        'Outlasting the entire table as opponents fell one by one crowned {winner} the winner [{winN}].'
      ],
      gc10: [
        'Playing GC10 ended the race on the spot and gave {winner} an instant victory [{winN}].',
        'No climb to 100 was needed — GC10 won the game immediately for {winner} [{winN}].'
      ],
      vc34_35: [
        'Holding both VC34 and VC35 variants together triggered an instant combo win for {winner} [{winN}].',
        'Uniting VC34 and VC35 in hand unlocked the variant instant win for {winner} [{winN}].'
      ],
      snake100: [
        'Turning a snake straight onto tile 100 gave {winner} a dramatic finish [{winN}].',
        'Riding a modified snake directly onto tile 100 sealed the match for {winner} [{winN}].'
      ],
      vc20: [
        'Then VC20 hit the table and ended the entire match on the spot — nobody wins [{winN}].',
        'In true VUSAL fashion, VC20 pulled the plug on the game immediately with zero winners [{winN}].'
      ],
      fallback: [
        'That decisive moment brought the game to an end, making {winner} the winner [{winN}].'
      ]
    }
  };

  function pickPhrase(arr, seed) {
    if (!arr || !arr.length) return '';
    return arr[Math.abs(seed || 0) % arr.length];
  }
  function fmtPhrase(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] != null ? String(vars[k]) : '';
    });
  }
  function extractCites(text) {
    var out = [], seen = {};
    String(text || '').replace(/\[(\d+)\]/g, function (_, num) {
      var n = Number(num);
      if (!seen[n]) { seen[n] = true; out.push(n); }
      return _;
    });
    return out;
  }
  function buildWinStory(state) {
    if (!state || !state.gameover) return null;
    var logs = state.log || [];
    var logMap = {};
    logs.forEach(function (l) { logMap[l.n] = l; });
    var ms = state.milestones || [];
    var w = state.winner == null ? null : P(state, state.winner);
    var winnerName = w ? nameOf(state, w.i) : 'No one';
    var seed = (state.turnCount || 0) * 7 + (state.nextLogN || logs.length) + (w ? w.i * 13 : 5);
    var parts = [];
    var usedN = {};
    var isSeqWin = !!(w && (w.seq === 3 || /3 → 7 → 13/.test(String(state.endReason || ''))));

    function addPart(text) {
      if (!text) return;
      var cites = extractCites(text);
      cites.forEach(function (n) { usedN[n] = true; });
      parts.push({ text: text, cites: cites });
    }

    var startM = ms.find(function (m) { return m.type === 'start'; }) || logs[0];
    var startN = startM ? startM.n : 1;
    addPart(fmtPhrase(pickPhrase(WIN_PHRASES.openers, seed), {
      start: startN, rounds: state.round || 1
    }));

    // Collect key turning-point milestones (prioritize winner + eliminations + major twists)
    var middle = [];
    var seqSteps = {};
    var lastWinRoll = null;
    var winM = null;

    ms.forEach(function (m) {
      if (m.type === 'win' || m.type === 'no_win') { winM = m; return; }
      if (m.type === 'roll' && w && m.pid === w.i) { lastWinRoll = m; return; }
      if (m.type === 'seq' && w && m.pid === w.i) { seqSteps[m.step] = m; }
      if (m.type === 'start') return;
      if (isSeqWin && m.type === 'seq' && w && m.pid === w.i && m.step === 3) return;
      var score = 1;
      if (m.type === 'elim' || m.type === 'seq' || m.type === 'gc11_block' || m.type === 'gc13_save' || m.type === 'vc25_block') score += 5;
      else if (m.type === 'ladder' || m.type === 'snake_mirror' || m.type === 'snake_second_chance' || m.type === 'warp' || m.type === 'nemo_out') score += 4;
      else if (m.type === 'snake' || m.type === 'nemo_in' || m.type === 'swap' || m.type === 'steal' || m.type === 'curse_hit') score += 3;
      if (w && m.pid === w.i) score += 2;
      middle.push({ m: m, score: score });
    });

    // Select top up to 5 distinct turning-point beats, then order chronologically by log #
    middle.sort(function (a, b) { return b.score - a.score || a.m.n - b.m.n; });
    var picked = [];
    var pickedTypes = {};
    for (var i = 0; i < middle.length && picked.length < 5; i++) {
      var item = middle[i], m = item.m;
      if (usedN[m.n]) continue;
      // Avoid picking two duplicate generic snakes/ladders unless different players or rare
      var key = m.type + ':' + (m.pid != null ? m.pid : '');
      if (m.type !== 'elim' && m.type !== 'seq' && pickedTypes[key]) continue;
      pickedTypes[key] = true;
      picked.push(m);
    }
    picked.sort(function (a, b) { return a.n - b.n; });

    // Optional round context if picked list is short
    if (picked.length < 2 && lastWinRoll && lastWinRoll.turnLogN && lastWinRoll.turnLogN !== startN) {
      addPart(fmtPhrase(pickPhrase(WIN_PHRASES.turnContext, seed + 1), {
        round: lastWinRoll.round || state.round, turn: lastWinRoll.turnLogN
      }));
    }

    picked.forEach(function (m, idx) {
      var nm = m.pid != null ? nameOf(state, m.pid) : 'A player';
      var tg = m.target != null ? nameOf(state, m.target) : 'another player';
      var s = seed + idx * 3 + m.n;
      var line = '';
      switch (m.type) {
        case 'ladder':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.ladders, s), { name: nm, from: m.from, to: m.to, n: m.n });
          break;
        case 'snake':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.snakes, s), { name: nm, from: m.from, to: m.to < 0 ? '−' + Math.abs(m.to) : m.to, n: m.n });
          break;
        case 'snake_immune': case 'snake_second_chance': case 'snake_mirror':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.snakeMiracles[m.type], s), { name: nm, from: m.from, to: m.to, n: m.n });
          break;
        case 'nemo_in':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.nemoIn, s), { name: nm, n: m.n });
          break;
        case 'nemo_out':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.nemoOut, s), { name: nm, n: m.n });
          break;
        case 'seq':
          if (m.step === 1) line = fmtPhrase(pickPhrase(WIN_PHRASES.seq1, s), { name: nm, n: m.n });
          else if (m.step === 2) line = fmtPhrase(pickPhrase(WIN_PHRASES.seq2, s), { name: nm, n: m.n });
          else if (m.step === 3) line = fmtPhrase(pickPhrase(WIN_PHRASES.seq3, s), { name: nm, n: m.n });
          break;
        case 'warp':
          line = fmtPhrase(pickPhrase(m.tile === 50 ? WIN_PHRASES.dramatic.warp50 : WIN_PHRASES.dramatic.warp1, s), { name: nm, n: m.n });
          break;
        case 'swap': case 'steal': case 'gc13_save': case 'gc11_block': case 'vc25_block':
        case 'vc32_negate': case 'curse_hit': case 'clear': case 'direction': case 'exact_miss': case 'gc33':
          line = fmtPhrase(pickPhrase(WIN_PHRASES.dramatic[m.type], s), {
            name: nm, target: tg, card: m.cardId ? label(m.cardId) : 'a card', tile: m.tile, n: m.n
          });
          break;
        case 'elim': {
          var r = String(m.reason || '');
          var grp = WIN_PHRASES.elims.other;
          if (/−9|-9/.test(r)) grp = WIN_PHRASES.elims.nemo9;
          else if (/bc30/i.test(r)) grp = WIN_PHRASES.elims.bc30;
          else if (/bc22/i.test(r)) grp = WIN_PHRASES.elims.bc22;
          else if (/bc7/i.test(r)) grp = WIN_PHRASES.elims.bc7;
          else if (/bc11/i.test(r)) grp = WIN_PHRASES.elims.bc11;
          else if (/prediction/i.test(r)) grp = WIN_PHRASES.elims.prediction;
          else if (/table call/i.test(r)) grp = WIN_PHRASES.elims.tableCall;
          else if (/removed by the table/i.test(r)) grp = WIN_PHRASES.elims.dm;
          line = fmtPhrase(pickPhrase(grp, s), { name: nm, reason: r, n: m.n });
          break;
        }
      }
      if (line) addPart(line.charAt(0).toUpperCase() + line.slice(1) + '.');
    });

    // Closer sentence tailored to exact win condition
    var winN = winM ? winM.n : (logs.length ? logs[logs.length - 1].n : startN);
    var reason = String(state.endReason || '');
    var closer = '';
    if (!w) {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.vc20, seed), { winN: winN });
    } else if (w.seq === 3 || /3 → 7 → 13/.test(reason)) {
      var s1 = seqSteps[1] ? seqSteps[1].n : startN;
      var s2 = seqSteps[2] ? seqSteps[2].n : winN;
      var s3 = seqSteps[3] ? seqSteps[3].n : winN;
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.sequence, seed), {
        winner: winnerName, s1: s1, s2: s2, s3: s3, winN: winN
      });
    } else if (/last player standing/i.test(reason)) {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.lastStanding, seed), { winner: winnerName, winN: winN });
    } else if (/gc10/i.test(reason)) {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.gc10, seed), { winner: winnerName, winN: winN });
    } else if (/vc34|vc35/i.test(reason)) {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.vc34_35, seed), { winner: winnerName, winN: winN });
    } else if (/gc15|gc21/i.test(reason)) {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.snake100, seed), { winner: winnerName, winN: winN });
    } else if (/tile 100/i.test(reason)) {
      if (lastWinRoll && lastWinRoll.n && lastWinRoll.n < winN) {
        closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.tile100, seed), {
          winner: winnerName, roll: lastWinRoll.die != null ? lastWinRoll.die : lastWinRoll.raw, rollN: lastWinRoll.n, winN: winN
        });
      } else {
        closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.tile100NoRoll, seed), { winner: winnerName, winN: winN });
      }
    } else {
      closer = fmtPhrase(pickPhrase(WIN_PHRASES.closers.fallback, seed), { winner: winnerName, winN: winN });
    }
    addPart(closer);

    var allCites = Object.keys(usedN).map(Number).sort(function (a, b) { return a - b; });
    var citedLogs = allCites.map(function (n) {
      return logMap[n] || { n: n, text: 'Log entry #' + n + ' (earlier in match)', cardId: null };
    });

    return {
      headline: w ? (winnerName + ' WINS') : 'NO ONE WINS',
      summary: parts.map(function (x) { return x.text; }).join(' '),
      parts: parts,
      citedLogs: citedLogs
    };
  }

  /* ---------- view ---------- */
  function statusLines(state, p) {
    var out = [];
    if (!p.alive) out.push('OUT');
    if (hasCard(state, p.i, 'bc2')) out.push('CAN’T DRAW');
    if (hasCard(state, p.i, 'bc7')) out.push('DOUBLE TYPE = OUT');
    if (hasCard(state, p.i, 'bc14')) out.push('ROLL −1');
    if (hasCard(state, p.i, 'gc8') && !state.flags.snakeImmunityBanned) out.push('SNAKE IMMUNE');
    if (hasCard(state, p.i, 'gc6')) out.push('REFLECT BAD');
    if (hasCard(state, p.i, 'gc11')) out.push('WIN REDIRECT');
    if (hasCard(state, p.i, 'gc13')) out.push('LOSE-PROOF');
    if (hasCard(state, p.i, 'gc20')) out.push('BAD CARD → +5');
    if (hasCard(state, p.i, 'gc21')) out.push('SNAKE 2ND CHANCE');
    if (hasCard(state, p.i, 'gc24')) out.push('DRAG REFLECT');
    if (hasCard(state, p.i, 'gc33')) out.push('NO EXACT FINISH');
    if (hasCard(state, p.i, 'vc25')) out.push('NO INSTANT RESULTS');
    if (p.status.needSix) out.push('NEXT ROLL MUST BE 6');
    if (p.status.nextCardType) out.push('NEXT CARD: ' + p.status.nextCardType.type.toUpperCase());
    if (p.status.nextCardGiveToNext) out.push('NEXT CARD PASSES ON');
    if (p.status.curseTile != null) out.push('CURSE PENDING: TILE ' + p.status.curseTile);
    if (p.status.badImmuneRolls) out.push('BAD IMMUNE (NEXT ROLL)');
    if (p.status.extraRolls) out.push('+' + p.status.extraRolls + ' ROLL');
    if (p.status.skipTurns) out.push('IMMOBILE');
    if (p.status.skipUntilRound >= state.round && p.status.skipUntilRound) out.push('CAN’T ROLL');
    if (p.status.alphabeticalUntilRound >= state.round && p.status.alphabeticalUntilRound) out.push('ALPHABETICAL ROLLS');
    if (p.seq) out.push('3→7→13: ' + p.seq + '/3 · one step per turn');
    if (state.flags.snakeMirror === p.i) out.push('NEXT SNAKE → LADDER');
    if (state.flags.nextBadToLadderTop === p.i) out.push('NEXT BAD → LADDER TOP');
    if (state.flags.noMoveUntilTurnOf === p.i) out.push('MOVEMENT FREEZE');
    if (p.tile < 0 || p.tile === 0) out.push('POINT NEMO');
    return out;
  }
  function view(state, seat) {
    var s = clone(state);
    s.deckCount = state.deck.length;
    s.discardCount = state.discard.length;
    s.discardTop = state.discard.length ? cardView(state.discard[state.discard.length - 1]) : null;
    s.cursedTiles = Object.keys(state.curses).map(Number);
    s.globalFlags = Object.keys(state.flags).filter(function (k) {
      return ['cubedUntilRound', 'snakeImmunityBanned', 'noMoveUntilTurnOf', 'nextDrawGiveTo', 'negateNextCard', 'snatchNextGood', 'snakeMirror', 'nextBadToLadderTop'].indexOf(k) >= 0;
    }).map(function (k) { return k + ': ' + state.flags[k]; });
    s.players = state.players.map(function (p) {
      return {
        i: p.i, name: p.name, tile: p.tile, alive: p.alive, seq: p.seq,
        handCount: p.hand.length,
        hand: p.i === seat ? p.hand.map(cardView) : [],
        statuses: statusLines(state, p)
      };
    });
    s.yourSeat = seat;
    s.you = s.players[seat] || null;
    s.canAck = !!(state.reveal && state.reveal.pid === seat);
    s.canAnswer = !!(state.prompt && state.prompt.forPid === seat);

    if (state.reveal) {
      if (state.reveal.pid === seat) {
        s.reveal = clone(state.reveal);
      } else if (state.reveal.public) {
        var pubRev = clone(state.reveal);
        if (pubRev.cards && pubRev.cards.length) {
          pubRev.cards = pubRev.cards.map(function (it) {
            if (it.public) return it;
            return { card: null, secret: true, text: 'Kept secret in hand', kept: true, public: false, jazz: false, statusNote: 'KEPT IN HAND (SECRET)' };
          });
          var firstPub = pubRev.cards.find(function (it) { return it.card; });
          if (firstPub) { pubRev.card = firstPub.card; pubRev.text = firstPub.text; }
        }
        s.reveal = pubRev;
      } else {
        s.reveal = null;
        s.waiting = { kind: 'reveal', pid: state.reveal.pid, name: nameOf(state, state.reveal.pid), count: (state.reveal.cards || [1]).length };
      }
    } else s.reveal = null;

    var banners = state.banners || [];
    s.bannersCount = banners.length;
    if (!state.reveal && banners.length) {
      var b = banners[0];
      var isResp = b.pendingPids.indexOf(seat) >= 0;
      var canSee = isResp || !b.private || (b.allPids && b.allPids.indexOf(seat) >= 0);
      s.canAckBanner = isResp;
      if (canSee) {
        s.banner = clone(b);
      } else {
        s.banner = null;
        s.waiting = {
          kind: 'banner',
          pid: b.pendingPids[0],
          name: b.pendingPids.map(function (i) { return nameOf(state, i); }).join(', '),
          title: 'is reviewing a received card.'
        };
      }
    } else {
      s.banner = null;
      s.canAckBanner = false;
    }

    if (state.prompt) {
      if (state.prompt.forPid === seat) s.prompt = state.prompt;
      else { s.prompt = null; s.waiting = { kind: 'prompt', pid: state.prompt.forPid, name: nameOf(state, state.prompt.forPid), title: state.prompt.title }; }
    } else s.prompt = null;

    s.winStory = state.gameover ? buildWinStory(state) : null;

    delete s.deck; delete s.discard; delete s.history; delete s.queue; delete s.curses; delete s.flags; delete s.watchers;
    delete s.nextUid; delete s.lastCard0; delete s.banners; delete s.milestones; delete s.nextLogN; delete s.lastTurnLogN;
    return s;
  }

  return {
    CARDS: CARDS, CARD_IDS: CARD_IDS, SNAKES: SNAKES, LADDERS: LADDERS, LADDER_TOPS: LADDER_TOPS,
    BOARD_GRID: BOARD_GRID, ALPHA_MAP: ALPHA_MAP, WIN_PHRASES: WIN_PHRASES,
    newGame: newGame, apply: apply, view: view, statusLines: statusLines,
    buildWinStory: buildWinStory,
    tileCoords: tileCoords, tileAt: tileAt, verticalTile: verticalTile
  };
});
