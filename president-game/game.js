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
  roundScored: false,
  valuePlayed: {},   // count of each card value played this round: { '2': 2, 'A': 1, … }
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
    conquest: false,
    kittyExchange: false,
    holdHand: false,
  },
  phase: 'start',    // 'start' | 'holdExchange' | 'kittyExchange' | 'trading' | 'playing' | 'roundEnd'
  kitty: [],
  holdHand: [],
  lastPlay: null,          // { playerName, cards } of most recent play (persists after pile clears)
  trickLog: [],            // completed tricks this round: [{ plays:[{playerName,cards}], winnerName }]
  currentTrickPlays: [],   // plays accumulated in the current trick
};

// ── Setup ──────────────────────────────────────────────────────────────────────

function initGame(settings) {
  Object.assign(state.settings, settings);
  const n = state.settings.numPlayers;

  state.players = [];
  state.roundNum = 0;

  const AI_STYLES = ['conservative', 'neutral', 'aggressive'];
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

  dealRound();
}

function dealRound() {
  state.roundNum++;
  state.roundScored = false;

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
  state.valuePlayed = {};
  state.players.forEach(p => { p.handAssessed = false; p.target = 'middle'; });

  // Shuffle and deal
  const deck = shuffle(buildDeck());
  state.holdHand = [];

  if (state.settings.holdHand && n === 2) {
    // Deal to 3 slots round-robin (hold at slot 0) so hold gets one extra card
    state.kitty = [];
    deck.forEach((card, i) => {
      const slot = i % 3;
      if (slot === 0) state.holdHand.push(card);
      else state.players[slot - 1].hand.push(card);
    });
    state.holdHand = sortHand(state.holdHand);
  } else {
    const cardsEach = Math.floor(deck.length / n);
    state.kitty = deck.slice(cardsEach * n);
    deck.slice(0, cardsEach * n).forEach((card, i) => {
      state.players[i % n].hand.push(card);
    });
  }
  state.players.forEach(p => { p.hand = sortHand(p.hand); });

  // Round 1: random first player; round 2+: President (index 0 after reorderSeats) leads
  const firstPlayer = state.roundNum === 1 ? Math.floor(Math.random() * n) : 0;
  state.currentTurn = firstPlayer;
  state.trickLeader = firstPlayer;

  startHoldExchange();
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

// ── Hand assessment ────────────────────────────────────────────────────────────

// Scores a hand by high-card strength. Called once per round after dealing + trading.
function assessHand(hand) {
  const groups = {};
  hand.forEach(c => {
    groups[c.value] = groups[c.value] || [];
    groups[c.value].push(c);
  });
  const twos     = (groups['2'] || []).length;
  const aces     = (groups['A'] || []).length;
  const kings    = (groups['K'] || []).length;
  // Pairs or better of J+ (rank >= 8), excluding 2s
  const highPairs = Object.values(groups).filter(g =>
    g[0].rank >= 8 && g[0].value !== '2' && g.length >= 2).length;
  const score = twos * 5 + aces * 2 + kings * 1.5 + highPairs * 2;
  return { twos, aces, kings, highPairs, score };
}

// Sets player.target ('top' | 'middle' | 'survive') based on hand strength and current role.
// 'top'    — aim to go out 1st or 2nd
// 'middle' — aim to move up, avoid last
// 'survive'— weak hand + low position; just try not to be last
function setPlayerTarget(player) {
  const m = assessHand(player.hand);
  player.handMetrics = m;
  const roleOrder = { 'President': 0, 'Vice President': 1, 'Neutral': 2, 'Vice Asshole': 3, 'Asshole': 4 };
  const rank = player.role !== null ? (roleOrder[player.role] ?? 2) : 2;
  if (m.score >= 8) {
    player.target = 'top';
  } else if (m.score >= 4) {
    player.target = rank >= 3 ? 'middle' : 'top'; // VA/Asshole with medium hand aim to move up, not dominate
  } else {
    player.target = rank >= 3 ? 'survive' : 'middle'; // weak hand: VA/Asshole just survive; others play safe
  }
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
  cards.forEach(c => { state.valuePlayed[c.value] = (state.valuePlayed[c.value] || 0) + 1; });
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

function startHoldExchange() {
  if (!state.settings.holdHand || state.players.length !== 2 || state.roundNum <= 1 || !state.holdHand.length) {
    startTrading();
    return;
  }
  state.holdExchange = { playerOrder: [0, 1], currentStep: 0 };
  state.phase = 'holdExchange';
  advanceHoldExchange();
}

function advanceHoldExchange() {
  const hx = state.holdExchange;
  while (hx.currentStep < hx.playerOrder.length) {
    const playerIdx = hx.playerOrder[hx.currentStep];
    if (state.players[playerIdx].isHuman) return;
    aiDoHoldExchange(playerIdx);
    hx.currentStep++;
  }
  state.holdHand = [];
  startTrading();
}

function aiDoHoldExchange(playerIdx) {
  const player = state.players[playerIdx];
  const m = assessHand(player.hand);
  if (m.score < 5) {
    const temp = [...player.hand];
    player.hand = sortHand([...state.holdHand]);
    state.holdHand = sortHand(temp);
  }
}

function humanCompleteHoldExchange(swap) {
  const hIdx = humanIdx();
  if (swap) {
    const temp = [...state.players[hIdx].hand];
    state.players[hIdx].hand = sortHand([...state.holdHand]);
    state.holdHand = sortHand(temp);
  }
  state.holdExchange.currentStep++;
  advanceHoldExchange();
  return true;
}

function startKittyExchange() {
  if (!state.settings.kittyExchange || state.roundNum <= 1 || !state.kitty.length) {
    state.phase = 'playing';
    return;
  }
  state.kittyExchange = {
    kitty: [...state.kitty],
    playerOrder: state.players.map((_, i) => i),
    currentStep: 0,
  };
  state.phase = 'kittyExchange';
  advanceKittyExchange();
}

function advanceKittyExchange() {
  const kx = state.kittyExchange;
  while (kx.currentStep < kx.playerOrder.length) {
    const playerIdx = kx.playerOrder[kx.currentStep];
    if (state.players[playerIdx].isHuman) return;
    aiDoKittyExchange(playerIdx);
    kx.currentStep++;
  }
  state.phase = 'playing';
}

function aiDoKittyExchange(playerIdx) {
  const kx = state.kittyExchange;
  const player = state.players[playerIdx];
  const sortedKitty = [...kx.kitty].sort((a, b) => b.rank - a.rank);
  const sortedHand  = [...player.hand].sort((a, b) => a.rank - b.rank);
  const give = [], take = [];
  for (let i = 0; i < sortedKitty.length && i < sortedHand.length; i++) {
    if (sortedKitty[i].rank > sortedHand[i].rank) {
      take.push(sortedKitty[i]);
      give.push(sortedHand[i]);
    } else break;
  }
  take.forEach(c => {
    const i = kx.kitty.findIndex(k => k.suit === c.suit && k.value === c.value);
    if (i !== -1) kx.kitty.splice(i, 1);
    player.hand.push(c);
  });
  give.forEach(c => {
    const i = player.hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) player.hand.splice(i, 1);
    kx.kitty.push(c);
  });
  player.hand = sortHand(player.hand);
}

function humanCompleteKittyExchange(takeCards, giveCards) {
  if (takeCards.length !== giveCards.length) return false;
  const kx = state.kittyExchange;
  const hIdx = humanIdx();
  takeCards.forEach(c => {
    const i = kx.kitty.findIndex(k => k.suit === c.suit && k.value === c.value);
    if (i !== -1) kx.kitty.splice(i, 1);
    state.players[hIdx].hand.push(c);
  });
  giveCards.forEach(c => {
    const i = state.players[hIdx].hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) state.players[hIdx].hand.splice(i, 1);
    kx.kitty.push(c);
  });
  state.players[hIdx].hand = sortHand(state.players[hIdx].hand);
  kx.currentStep++;
  advanceKittyExchange();
  return true;
}

