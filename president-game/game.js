// ── Game state ────────────────────────────────────────────────────────────────

const ROLES = ['President','Vice President','Neutral','Vice Asshole','Asshole'];
const DEFAULT_AI_NAMES = ['Alice', 'Bob', 'Carlos', 'Diana', 'Eddie', 'Fiona'];
const CONQUEST_TARGET = 100;

const state = {
  players: [],       // { name, hand, role, finished, isHuman }
  pile: [],          // cards currently on table
  trickLeader: 0,    // index of player who led this trick
  currentTurn: 0,    // index of player whose turn it is
  passCount: 0,      // consecutive passes since last play (continue-around only)
  trickTurns: 0,     // total actions (plays+passes) taken this trick
  trickPlayerCount: 0, // active players when this trick started
  lastPlayedBy: 0,    // index of the player who most recently played a card
  roundNum: 0,
  finishOrder: [],   // player indices in finish order this round
  settings: {
    numPlayers: 4,
    oneTimeAround: true,
    cardTrading: true,
    autoPass: true,
    gameName: (() => {
      try { const s = localStorage.getItem('presidentGameName'); if (s) return s; } catch {}
      return 'President';
    })(),
    roleNames: (() => {
      try {
        const s = JSON.parse(localStorage.getItem('presidentRoleNames'));
        if (s && typeof s === 'object') return s;
      } catch {}
      return { 'President': 'President', 'Vice President': 'Vice President', 'Neutral': 'Neutral', 'Vice Asshole': 'Vice Asshole', 'Asshole': 'Asshole' };
    })(),
    aiNames: (() => {
      try {
        const s = JSON.parse(localStorage.getItem('presidentAiNames'));
        if (Array.isArray(s) && s.length === 6) return s;
      } catch {}
      return [...DEFAULT_AI_NAMES];
    })(),
    cardBack: (() => {
      try { const s = localStorage.getItem('presidentCardBack'); if (s) return s; } catch {}
      return 'blue';
    })(),
    conquest: (() => {
      try { return localStorage.getItem('presidentConquest') === 'true'; } catch {}
      return false;
    })(),
  },
  phase: 'start',    // 'start' | 'trading' | 'playing' | 'roundEnd'
  lastPlay: null,          // { playerName, cards } of most recent play (persists after pile clears)
  trickLog: [],            // completed tricks this round: [{ plays:[{playerName,cards}], winnerName }]
  currentTrickPlays: [],   // plays accumulated in the current trick
};

// ── Setup ──────────────────────────────────────────────────────────────────────

function initGame(settings, savedConquest) {
  Object.assign(state.settings, settings);
  const n = state.settings.numPlayers;

  state.players = [];
  state.roundNum = 0;

  const AI_STYLES = ['conservative', 'neutral', 'aggressive'];

  if (savedConquest && savedConquest.numPlayers === n) {
    state.players.push({ name: 'You', hand: [], role: null, finished: false, isHuman: true, scoreTotal: savedConquest.scores[0] || 0 });
    for (let i = 1; i < n; i++) {
      state.players.push({
        name: savedConquest.playerNames[i] || DEFAULT_AI_NAMES[i - 1],
        hand: [], role: null, finished: false, isHuman: false,
        style: AI_STYLES[Math.floor(Math.random() * AI_STYLES.length)],
        scoreTotal: savedConquest.scores[i] || 0,
      });
    }
  } else {
    clearConquestState();
    const shuffledNames = shuffle([...state.settings.aiNames]).slice(0, n - 1);
    state.players.push({ name: 'You', hand: [], role: null, finished: false, isHuman: true, scoreTotal: 0 });
    for (let i = 1; i < n; i++) {
      state.players.push({
        name: shuffledNames[i - 1] || DEFAULT_AI_NAMES[i - 1],
        hand: [], role: null, finished: false, isHuman: false,
        style: AI_STYLES[Math.floor(Math.random() * AI_STYLES.length)],
        scoreTotal: 0,
      });
    }
  }

  dealRound();
}

