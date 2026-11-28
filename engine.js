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
    state.log.push({ n: state.log.length + 1, text: text, cardId: cardId || null });
    if (state.log.length > 240) state.log.splice(0, state.log.length - 240);
  }
  function nameOf(state, pid) { return P(state, pid).name || 'Player ' + (pid + 1); }

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
      queue: [], reveal: null, prompt: null, lastCard: null,
      canEndTurn: false, rolledThisTurn: false, turnStartTile: 1,
      lastDieRaw: null, lastDie: null, jazzCue: false,
      log: [], nextUid: 1, history: [], lastElimination: null
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
    log(state, 'A new game begins. 108 cards shuffled. Everyone starts on tile 1.');
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
      log(state, label(card.id) + ' was cursed — the hidden ' + label(curse.id) + ' triggers on ' + nameOf(state, toPid) + '.', curse.id);
      state.queue.push({ t: 'apply', card: curse, pid: toPid, fromPid: fromPid });
    }
  }
  function handGood(state, pid) { return P(state, pid).hand.filter(function (c) { return typeOf(c.id) === 'Good'; }); }

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
    if (opts.landing !== false) checkLanding(state, pid);
  }
  function moveBy(state, pid, delta, fromPid) {
    var p = P(state, pid), amt = Math.abs(delta);
    if (delta < 0 && fromPid != null && fromPid !== pid &&
        (hasCard(state, pid, 'gc24') || hasCard(state, pid, 'gc6'))) {
      log(state, nameOf(state, pid) + ' reflects the drag back onto ' + nameOf(state, fromPid) + '.');
      moveBy(state, fromPid, -amt, null);
      return;
    }
    setTile(state, pid, p.tile + delta, { landing: true });
  }
  function forward(state, pid, n) { moveBy(state, pid, Math.abs(n), null); }
  function back(state, pid, n, fromPid) { moveBy(state, pid, -Math.abs(n), fromPid == null ? null : fromPid); }
  function toNemo(state, pid) {
    setRawTile(state, pid, -1);
    log(state, nameOf(state, pid) + ' is sent to Point Nemo (tile −1). No cards can be drawn there.');
  }

  function instantBlocked(state) {
    return state.players.some(function (p) { return p.alive && hasCard(state, p.i, 'vc25'); });
  }
  function win(state, pid, reason, instant) {
    if (state.gameover) return;
    if (instant && instantBlocked(state)) {
      log(state, 'An instant result card tried to fire, but VC25 blocks it.');
      return;
    }
    if (/^gc10/i.test(String(reason || ''))) {
      var guard = state.players.find(function (q) { return q.i !== pid && q.alive && hasCard(state, q.i, 'gc11'); });
      if (guard) {
        log(state, nameOf(state, guard.i) + ' holds GC11 — ' + nameOf(state, pid) + ' goes to the start instead of winning.');
        setTile(state, pid, 1, { landing: false });
        return;
      }
    }
    state.gameover = true; state.winner = pid; state.endReason = reason; state.phase = 'gameover';
    log(state, nameOf(state, pid) + ' WINS — ' + reason + '.');
    state.queue.length = 0; state.prompt = null; state.reveal = null;
  }
  function lose(state, pid, reason, instant) {
    var p = P(state, pid);
    if (!p.alive || state.gameover) return;
    if (hasCard(state, pid, 'gc13')) {
      var save = p.hand.find(function (c) { return c.id === 'gc13'; });
      if (save) { pluckCard(state, pid, save.uid); discardCard(state, save); }
      log(state, nameOf(state, pid) + ' would lose, but GC13 says: you will not, in fact, lose.');
      return;
    }
    if (instant && instantBlocked(state)) {
      log(state, 'The instant loss was blocked by VC25.');
      return;
    }
    var handCount = p.hand.length;
    p.alive = false;
    returnHandToDeck(state, pid);
    state.lastElimination = { pid: pid, name: nameOf(state, pid), reason: reason, tile: p.tile, handCount: handCount };
    log(state, nameOf(state, pid) + ' is out — ' + reason + '.');
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
    log(state, nameOf(state, pid) + ' completes ' + want + ' of the 3 → 7 → 13 sequence (' + p.seq + '/3).');
    if (p.seq === 3) { win(state, pid, 'landed on 3 → 7 → 13 in order', false); return true; }
    return false;
  }

  function checkLanding(state, pid) {
    var p = P(state, pid), t = p.tile;
    state.lastLanded = { pid: pid, tile: t };
    var checkedThirteen = false;

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
          log(state, nameOf(state, pid) + ' is immune to the snake at ' + head + '.');
        } else if (hasCard(state, pid, 'gc21')) {
          setRawTile(state, pid, head + 1);
          log(state, 'GC21 second chance: ' + head + ' → ' + P(state, pid).tile + ' (the tile ahead of the snake).');
          if (P(state, pid).tile >= 100) win(state, pid, 'GC21 put them on tile 100', false);
        } else if (state.flags.snakeMirror === pid) {
          delete state.flags.snakeMirror;
          setRawTile(state, pid, head + (head - tail));
          log(state, 'GC15: the snake at ' + head + ' acts as a ladder — ' + head + ' → ' + P(state, pid).tile + '.');
          if (P(state, pid).tile >= 100) win(state, pid, 'GC15 mirrored a snake onto tile 100', false);
        } else {
          setRawTile(state, pid, tail);
          log(state, nameOf(state, pid) + ' hit the snake at ' + head + ' → ' + tail + '.');
        }
      } else if (LADDERS[head] != null) {
        setRawTile(state, pid, LADDERS[head]);
        log(state, nameOf(state, pid) + ' climbed the ladder at ' + head + ' → ' + LADDERS[head] + '.');
      }
    }
    if (state.gameover) return;

    t = p.tile;
    state.lastLanded = { pid: pid, tile: t };
    if (t <= -9) { lose(state, pid, 'landed on tile −9', false); return; }
    if (t >= 100) { win(state, pid, 'reached tile 100', false); return; }
    if (!checkedThirteen && sequenceStep(state, pid, t)) return;

    if (t > 0 && t % 2 === 0) enqueueDraw(state, pid, 1);
    if (state.curses[t]) {
      var c = state.curses[t]; delete state.curses[t];
      log(state, 'Tile ' + t + ' was cursed with ' + label(c.id) + '. It fires on ' + nameOf(state, pid) + '.', c.id);
      state.queue.push({ t: 'apply', card: c, pid: pid, fromPid: 'curse' });
    }
  }

  /* ---------- queue / draws ---------- */
  function enqueueDraw(state, pid, count) {
    for (var i = 0; i < count; i++) state.queue.push({ t: 'draw', pid: pid });
  }
  function advance(state) {
    var guard = 0;
    while (state.queue.length && !state.gameover && !state.prompt && !state.reveal && guard++ < 600) {
      var task = state.queue.shift();
      try { runTask(state, task); }
      catch (e) { log(state, 'Rules engine caught an error while resolving ' + (task.card ? label(task.card.id) : task.t) + ': ' + e.message); }
    }
  }
  function settle(state) {
    advance(state);
    if (state.gameover) { state.phase = 'gameover'; state.canEndTurn = false; return; }
    if (!state.prompt && !state.reveal && !state.queue.length && state.rolledThisTurn) state.canEndTurn = true;
  }
  function runTask(state, task) {
    if (task.t === 'draw') return doDraw(state, task);
    if (task.t === 'card') return doCard(state, task);
    if (task.t === 'apply') return applyEffect(state, task.card, task.pid, task.fromPid);
    if (task.t === 'instant_win') return win(state, task.pid, task.reason, true);
  }
  function doDraw(state, task) {
    var pid = task.pid, p = P(state, pid);
    if (!p.alive) return;
    if (hasCard(state, pid, 'bc2')) {
      log(state, nameOf(state, pid) + ' cannot draw cards while holding BC2.');
      return;
    }
    var cards = takeFromDeck(state, 1);
    if (!cards.length) { log(state, 'The deck is empty.'); return; }
    var card = cards[0];
    p.drewThisTurn = true;
    p.drawnTypes.push(typeOf(card.id));
    if (p.drawnTypes.length > 12) p.drawnTypes.shift();
    state.queue.unshift({ t: 'card', card: card, pid: pid, source: 'draw' });
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
    var card = task.card, pid = task.pid, p = P(state, pid), id = card.id;
    if (task.source !== 'draw') {
      state.queue.unshift({ t: 'apply', card: card, pid: pid, fromPid: task.fromPid });
      return;
    }
    var pl = decide(state, card);
    var consumed = interceptors(state, card, pid, pl);
    if (consumed === 'discard') { discardCard(state, card); return; }
    if (consumed === 'transfer') return;
    if (pl.hand) {
      card.sticky = pl.sticky; card.playable = pl.playable; card.passive = pl.passive;
      addHand(state, pid, card);
    } else {
      discardCard(state, card);
    }
    // Kept cards stay secret: only the drawing player sees the card face.
    log(state, nameOf(state, pid) + ' drew a ' + typeOf(id).toLowerCase() + ' card' +
      (pl.hand ? ' (kept in hand)' : ' — ' + label(id) + ' (played immediately)') + '.', pl.hand ? null : id);
    state.reveal = {
      card: cardView(card), pid: pid, public: !pl.hand,
      text: CARDS[id].text, jazz: id === 'gc25', kept: pl.hand
    };
    if (pl.resolveNow) state.queue.unshift({ t: 'apply', card: card, pid: pid, fromPid: null });
  }

  function interceptors(state, card, pid, pl) {
    var id = card.id, ty = typeOf(id), p = P(state, pid);

    if (state.flags.negateNextCard != null) {
      var by = state.flags.negateNextCard; delete state.flags.negateNextCard;
      log(state, label(id) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').', id);
      return 'discard';
    }
    if (ty === 'Bad' && p.status.badImmuneRolls > 0 && state.rolledThisTurn) {
      p.status.badImmuneRolls--;
      log(state, nameOf(state, pid) + ' is immune to bad cards on this roll (GC2). ' + label(id) + ' fizzles.', id);
      return 'discard';
    }
    if (state.flags.nextDrawGiveTo != null && state.flags.nextDrawGiveTo !== pid) {
      var owner = state.flags.nextDrawGiveTo; delete state.flags.nextDrawGiveTo;
      addHand(state, owner, card);
      log(state, 'VC12: ' + nameOf(state, pid) + ' must hand their card to ' + nameOf(state, owner) + '.', id);
      return 'transfer';
    }
    if (p.status.nextCardGiveToNext) {
      p.status.nextCardGiveToNext = false;
      var tgt = nextAliveSeat(state, pid);
      transferCard(state, pid, tgt, card);
      log(state, 'VC14: the card goes to ' + nameOf(state, tgt) + '; ' + nameOf(state, pid) + ' draws another.', id);
      enqueueDraw(state, pid, 1);
      return 'transfer';
    }
    if (p.status.nextCardType) {
      var req = p.status.nextCardType; p.status.nextCardType = null;
      if (ty !== req.type) {
        log(state, 'The next card was ' + ty + ', not ' + req.type + '. ' + nameOf(state, pid) + ' pays the price.');
        if (req.fail === 'lose') lose(state, pid, 'failed a card-type prediction', false);
        else if (req.fail === 'nemo') toNemo(state, pid);
        else setTile(state, pid, 1, { landing: false });
      } else log(state, 'The card-type prediction was right (' + req.type + ').');
    }
    if (hasCard(state, pid, 'bc7') || (id === 'bc7' && pl.hand)) {
      var d = p.drawnTypes;
      if (d.length >= 2 && d[d.length - 1] === d[d.length - 2]) {
        lose(state, pid, 'drew the same card type twice in a row while holding BC7', false);
      }
    }
    if (ty === 'Bad' && state.flags.nextBadToLadderTop === pid) {
      delete state.flags.nextBadToLadderTop;
      log(state, 'GC19: the bad card is placed at the top of a ladder instead of taking effect.', id);
      setPrompt(state, { title: 'GC19 — place your bad card', text: 'Choose the top of any ladder. You move there instead of resolving ' + label(id) + '.',
        cardId: 'gc19', kind: 'options', multi: 0, data: { op: 'gc19_ladder', pid: pid },
        options: LADDER_TOPS.map(function (t) { return { label: 'Tile ' + t, value: t }; }) });
      return 'discard';
    }
    if (ty === 'Bad' && p.status.curseTile != null) {
      var t = p.status.curseTile; p.status.curseTile = null;
      state.curses[t] = card;
      log(state, 'GC12: tile ' + t + ' is now cursed with ' + label(id) + '.', id);
      return 'discard';
    }
    if (id === 'gc10') {
      var guard = state.players.find(function (q) { return q.i !== pid && q.alive && hasCard(state, q.i, 'gc11'); });
      if (guard) {
        log(state, 'GC11 (held by ' + nameOf(state, guard.i) + '): ' + nameOf(state, pid) + ' is sent to the start instead of winning.', id);
        setTile(state, pid, 1, { landing: false });
        return 'discard';
      }
    }
    if (INSTANT_RESULT.indexOf(id) >= 0 && instantBlocked(state)) {
      log(state, 'VC25 blocks the instant result on ' + label(id) + '.', id);
      return 'discard';
    }
    if ((id === 'vc34' || id === 'vc35') && pl.hand) {
      var other = id === 'vc34' ? 'vc35' : 'vc34';
      if (hasCard(state, pid, other)) {
        log(state, 'Both variants are in hand — ' + label(id) + ' + ' + label(other) + '.', id);
        state.queue.push({ t: 'instant_win', pid: pid, reason: 'both VC34 and VC35 variants' });
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
    switch (op) {
      case 'outcome':
        if (value === 'fail') {
          if (pr.data.fail === 'lose') lose(state, pid, 'failed a table call', false);
          else if (pr.data.fail === 'nemo') toNemo(state, pid);
          else if (pr.data.fail === 'start') setTile(state, pid, 1, { landing: false });
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
            state.players.forEach(function (q) {
              if (q.i === pid || !q.alive) return;
              q.hand.filter(function (c) { return typeOf(c.id) === 'Bad'; }).forEach(function (c) {
                pluckCard(state, q.i, c.uid); transferCard(state, q.i, pid, c);
              });
            });
            log(state, nameOf(state, pid) + ' takes everyone’s Bad cards.');
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
        break;
      case 'bc9_target': case 'bc10_target': {
        var need = op === 'bc9_target' ? 2 : 1;
        var give = handGood(state, pid);
        if (give.length < need) { log(state, 'Not enough Good cards — ' + label(op === 'bc9_target' ? 'bc9' : 'bc10') + ' is discarded.'); break; }
        give.slice(0, need).forEach(function (c) { selected(c.uid); transferCard(state, pid, value, c); });
        log(state, nameOf(state, pid) + ' gives ' + need + ' Good card(s) to ' + nameOf(state, value) + '.');
        break;
      }
      case 'bc11_target':
        log(state, nameOf(state, pid) + ' chooses ' + nameOf(state, value) + ' to lose with them.');
        lose(state, value, 'chosen by BC11', false);
        lose(state, pid, 'BC11', false);
        break;
      case 'gc3_target': setTile(state, value, 1, { landing: true }); log(state, nameOf(state, value) + ' is sent to the start.'); break;
      case 'gc5_target': {
        var a = p.tile, b = P(state, value).tile;
        setRawTile(state, pid, b); setRawTile(state, value, a);
        log(state, nameOf(state, pid) + ' swaps tiles with ' + nameOf(state, value) + '.');
        break;
      }
      case 'gc7_tile': setTile(state, pid, Number(value), { landing: true }); break;
      case 'gc14_vertical': {
        var t2 = verticalTile(p.tile, value);
        if (t2 == null) log(state, 'There is no tile vertically ' + value + ' from here.');
        else { log(state, nameOf(state, pid) + ' moves vertically ' + value + ' to tile ' + t2 + '.'); setTile(state, pid, t2, { landing: true }); }
        break;
      }
      case 'gc16_target': P(state, value).status.skipTurns += 1; log(state, nameOf(state, value) + ' is immobile for a turn.'); break;
      case 'gc19_ladder': setTile(state, pid, Number(value), { landing: true }); log(state, nameOf(state, pid) + ' goes to ladder top ' + value + '.'); break;
      case 'gc23_target': back(state, value, 2, pid); break;
      case 'gc30_target': P(state, value).status.extraRolls += 1; log(state, nameOf(state, value) + ' is forced to roll an extra time on their next turn.'); break;
      case 'gc34_target': back(state, value, 10, pid); break;
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
        log(state, nameOf(state, pid) + ' swaps hands with ' + nameOf(state, value) + '.');
        break;
      }
      case 'vc31_target': enqueueDraw(state, value, 1); log(state, nameOf(state, value) + ' must draw a card.'); break;
      case 'vc33_target': {
        var opts33 = cardOptions(state, value);
        if (!opts33.length) { log(state, nameOf(state, value) + ' has no cards to discard.'); break; }
        setPrompt(state, { title: 'VC33 — discard one of their cards', text: 'Choose a card from ' + nameOf(state, value) + '’s hand to discard.',
          cardId: 'vc33', kind: 'cards', multi: 0, data: { op: 'vc33_card', pid: pid, target: value }, options: opts33 });
        break;
      }
      case 'vc33_card': {
        var c33 = pluckCard(state, pr.data.target, value);
        if (c33) { discardCard(state, c33); log(state, label(c33.id) + ' is discarded from ' + nameOf(state, pr.data.target) + '’s hand.', c33.id); }
        break;
      }
      case 'vc36_target': discardHand(state, value); log(state, nameOf(state, value) + ' discards their whole hand.'); break;
      default: log(state, 'Unhandled choice: ' + op);
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
    var id = card.id, p = P(state, pid), n = N(state);
    var nxt = nextAliveSeat(state, pid);
    var aliveCount = state.players.filter(function (q) { return q.alive; }).length;
    log(state, label(id) + ': ' + (CARDS[id] ? CARDS[id].text : 'engine effect'), id);

    // GC20: a bad card used against you still takes effect, but you also move five ahead.
    if (typeOf(id) === 'Bad' && fromPid != null && fromPid !== pid && typeof fromPid === 'number' && hasCard(state, pid, 'gc20')) {
      state.queue.push({ t: 'apply', card: cardObj(state, '__gc20'), pid: pid, fromPid: null });
    }

    switch (id) {
      /* ---------------- BAD ---------------- */
      case 'bc1': promptOutcome(state, pid, id, 'Guess the forecast of Manila for the next hour. The table decides whether you got it right.', 'nemo'); break;
      case 'bc2': log(state, 'BC2 stays in your hand: you cannot draw cards while it is there.'); break;
      case 'bc3': log(state, 'Table call: buy food for ' + nameOf(state, nxt) + '.'); break;
      case 'bc4': p.status.needSix = true; log(state, 'Your next roll must be a 6, or Point Nemo.'); break;
      case 'bc5': promptOutcome(state, pid, id, 'Solve today’s Wordle and tell the table the answer.', 'lose'); break;
      case 'bc6': promptOutcome(state, pid, id, 'Solve today’s Wordle and tell the table the answer.', 'nemo'); break;
      case 'bc7': log(state, 'BC7 stays in your hand: two of the same card type in a row and you lose.'); break;
      case 'bc8': {
        var two = takeFromDeck(state, 2);
        if (two.length < 2) { two.forEach(function (c) { state.deck.push(c); }); log(state, 'Not enough cards in the deck.'); break; }
        p.drawnTypes.push(typeOf(two[0].id), typeOf(two[1].id));
        setPrompt(state, { title: 'BC8 — take the objectively worse one', text: 'The table decides which of these two is worse. The other goes back into the deck, which is reshuffled.',
          cardId: 'bc8', kind: 'cards', multi: 0, data: { op: 'bc8_worse', pid: pid, cards: two },
          options: two.map(function (c) { return { label: label(c.id) + ' · ' + CARDS[c.id].text.slice(0, 40), value: c.uid, img: CARDS[c.id].img }; }) });
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
      case 'bc12': discardEveryoneGood(state); log(state, 'Everyone loses their Good cards.'); break;
      case 'bc13': setTile(state, pid, 1, { landing: true }); break;
      case 'bc14': log(state, 'BC14 stays in your hand: every roll is reduced by 1.'); break;
      case 'bc15': setTile(state, pid, p.prevTile - p.lastRoll, { landing: true }); break;
      case 'bc16': setTile(state, pid, p.prevTile, { landing: true }); break;
      case 'bc17': p.status.skipUntilRound = state.round + 3; log(state, 'No rolling for three rounds.'); break;
      case 'bc18': p.status.skipUntilRound = state.round + 2; log(state, 'No rolling for two rounds.'); break;
      case 'bc19': p.status.skipUntilRound = state.round + 1; log(state, 'No rolling for a round.'); break;
      case 'bc20': setTile(state, pid, Math.ceil(p.tile / 2), { landing: true }); break;
      case 'bc21': toNemo(state, pid); break;
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
      case 'bc25': everyoneTo(state, 1); break;
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
      case 'bc35': state.watchers.push({ owner: pid, target: nxt, requireDraw: false }); log(state, 'If ' + nameOf(state, nxt) + ' does not draw a card on their turn, you go to Point Nemo.'); break;
      case 'bc36': state.watchers.push({ owner: pid, target: nxt, requireDraw: true }); log(state, 'If ' + nameOf(state, nxt) + ' draws a card on their turn, you go to Point Nemo.'); break;

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
      case 'gc10': {
        if (instantBlocked(state)) { log(state, 'VC25 blocks the instant result on GC10.', id); break; }
        var gc11 = state.players.find(function (q) { return q.i !== pid && q.alive && hasCard(state, q.i, 'gc11'); });
        if (gc11) {
          log(state, 'GC11 (held by ' + nameOf(state, gc11.i) + '): ' + nameOf(state, pid) + ' is sent to the start instead of winning.', id);
          setTile(state, pid, 1, { landing: false });
          break;
        }
        win(state, pid, 'GC10 — You win.', true);
        break;
      }
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
      case 'gc18': forwardEveryone(state, 1); break;
      case 'gc19': state.flags.nextBadToLadderTop = pid; log(state, 'Your next Bad card goes to the top of a ladder instead of resolving.'); break;
      case 'gc22': clearRules(state); break;
      case 'gc23': promptPlayers(state, { title: 'GC23 — drag someone back two', text: 'Choose a player ahead of you.', cardId: id,
        data: { op: 'gc23_target' }, filter: function (q) { return q.tile > p.tile; }, emptyText: 'No one is ahead — nothing happens.' }); break;
      case 'gc25': state.jazzCue = true; log(state, 'Play jazz. Immediately.'); break;
      case 'gc26': log(state, 'Table call: ' + nameOf(state, nxt) + ' has to buy you food.'); break;
      case 'gc27':
        state.flags.snakeImmunityBanned = true;
        state.players.forEach(function (q) { q.hand.filter(function (c) { return c.id === 'gc8'; }).forEach(function (c) { pluckCard(state, q.i, c.uid); discardCard(state, c); }); });
        log(state, 'No one can ever be immune to snakes again. Ever.');
        break;
      case 'gc28': P(state, nxt).status.skipTurns += 1; log(state, nameOf(state, nxt) + ' misses their next turn.'); break;
      case 'gc29': {
        var h29 = P(state, nxt).hand;
        if (!h29.length) { log(state, nameOf(state, nxt) + ' has no cards to steal.'); break; }
        var stolen = pluckCard(state, nxt, h29[ri(h29.length)].uid);
        transferCard(state, nxt, pid, stolen);
        log(state, nameOf(state, pid) + ' steals a random card from ' + nameOf(state, nxt) + '.', stolen.id);
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
      case 'vc2': rotateTiles(state, -state.direction); log(state, 'All players swap tiles opposite turn order.'); break;
      case 'vc3': rotateTiles(state, state.direction); log(state, 'All players swap tiles in turn order.'); break;
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
        log(state, 'Swapped places with ' + nameOf(state, closest.i) + ' (closest).');
        break;
      }
      case 'vc10': p.status.alphabeticalUntilRound = state.round + 4; log(state, 'Alphabetical rolling for the next four rounds: 1→5, 2→4, 3→1, 4→6, 5→3, 6→2.'); break;
      case 'vc11': everyoneTo(state, 50); break;
      case 'vc12': state.flags.nextDrawGiveTo = pid; log(state, 'The next person to draw has to give their card to you.'); break;
      case 'vc13': state.flags.noMoveUntilTurnOf = pid; log(state, 'No one moves until it is your turn again.'); break;
      case 'vc14': p.status.nextCardGiveToNext = true; log(state, 'Your next card goes to the next player, and you draw another.'); break;
      case 'vc15': state.players.forEach(function (q) { discardHand(state, q.i); }); log(state, 'Everyone’s cards are discarded.'); break;
      case 'vc16': {
        var cnt = p.hand.length;
        if (cnt <= 1) { log(state, 'This is your only card (or none) — VC16 is discarded.'); break; }
        discardHand(state, pid);
        enqueueDraw(state, pid, cnt);
        log(state, 'Discard ' + cnt + ' cards, draw ' + cnt + '.');
        break;
      }
      case 'vc17': log(state, 'Nothing happens.'); break;
      case 'vc18': state.direction *= -1; log(state, 'Play order direction is now ' + (state.direction === 1 ? 'clockwise' : 'counter-clockwise') + '.'); break;
      case 'vc19': rotateHands(state, state.direction); log(state, 'Everyone swaps hands in the play order’s direction.'); break;
      case 'vc20':
        if (instantBlocked(state)) log(state, 'VC25 blocks the instant result.');
        else { state.gameover = true; state.winner = null; state.endReason = 'VC20 — the game ends. No one wins.'; state.phase = 'gameover'; state.queue.length = 0; }
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
  }

  /* ---------- turns ---------- */
  function beginTurn(state) {
    var p = cur(state);
    state.rolledThisTurn = false; p.drewThisTurn = false; state.canEndTurn = false;
    state.turnStartTile = p.tile;
    state.lastElimination = null;
    log(state, '— Round ' + state.round + ' · ' + nameOf(state, p.i) + '’s turn (tile ' + p.tile + ') —');
  }
  function doRoll(state, action) {
    var p = cur(state);
    if (state.rolledThisTurn || state.prompt || state.reveal) return;
    var raw = action && action.value != null && action.value !== '' ? clamp(Number(action.value) || 1, 1, 6) : d6();
    var die = raw;
    if (p.status.alphabeticalUntilRound >= state.round) die = ALPHA_MAP[raw] || raw;
    if (state.flags.cubedUntilRound >= state.round) die = Math.pow(die, 2);
    if (hasCard(state, p.i, 'bc14')) die = Math.max(0, die - 1);
    state.lastDieRaw = raw; state.lastDie = die;
    p.lastRoll = die;
    log(state, nameOf(state, p.i) + ' rolled ' + raw + (die !== raw ? ' → ' + die : '') + '.');
    state.rolledThisTurn = true;
    state.canEndTurn = false;

    if (p.status.needSix) {
      p.status.needSix = false;
      if (raw !== 6) { log(state, 'BC4: the roll was not a 6.'); toNemo(state, p.i); return; }
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
      if (t === 0) { setTile(state, p.i, 1, { landing: true }); log(state, 'Exact roll onto zero — escaped onto tile 1.'); }
      else if (t > 0) { setRawTile(state, p.i, 0); log(state, 'Overshot zero — you land on 0 and need a 1 to escape.'); }
      else setRawTile(state, p.i, t);
      return;
    }
    var target = p.tile + die;
    if (target > 100) {
      if (hasCard(state, p.i, 'gc33')) { log(state, 'GC33: no exact roll needed.'); setTile(state, p.i, 100, { landing: true }); }
      else log(state, 'Exact roll needed for tile 100 — ' + nameOf(state, p.i) + ' stays on ' + p.tile + '.');
    } else setTile(state, p.i, target, { landing: true });
  }
  function endTurn(state) {
    if (state.gameover || state.prompt || state.reveal || state.queue.length) return;
    var leaving = state.turnIndex;
    state.watchers.filter(function (w) { return w.target === leaving; }).forEach(function (w) {
      var did = P(state, w.target).drewThisTurn;
      if (did !== w.requireDraw) {
        log(state, 'BC' + (w.requireDraw ? '36' : '35') + ': the watched player ' + (did ? 'drew' : 'did not draw') + ' a card.');
        toNemo(state, w.owner);
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
    var pid = state.turnIndex, p = P(state, pid);
    var card = findHandCard(state, pid, action.uid);
    if (!card || card.sticky || state.prompt || state.reveal) return;
    if (state.flags.snatchNextGood != null && state.flags.snatchNextGood !== pid && typeOf(card.id) === 'Good') {
      var thief = state.flags.snatchNextGood; delete state.flags.snatchNextGood;
      pluckCard(state, pid, card.uid); transferCard(state, pid, thief, card);
      log(state, 'VC22: ' + nameOf(state, thief) + ' snatches ' + label(card.id) + ' the moment it is played.', card.id);
      return;
    }
    if (state.flags.negateNextCard != null) {
      var by = state.flags.negateNextCard; delete state.flags.negateNextCard;
      pluckCard(state, pid, card.uid); discardCard(state, card);
      log(state, label(card.id) + ' was negated by VC32 (held by ' + nameOf(state, by) + ').', card.id);
      return;
    }
    pluckCard(state, pid, card.uid);
    discardCard(state, card);
    log(state, nameOf(state, pid) + ' plays ' + label(card.id) + '.', card.id);
    state.queue.push({ t: 'apply', card: card, pid: pid, fromPid: pid });
  }

  function apply(state, action) {
    if (!action || !action.type) return state;
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
    if (t === 'ACK_ELIM') {
      state.lastElimination = null;
      state.version++;
      return state;
    }
    if (state.phase !== 'turn' || state.gameover) return state;
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
      case 'DM_END_TURN': state.queue.length = 0; state.prompt = null; state.reveal = null; state.rolledThisTurn = true; endTurn(state); break;
      default: break;
    }
    state.version++;
    settle(state);
    return state;
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
      if (state.reveal.public || state.reveal.pid === seat) {
        s.reveal = state.reveal;
      } else {
        s.reveal = null;
        s.waiting = { kind: 'reveal', pid: state.reveal.pid, name: nameOf(state, state.reveal.pid) };
      }
    } else s.reveal = null;
    if (state.prompt) {
      if (state.prompt.forPid === seat) s.prompt = state.prompt;
      else { s.prompt = null; s.waiting = { kind: 'prompt', pid: state.prompt.forPid, name: nameOf(state, state.prompt.forPid), title: state.prompt.title }; }
    } else s.prompt = null;
    delete s.deck; delete s.discard; delete s.history; delete s.queue; delete s.curses; delete s.flags; delete s.watchers;
    delete s.nextUid; delete s.lastCard0;
    return s;
  }

  return {
    CARDS: CARDS, CARD_IDS: CARD_IDS, SNAKES: SNAKES, LADDERS: LADDERS, LADDER_TOPS: LADDER_TOPS,
    BOARD_GRID: BOARD_GRID, ALPHA_MAP: ALPHA_MAP,
    newGame: newGame, apply: apply, view: view, statusLines: statusLines,
    tileCoords: tileCoords, tileAt: tileAt, verticalTile: verticalTile
  };
});