function startTrading() {
  if (state.roundNum <= 1 || !state.settings.cardTrading) {
    startKittyExchange();
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
  if (presIdx >= 0 && assIdx >= 0 && humanInTrading) {
    state.phase = 'trading';
  } else {
    startKittyExchange();
  }
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
  startKittyExchange();
  return true;
}

// ── AI turn ───────────────────────────────────────────────────────────────────

function aiTakeTurn(playerIdx) {
  const player = state.players[playerIdx];
  if (!player || player.isHuman) return null;
  if (player.finished) { advanceTurn(playerIdx); return null; }

  // Assess hand once per round (after deal + trading are settled)
  if (!player.handAssessed) {
    setPlayerTarget(player);
    player.handAssessed = true;
  }

  const play = aiChoosePlay(player.hand, state.pile, player.style || 'neutral', player.target || 'middle', state.valuePlayed);
  if (play) {
    applyPlay(playerIdx, play);
    return { action: 'play', cards: play };
  } else {
    applyPass(playerIdx);
    return { action: 'pass' };
  }
}

function aiChoosePlay(hand, pile, style, target, valuePlayed) {
  const pileCount = pile.length;
  const pileRank  = pileCount > 0 ? pile[0].rank : -1;

  const groups = {};
  hand.forEach(c => {
    groups[c.value] = groups[c.value] || [];
    groups[c.value].push(c);
  });

  const nonTwoGroups = Object.values(groups)
    .filter(g => g[0].value !== '2')
    .sort((a, b) => a[0].rank - b[0].rank);

  const twos = groups['2'] || [];

  // If I hold all remaining unplayed 2s, my Aces are unbeatable
  const twosPlayed  = valuePlayed['2'] || 0;
  const iHoldAllTwos = twos.length > 0 && twos.length >= (4 - twosPlayed);

  return pileCount === 0
    ? aiLead(nonTwoGroups, twos, hand, style, target, iHoldAllTwos)
    : aiFollow(nonTwoGroups, twos, pileCount, pileRank, style, target, hand, valuePlayed);
}

function aiLead(nonTwoGroups, twos, hand, style, target, iHoldAllTwos) {
  // Universal: only 2s remain — lead them all
  if (nonTwoGroups.length === 0 && twos.length > 0) return twos;

  // Universal: exactly 2 cards left and one is a 2 — lead the 2 first; last card then plays uncontested
  if (hand.length === 2 && twos.length > 0 && nonTwoGroups.length > 0) return [twos[0]];

  if (target === 'top') {
    // If holding all remaining 2s, Aces can't be beaten — lead Ace to shed it safely in endgame
    if (iHoldAllTwos && hand.length <= 5) {
      const aceGroup = nonTwoGroups.find(g => g[0].value === 'A');
      if (aceGroup) return [aceGroup[0]];
    }
    if (style === 'aggressive') {
      // Lead largest group of cheapest cards — empty hand fast
      const byCount = [...nonTwoGroups].sort((a, b) =>
        b.length !== a.length ? b.length - a.length : a[0].rank - b[0].rank);
      if (byCount.length > 0) return byCount[0];
    } else {
      // Endgame: ≤ 4 cards with a 2 — lead highest non-trump, keep 2 as finisher
      if (twos.length > 0 && hand.length <= 4 && nonTwoGroups.length > 0)
        return nonTwoGroups[nonTwoGroups.length - 1];
      if (nonTwoGroups.length > 0) return nonTwoGroups[0];
    }
    if (twos.length > 0) return [twos[0]];
    return [hand[0]];
  }

  if (target === 'survive') {
    // Lead lowest single card — shed junk, preserve pairs/triples for reactive play
    const singles = nonTwoGroups.filter(g => g.length === 1);
    if (singles.length > 0) return [singles[0][0]];
    // No singles — reluctantly lead lowest card from smallest group (don't break big groups)
    const bySize = [...nonTwoGroups].sort((a, b) => a.length - b.length || a[0].rank - b[0].rank);
    if (bySize.length > 0) return [bySize[0][0]];
    if (twos.length > 0) return [twos[0]];
    return [hand[0]];
  }

  // Target = 'middle'
  if (style === 'aggressive') {
    const byCount = [...nonTwoGroups].sort((a, b) =>
      b.length !== a.length ? b.length - a.length : a[0].rank - b[0].rank);
    if (byCount.length > 0) return byCount[0];
    if (twos.length > 0) return [twos[0]];
    return [hand[0]];
  }
  // conservative / neutral, middle: lead lowest group; use 2 as endgame insurance
  if (twos.length > 0 && hand.length <= 4 && nonTwoGroups.length > 0)
    return nonTwoGroups[nonTwoGroups.length - 1];
  if (nonTwoGroups.length > 0) return nonTwoGroups[0];
  if (twos.length > 0) return [twos[0]];
  return [hand[0]];
}

// ── Conquest scoring ──────────────────────────────────────────────────────────

function scoreRound() {
  if (state.roundScored) return null;
  state.roundScored = true;

  const n = state.players.length;
  const deltas = new Array(n).fill(0);
  state.finishOrder.forEach((playerIdx, pos) => {
    let d = 0;
    if (n === 2) {
      d = pos === 0 ? 10 : 0;
    } else {
      if      (pos === 0)     d = 10;
      else if (pos === 1)     d = 5;
      else if (pos === n - 1) d = -1;
      else if (pos === 2)     d = 1;
    }
    state.players[playerIdx].scoreTotal = (state.players[playerIdx].scoreTotal || 0) + d;
    deltas[playerIdx] = d;
  });
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

function aiFollow(nonTwoGroups, twos, pileCount, pileRank, style, target, hand, valuePlayed) {
  const beaters = nonTwoGroups
    .filter(g => g.length >= pileCount && g[0].rank > pileRank)
    .sort((a, b) => a[0].rank - b[0].rank);

  const handSize    = hand.length;
  const lowestBeater = beaters[0] || null;
  const playRank    = lowestBeater ? lowestBeater[0].rank : -1;

  // Non-trump cards strictly higher than our proposed play (backup cards)
  const higherAfter = lowestBeater
    ? hand.filter(c => c.value !== '2' && c.rank > playRank).length
    : 0;

  // 2s still in opponents' hands (unplayed and not in my hand)
  const twosStillOut = (4 - (valuePlayed['2'] || 0)) - twos.length;

  // ── Universal go-out checks ────────────────────────────────────────────────
  // Playing these cards empties our hand entirely — always take it
  if (lowestBeater && handSize === pileCount) return lowestBeater.slice(0, pileCount);
  // All remaining cards are 2s — play them out
  if (!lowestBeater && twos.length > 0 && twos.length === handSize) {
    if (twos.length === pileCount) return twos;
    if (twos.length === 1) return [twos[0]]; // single 2 is always legal
  }

  // ── Target: 'top' — go out as fast as possible ─────────────────────────────
  if (target === 'top') {
    if (lowestBeater) return lowestBeater.slice(0, pileCount);
    if (twos.length > 0) return [twos[0]];
    return null;
  }

  // ── Target: 'survive' — play selectively; save high cards for later ─────────
  if (target === 'survive') {
    if (!lowestBeater) {
      // No non-trump beater; use 2 only on very high piles
      const twoEmergencyRank = style === 'conservative' ? 11 : 10; // A only / K+
      if (twos.length > 0 && pileRank >= twoEmergencyRank) return [twos[0]];
      return null;
    }
    // Play only when cost is low: cheap card AND have something better in reserve
    // If no 2s remain in opponents' hands, raise the threshold (high cards are safer)
    const baseThreshold = style === 'conservative' ? 6   // ≤ 9  (rank 0-6)
                        : style === 'neutral'       ? 8   // ≤ J  (rank 0-8)
                        :                            9;   // ≤ Q  (rank 0-9)
    const threshold = twosStillOut === 0 ? Math.max(baseThreshold, 11) : baseThreshold;
    if (playRank <= threshold && higherAfter >= 1) return lowestBeater.slice(0, pileCount);
    // Fall back to 2 only on high piles
    const twoThreshold = style === 'conservative' ? 11  // A pile
                       : style === 'neutral'       ? 10  // K+
                       :                            9;   // Q+
    if (twos.length > 0 && pileRank >= twoThreshold) return [twos[0]];
    return null;
  }

  // ── Target: 'middle' — balanced; minor refinements per style ───────────────
  if (style === 'conservative') {
    if (lowestBeater) {
      // Don't sacrifice our only King or Ace when we have nothing else and won't go out
      if (playRank >= 10 && higherAfter === 0 && handSize > pileCount + 1) return null;
      return lowestBeater.slice(0, pileCount);
    }
    if (twos.length > 0 && pileRank >= 9) return [twos[0]]; // Q+
    return null;
  }
  if (style === 'neutral') {
    if (lowestBeater) return lowestBeater.slice(0, pileCount);
    if (twos.length > 0) return [twos[0]];
    return null;
  }
  // aggressive + middle
  if (lowestBeater) return lowestBeater.slice(0, pileCount);
  if (twos.length > 0 && pileRank >= 7) return [twos[0]]; // 10+
  return null;
}