function dealRound() {
  state.roundNum++;

  // Reorder seats before dealing so turn order reflects roles
  if (state.roundNum > 1) reorderSeats();

  const n = state.players.length;

  // Reset per-round state
  state.players.forEach(p => { p.hand = []; p.finished = false; });
  state.pile = [];
  state.finishOrder = [];
  state.passCount = 0;
  state.trickTurns = 0;
  state.trickPlayerCount = n;
  state.lastPlayedBy = 0;
  state.trickLog = [];
  state.currentTrickPlays = [];
  state.lastPlay = null;

  // Shuffle and deal evenly — remainder cards are discarded
  let deck = shuffle(buildDeck());
  const cardsEach = Math.floor(deck.length / n);
  deck.slice(0, cardsEach * n).forEach((card, i) => {
    state.players[i % n].hand.push(card);
  });
  state.players.forEach(p => { p.hand = sortHand(p.hand); });

  // Round 1: random first player; round 2+: President (index 0 after reorderSeats) leads
  const firstPlayer = state.roundNum === 1 ? Math.floor(Math.random() * n) : 0;
  state.currentTurn = firstPlayer;
  state.trickLeader = firstPlayer;

  startTrading();
}

function reorderSeats() {
  const roleOrder = { 'President': 0, 'Vice President': 1, 'Neutral': 2, 'Vice Asshole': 3, 'Asshole': 4 };

  // Pre-compute finish positions by original index so neutrals keep relative order
  const finishPos = {};
  state.finishOrder.forEach((origIdx, pos) => { finishPos[origIdx] = pos; });

  const withIdx = state.players.map((p, i) => ({ p, i }));
  withIdx.sort((a, b) => {
    const ra = roleOrder[a.p.role] ?? 2;
    const rb = roleOrder[b.p.role] ?? 2;
    if (ra !== rb) return ra - rb;
    return (finishPos[a.i] ?? 99) - (finishPos[b.i] ?? 99);
  });

  state.players = withIdx.map(x => x.p);
}

function humanIdx() {
  return state.players.findIndex(p => p.isHuman);
}

// ── Turn logic ────────────────────────────────────────────────────────────────

function humanPlay(selectedCards) {
  if (state.phase !== 'playing') return { ok: false, msg: 'Not in play phase' };
  if (state.players[state.currentTurn].isHuman === false) return { ok: false, msg: 'Not your turn' };
  if (!isLegalPlay(selectedCards, state.pile)) return { ok: false, msg: 'Illegal play' };

  applyPlay(state.currentTurn, selectedCards);
  return { ok: true };
}

function humanPass() {
  if (state.phase !== 'playing') return { ok: false };
  if (!state.players[state.currentTurn].isHuman) return { ok: false };
  applyPass(state.currentTurn);
  return { ok: true };
}

function applyPlay(playerIdx, cards) {
  const player = state.players[playerIdx];

  cards.forEach(c => {
    const i = player.hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) player.hand.splice(i, 1);
  });

  state.pile = cards;
  state.trickLeader = playerIdx;
  state.lastPlayedBy = playerIdx;
  state.passCount = 0;
  state.trickTurns++;
  const playRecord = { playerName: player.name, cards: [...cards] };
  state.lastPlay = playRecord;
  state.currentTrickPlays.push(playRecord);

  if (player.hand.length === 0) {
    player.finished = true;
    state.finishOrder.push(playerIdx);
  }

  // Any 2s end the trick immediately — 2s are unbeatable trump
  if (isTrump(cards[0])) {
    endTrick(playerIdx);
    return;
  }

  if (checkRoundEnd()) return;

  // One-time-around: all players have had their one action this trick
  if (state.settings.oneTimeAround && state.trickTurns >= state.trickPlayerCount) {
    endTrick(state.trickLeader);
    return;
  }

  advanceTurn(playerIdx);
}

function applyPass(playerIdx) {
  state.passCount++;
  state.trickTurns++;

  if (state.settings.oneTimeAround) {
    // Each player gets exactly one action per trick; end when all have acted
    if (state.trickTurns >= state.trickPlayerCount) {
      endTrick(state.trickLeader);
      return;
    }
  } else {
    // Continue-around: trick ends when all active players except the last one who played
    // have passed consecutively. If the last player to play has since finished, all
    // remaining active players must pass.
    const activePlayers = state.players.filter(p => !p.finished);
    const lastPlayerActive = !state.players[state.lastPlayedBy].finished;
    const neededPasses = activePlayers.length - (lastPlayerActive ? 1 : 0);
    if (state.passCount >= neededPasses) {
      endTrick(state.trickLeader);
      return;
    }
  }

  advanceTurn(playerIdx);
}

function endTrick(winnerIdx) {
  if (state.currentTrickPlays.length > 0) {
    state.trickLog.push({
      plays: [...state.currentTrickPlays],
      winnerName: state.players[winnerIdx]?.name || '?',
    });
    state.currentTrickPlays = [];
  }
  state.pile = [];
  state.passCount = 0;
  state.trickTurns = 0;

  if (checkRoundEnd()) return;

  // Reset turn count for the new trick, using current active player count
  state.trickPlayerCount = state.players.filter(p => !p.finished).length;

  if (state.players[winnerIdx].finished) {
    // Round 1 (placement): no roles yet, so next player clockwise leads
    // Round 2+: highest-ranked remaining player (lowest index after reorderSeats) leads
    const next = state.roundNum === 1
      ? nextActivePlayer(winnerIdx)
      : state.players.findIndex(p => !p.finished);
    state.trickLeader = next;
    state.currentTurn = next;
  } else {
    state.trickLeader = winnerIdx;
    state.currentTurn = winnerIdx;
  }
}

function advanceTurn(fromIdx) {
  const n = state.players.length;
  let next = (fromIdx + 1) % n;
  // Skip players who have finished
  let loops = 0;
  while (state.players[next].finished && loops < n) {
    next = (next + 1) % n;
    loops++;
  }
  state.currentTurn = next;
}

function nextActivePlayer(fromIdx) {
  const n = state.players.length;
  let next = (fromIdx + 1) % n;
  let loops = 0;
  while (state.players[next].finished && loops < n) {
    next = (next + 1) % n;
    loops++;
  }
  return next;
}

function checkRoundEnd() {
  const active = state.players.filter(p => !p.finished);
  if (active.length <= 1) {
    // Last player remaining is Asshole
    const last = state.players.find(p => !p.finished);
    if (last) {
      last.finished = true;
      state.finishOrder.push(state.players.indexOf(last));
    }
    assignRoles();
    state.phase = 'roundEnd';
    return true;
  }
  return false;
}

function assignRoles() {
  const n = state.players.length;
  const order = state.finishOrder;

  state.players.forEach(p => p.role = null);

  if (n === 2) {
    if (order[0] !== undefined) state.players[order[0]].role = 'President';
    if (order[1] !== undefined) state.players[order[1]].role = 'Asshole';
    return;
  }

  if (order[0] !== undefined) state.players[order[0]].role = 'President';
  if (order[n - 1] !== undefined) state.players[order[n - 1]].role = 'Asshole';

  if (n >= 4) {
    if (order[1] !== undefined) state.players[order[1]].role = 'Vice President';
    if (order[n - 2] !== undefined) state.players[order[n - 2]].role = 'Vice Asshole';
  }

  // Everyone else neutral
  state.players.forEach(p => { if (!p.role) p.role = 'Neutral'; });
}

// ── Card trading ──────────────────────────────────────────────────────────────

function tradingCount() {
  return state.players.length <= 4 ? 2 : 1;
}

function startTrading() {
  if (state.roundNum <= 1 || !state.settings.cardTrading) {
    state.phase = 'playing';
    return;
  }

  const n    = state.players.length;
  const tc   = tradingCount();
  const hIdx = humanIdx();
  const presIdx = state.players.findIndex(p => p.role === 'President');
  const assIdx  = state.players.findIndex(p => p.role === 'Asshole');
  const vpIdx   = n >= 4 ? state.players.findIndex(p => p.role === 'Vice President') : -1;
  const vaIdx   = n >= 4 ? state.players.findIndex(p => p.role === 'Vice Asshole')   : -1;

  state.trading = {
    presIdx, assIdx, vpIdx, vaIdx,
    tradeCount: tc,
    humanReceived: [],
    humanNeedsToGive: false,
    humanGiveCount: 0,
    humanGiveTo: -1,
    humanGiveToName: '',
  };
  const t = state.trading;

  // Asshole → President (automatic)
  let presReceived = [];
  if (presIdx >= 0 && assIdx >= 0) {
    presReceived = takeTopCards(assIdx, tc);
    presReceived.forEach(c => state.players[presIdx].hand.push(c));
    state.players[presIdx].hand = sortHand(state.players[presIdx].hand);
    if (presIdx === hIdx) t.humanReceived.push(...presReceived);
  }

  // VA → VP (automatic)
  let vpReceived = [];
  if (vpIdx >= 0 && vaIdx >= 0) {
    vpReceived = takeTopCards(vaIdx, 1);
    vpReceived.forEach(c => state.players[vpIdx].hand.push(c));
    state.players[vpIdx].hand = sortHand(state.players[vpIdx].hand);
    if (vpIdx === hIdx) t.humanReceived.push(...vpReceived);
  }

  // AI President gives worst ORIGINAL cards back to Asshole (never re-gifts received cards)
  if (presIdx >= 0 && assIdx >= 0 && presIdx !== hIdx) {
    const receivedKeys = new Set(presReceived.map(c => c.suit + c.value));
    const original = state.players[presIdx].hand.filter(c => !receivedKeys.has(c.suit + c.value));
    const pool = original.length >= tc ? original : state.players[presIdx].hand;
    const giveBack = [...pool].sort((a, b) => a.rank - b.rank).slice(0, tc);
    giveBack.forEach(c => {
      const i = state.players[presIdx].hand.findIndex(h => h.suit === c.suit && h.value === c.value);
      if (i !== -1) state.players[presIdx].hand.splice(i, 1);
      state.players[assIdx].hand.push(c);
    });
    state.players[assIdx].hand = sortHand(state.players[assIdx].hand);
    if (assIdx === hIdx) t.humanReceived.push(...giveBack);
  }

  // AI VP gives worst ORIGINAL card back to VA (never re-gifts received card)
  if (vpIdx >= 0 && vaIdx >= 0 && vpIdx !== hIdx) {
    const receivedKeys = new Set(vpReceived.map(c => c.suit + c.value));
    const original = state.players[vpIdx].hand.filter(c => !receivedKeys.has(c.suit + c.value));
    const pool = original.length >= 1 ? original : state.players[vpIdx].hand;
    const worst = [...pool].sort((a, b) => a.rank - b.rank)[0];
    if (worst) {
      const i = state.players[vpIdx].hand.findIndex(h => h.suit === worst.suit && h.value === worst.value);
      if (i !== -1) state.players[vpIdx].hand.splice(i, 1);
      state.players[vaIdx].hand.push(worst);
      state.players[vaIdx].hand = sortHand(state.players[vaIdx].hand);
      if (vaIdx === hIdx) t.humanReceived.push(worst);
    }
  }

  if (presIdx === hIdx && assIdx >= 0) {
    t.humanNeedsToGive = true;
    t.humanGiveCount   = tc;
    t.humanGiveTo      = assIdx;
    t.humanGiveToName  = state.players[assIdx].name;
  } else if (vpIdx === hIdx && vaIdx >= 0) {
    t.humanNeedsToGive = true;
    t.humanGiveCount   = 1;
    t.humanGiveTo      = vaIdx;
    t.humanGiveToName  = state.players[vaIdx].name;
  }

  const humanInTrading = [presIdx, assIdx, vpIdx, vaIdx].includes(hIdx);
  state.phase = (presIdx >= 0 && assIdx >= 0 && humanInTrading) ? 'trading' : 'playing';
}

function takeTopCards(playerIdx, count) {
  const sorted = [...state.players[playerIdx].hand].sort((a, b) => b.rank - a.rank);
  const taken = sorted.slice(0, count);
  taken.forEach(c => {
    const i = state.players[playerIdx].hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) state.players[playerIdx].hand.splice(i, 1);
  });
  return taken;
}

function humanCompleteTrading(cards) {
  const t = state.trading;
  if (!t || !t.humanNeedsToGive || cards.length !== t.humanGiveCount) return false;
  const hIdx = humanIdx();
  cards.forEach(c => {
    const i = state.players[hIdx].hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) state.players[hIdx].hand.splice(i, 1);
    state.players[t.humanGiveTo].hand.push(c);
  });
  state.players[hIdx].hand = sortHand(state.players[hIdx].hand);
  state.players[t.humanGiveTo].hand = sortHand(state.players[t.humanGiveTo].hand);
  state.phase = 'playing';
  return true;
}

// ── AI turn ───────────────────────────────────────────────────────────────────

function aiTakeTurn(playerIdx) {
  const player = state.players[playerIdx];
  if (!player || player.isHuman) return null;
  if (player.finished) { advanceTurn(playerIdx); return null; }

  const play = aiChoosePlay(player.hand, state.pile, player.style || 'neutral');
  if (play) {
    applyPlay(playerIdx, play);
    return { action: 'play', cards: play };
  } else {
    applyPass(playerIdx);
    return { action: 'pass' };
  }
}

function aiChoosePlay(hand, pile, style) {
  const pileCount = pile.length;
  const pileRank  = pileCount > 0 ? pile[0].rank : -1;

  const groups = {};
  hand.forEach(c => {
    groups[c.value] = groups[c.value] || [];
    groups[c.value].push(c);
  });

  const nonTwoGroups = Object.values(groups)
    .filter(g => g[0].value !== '2')
    .sort((a, b) => a[0].rank - b[0].rank);  // ascending rank

  const twos = groups['2'] || [];

  return pileCount === 0
    ? aiLead(nonTwoGroups, twos, hand, style)
    : aiFollow(nonTwoGroups, twos, pileCount, pileRank, style);
}

function aiLead(nonTwoGroups, twos, hand, style) {
  // Universal: if only 2s remain, lead them all at once
  if (nonTwoGroups.length === 0 && twos.length > 0) return twos;

  // Universal: exactly 2 cards, one is a 2 — lead the 2 first, guaranteed win,
  // then last card plays out regardless (going out can't be stopped once last card is played)
  if (hand.length === 2 && twos.length > 0 && nonTwoGroups.length > 0) {
    return [twos[0]];
  }

  if (style === 'conservative' || style === 'neutral') {
    // Endgame: ≤ 4 cards with a 2 — lead highest non-trump first, keeping 2 as insurance
    if (twos.length > 0 && hand.length <= 4 && nonTwoGroups.length > 0) {
      return nonTwoGroups[nonTwoGroups.length - 1];
    }
    // Lead lowest complete group — clears cheap cards, sets achievable pile count
    if (nonTwoGroups.length > 0) return nonTwoGroups[0];
    if (twos.length > 0) return [twos[0]];
    return [hand[0]];
  }

  // aggressive: lead cheapest group of maximum count
  // biggest count > lowest rank within that count — clears hand fast, doesn't waste premium cards
  const byCount = [...nonTwoGroups].sort((a, b) =>
    b.length !== a.length ? b.length - a.length : a[0].rank - b[0].rank);
  if (byCount.length > 0) return byCount[0];
  if (twos.length > 0) return [twos[0]];
  return [hand[0]];
}

// ── Conquest scoring ──────────────────────────────────────────────────────────

function scoreRound() {
  const n = state.players.length;
  const deltas = new Array(n).fill(0);
  state.finishOrder.forEach((playerIdx, pos) => {
    let d = 0;
    if      (pos === 0)     d = 10;
    else if (pos === 1)     d = 5;
    else if (pos === n - 1) d = -1;
    else if (pos === 2)     d = 1;
    state.players[playerIdx].scoreTotal = (state.players[playerIdx].scoreTotal || 0) + d;
    deltas[playerIdx] = d;
  });
  saveConquestState();
  const atTarget = state.players.filter(p => p.scoreTotal >= CONQUEST_TARGET);
  let conquestWinner = null;
  if (atTarget.length > 0) {
    atTarget.sort((a, b) => {
      if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
      return state.finishOrder.indexOf(state.players.indexOf(a)) - state.finishOrder.indexOf(state.players.indexOf(b));
    });
    conquestWinner = atTarget[0];
  }
  return { deltas, conquestWinner };
}

function saveConquestState() {
  try {
    localStorage.setItem('presidentConquestState', JSON.stringify({
      numPlayers: state.players.length,
      playerNames: state.players.map(p => p.name),
      scores: state.players.map(p => p.scoreTotal || 0),
    }));
  } catch {}
}

function loadConquestState() {
  try {
    const s = localStorage.getItem('presidentConquestState');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function clearConquestState() {
  try { localStorage.removeItem('presidentConquestState'); } catch {}
}

function aiFollow(nonTwoGroups, twos, pileCount, pileRank, style) {
  // Non-trump cards that can beat the pile at matching count
  const beaters = nonTwoGroups
    .filter(g => g.length >= pileCount && g[0].rank > pileRank)
    .sort((a, b) => a[0].rank - b[0].rank);  // ascending

  if (style === 'conservative') {
    // Lowest beater; burns 2 only on Q+ piles — more selective than neutral, less than aggressive
    if (beaters.length > 0) return beaters[0].slice(0, pileCount);
    if (twos.length > 0 && pileRank >= 9) return [twos[0]];
    return null;
  }

  if (style === 'neutral') {
    // Lowest beater; 2 as last resort when truly stuck
    if (beaters.length > 0) return beaters[0].slice(0, pileCount);
    if (twos.length > 0) return [twos[0]];
    return null;
  }

  // aggressive: lowest beater to preserve high cards for leading;
  // burn 2 on any pile of 10 or higher (rank 7) — worth it to take control
  if (beaters.length > 0) return beaters[0].slice(0, pileCount);
  if (twos.length > 0 && pileRank >= 7) return [twos[0]];
  return null;
}
