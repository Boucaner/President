// ── Cards ─────────────────────────────────────────────────────────────────────
const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

function buildDeck() {
  const d = [];
  for (const suit of SUITS)
    for (const val of VALUES)
      d.push({ suit, value: val, rank: VALUES.indexOf(val) });
  return d;
}
function shuffle(d) {
  const a = [...d];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function isTrump(c) { return c.value === '2'; }
function sortHand(h) {
  return [...h].sort((a,b) => a.rank !== b.rank ? a.rank - b.rank : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}
function isLegalPlay(cards, pile) {
  if (!cards || !cards.length) return false;
  if (!cards.every(c => c.value === cards[0].value)) return false;
  if (isTrump(cards[0])) {
    if (cards.length === 1) return true;
    if (!pile.length) return true;
    return cards.length === pile.length;
  }
  if (!pile.length) return true;
  if (cards.length !== pile.length) return false;
  return cards[0].rank > pile[0].rank;
}

// ── AI logic ──────────────────────────────────────────────────────────────────
function aiChoosePlay(hand, pile, style) {
  const pileCount = pile.length;
  const pileRank  = pileCount > 0 ? pile[0].rank : -1;
  const groups = {};
  hand.forEach(c => { groups[c.value] = groups[c.value] || []; groups[c.value].push(c); });
  const nonTwoGroups = Object.values(groups).filter(g => g[0].value !== '2').sort((a,b) => a[0].rank - b[0].rank);
  const twos = groups['2'] || [];
  return pileCount === 0
    ? aiLead(nonTwoGroups, twos, hand, style)
    : aiFollow(nonTwoGroups, twos, pileCount, pileRank, style);
}

function aiLead(nonTwoGroups, twos, hand, style) {
  if (!nonTwoGroups.length && twos.length) return twos;
  // Universal: exactly 2 cards, one is a 2 — lead the 2 first
  if (hand.length === 2 && twos.length > 0 && nonTwoGroups.length > 0) return [twos[0]];
  if (style === 'conservative' || style === 'neutral') {
    // Endgame: ≤ 4 cards with a 2 — lead highest non-trump first, 2 as insurance
    if (twos.length > 0 && hand.length <= 4 && nonTwoGroups.length > 0) {
      return nonTwoGroups[nonTwoGroups.length - 1];
    }
    if (nonTwoGroups.length) return nonTwoGroups[0];
    if (twos.length) return [twos[0]];
    return [hand[0]];
  }
  // Universal: if only 2s remain, lead them all
  if (!nonTwoGroups.length && twos.length) return twos;
  // aggressive: biggest count, lowest rank within tier
  const byCount = [...nonTwoGroups].sort((a,b) => b.length !== a.length ? b.length - a.length : a[0].rank - b[0].rank);
  if (byCount.length) return byCount[0];
  if (twos.length) return [twos[0]];
  return [hand[0]];
}

function aiFollow(nonTwoGroups, twos, pileCount, pileRank, style) {
  const beaters = nonTwoGroups
    .filter(g => g.length >= pileCount && g[0].rank > pileRank)
    .sort((a,b) => a[0].rank - b[0].rank);
  if (style === 'conservative') {
    // Lowest beater; burns 2 only on K/A piles (rank >= 10) — more selective than neutral
    if (beaters.length) return beaters[0].slice(0, pileCount);
    if (twos.length && pileRank >= 9) return [twos[0]];
    return null;
  }
  if (style === 'neutral') {
    if (beaters.length) return beaters[0].slice(0, pileCount);
    if (twos.length) return [twos[0]];
    return null;
  }
  // aggressive: lowest beater; burn 2 on pile of 10+ (rank 7)
  if (beaters.length) return beaters[0].slice(0, pileCount);
  if (twos.length && pileRank >= 7) return [twos[0]];
  return null;
}

// ── Roles ─────────────────────────────────────────────────────────────────────
function assignRoles(players, finishOrder) {
  const n = players.length;
  players.forEach(p => p.role = null);
  if (n === 2) {
    if (finishOrder[0] !== undefined) players[finishOrder[0]].role = 'President';
    if (finishOrder[1] !== undefined) players[finishOrder[1]].role = 'Asshole';
    return;
  }
  if (finishOrder[0] !== undefined) players[finishOrder[0]].role = 'President';
  if (finishOrder[n-1] !== undefined) players[finishOrder[n-1]].role = 'Asshole';
  if (n >= 4) {
    if (finishOrder[1] !== undefined) players[finishOrder[1]].role = 'Vice President';
    if (finishOrder[n-2] !== undefined) players[finishOrder[n-2]].role = 'Vice Asshole';
  }
  players.forEach(p => { if (!p.role) p.role = 'Neutral'; });
}

function reorderSeats(players, finishOrder) {
  const roleOrder = { President:0, 'Vice President':1, Neutral:2, 'Vice Asshole':3, Asshole:4 };
  const finishPos = {};
  finishOrder.forEach((idx, pos) => { finishPos[idx] = pos; });
  const withIdx = players.map((p,i) => ({p,i}));
  withIdx.sort((a,b) => {
    const ra = roleOrder[a.p.role] ?? 2;
    const rb = roleOrder[b.p.role] ?? 2;
    if (ra !== rb) return ra - rb;
    return (finishPos[a.i] ?? 99) - (finishPos[b.i] ?? 99);
  });
  return withIdx.map(x => x.p);
}

function tradingCount(n) { return n <= 4 ? 2 : 1; }

function takeTopCards(hand, count) {
  const sorted = [...hand].sort((a,b) => b.rank - a.rank);
  const taken = sorted.slice(0, count);
  taken.forEach(c => {
    const i = hand.findIndex(h => h.suit === c.suit && h.value === c.value);
    if (i !== -1) hand.splice(i, 1);
  });
  return taken;
}

// ── Round simulation ──────────────────────────────────────────────────────────
// Returns finishOrder (indices) and per-player action stats
function simulateRound(players, oneTimeAround = true) {
  const n = players.length;
  players.forEach(p => { p.hand = sortHand(p.hand); p.finished = false; });

  const actionStats = players.map(() => ({ plays: 0, passes: 0, twoPlays: 0, conservePass: 0, aggroBurn: 0 }));

  let pile = [];
  let trickLeader = 0;
  let currentTurn = 0;
  let trickTurns = 0;
  let trickPlayerCount = n;
  let passCount = 0;
  const finishOrder = [];

  function advanceTurn(from) {
    let next = (from + 1) % n;
    let loops = 0;
    while (players[next].finished && loops < n) { next = (next+1)%n; loops++; }
    currentTurn = next;
  }

  function nextActive(from) {
    let next = (from+1)%n;
    let loops = 0;
    while (players[next].finished && loops < n) { next=(next+1)%n; loops++; }
    return next;
  }

  function endTrick(winnerIdx) {
    pile = [];
    passCount = 0;
    trickTurns = 0;
    // Check round end first
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) return true; // round ending handled below
    trickPlayerCount = active.length;
    if (players[winnerIdx].finished) {
      const next = nextActive(winnerIdx);
      trickLeader = next;
      currentTurn = next;
    } else {
      trickLeader = winnerIdx;
      currentTurn = winnerIdx;
    }
    return false;
  }

  function checkRoundEnd() {
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) {
      const last = players.find(p => !p.finished);
      if (last) { last.finished = true; finishOrder.push(players.indexOf(last)); }
      return true;
    }
    return false;
  }

  let maxIterations = 10000; // safety
  while (!checkRoundEnd() && maxIterations-- > 0) {
    const player = players[currentTurn];
    const pidx = currentTurn;
    const play = aiChoosePlay(player.hand, pile, player.style || 'neutral');

    if (play) {
      // Track stats
      actionStats[pidx].plays++;
      if (isTrump(play[0])) {
        actionStats[pidx].twoPlays++;
        // Was this a wasteful 2 for conservative (they shouldn't use 2 unless only card left)
        if (player.style === 'conservative' && player.hand.filter(c => !isTrump(c)).length > 0) {
          actionStats[pidx].conservePass++; // misfire: played 2 when had other cards
        }
        // Aggressive burning a 2 — was pile rank below threshold?
        if (player.style === 'aggressive' && pile.length > 0 && pile[0].rank < 10) {
          actionStats[pidx].aggroBurn++; // burned 2 on weak pile
        }
      }

      // Remove cards from hand
      play.forEach(c => {
        const i = player.hand.findIndex(h => h.suit===c.suit && h.value===c.value);
        if (i !== -1) player.hand.splice(i, 1);
      });
      pile = play;
      trickLeader = pidx;
      passCount = 0;
      trickTurns++;

      if (player.hand.length === 0) {
        player.finished = true;
        finishOrder.push(pidx);
      }

      if (isTrump(play[0])) {
        if (checkRoundEnd()) break;
        if (endTrick(pidx)) break;
        continue;
      }

      if (checkRoundEnd()) break;

      if (oneTimeAround && trickTurns >= trickPlayerCount) {
        if (endTrick(trickLeader)) break;
        continue;
      }

      advanceTurn(pidx);
      if (players[trickLeader].finished) trickLeader = currentTurn;

    } else {
      // Pass
      actionStats[pidx].passes++;
      passCount++;
      trickTurns++;

      if (oneTimeAround) {
        if (trickTurns >= trickPlayerCount) {
          if (endTrick(trickLeader)) break;
          continue;
        }
      } else {
        const activePlayers = players.filter(p => !p.finished);
        if (passCount >= activePlayers.length) {
          if (endTrick(trickLeader)) break;
          continue;
        }
      }
      advanceTurn(pidx);
    }
  }

  return { finishOrder, actionStats };
}

// ── Trading (AI only, automatic) ──────────────────────────────────────────────
function doTrading(players, roundNum) {
  if (roundNum <= 1) return;
  const n = players.length;
  const tc = tradingCount(n);
  const presIdx = players.findIndex(p => p.role === 'President');
  const assIdx  = players.findIndex(p => p.role === 'Asshole');
  const vpIdx   = n >= 4 ? players.findIndex(p => p.role === 'Vice President') : -1;
  const vaIdx   = n >= 4 ? players.findIndex(p => p.role === 'Vice Asshole')   : -1;

  let presReceived = [];
  if (presIdx >= 0 && assIdx >= 0) {
    presReceived = takeTopCards(players[assIdx].hand, tc);
    presReceived.forEach(c => players[presIdx].hand.push(c));
    players[presIdx].hand = sortHand(players[presIdx].hand);
    // President gives back worst cards
    const receivedKeys = new Set(presReceived.map(c => c.suit+c.value));
    const original = players[presIdx].hand.filter(c => !receivedKeys.has(c.suit+c.value));
    const pool = original.length >= tc ? original : players[presIdx].hand;
    const giveBack = [...pool].sort((a,b) => a.rank-b.rank).slice(0, tc);
    giveBack.forEach(c => {
      const i = players[presIdx].hand.findIndex(h => h.suit===c.suit && h.value===c.value);
      if (i !== -1) players[presIdx].hand.splice(i, 1);
      players[assIdx].hand.push(c);
    });
    players[assIdx].hand = sortHand(players[assIdx].hand);
  }

  let vpReceived = [];
  if (vpIdx >= 0 && vaIdx >= 0) {
    vpReceived = takeTopCards(players[vaIdx].hand, 1);
    vpReceived.forEach(c => players[vpIdx].hand.push(c));
    players[vpIdx].hand = sortHand(players[vpIdx].hand);
    const receivedKeys = new Set(vpReceived.map(c => c.suit+c.value));
    const original = players[vpIdx].hand.filter(c => !receivedKeys.has(c.suit+c.value));
    const pool = original.length >= 1 ? original : players[vpIdx].hand;
    const worst = [...pool].sort((a,b) => a.rank-b.rank)[0];
    if (worst) {
      const i = players[vpIdx].hand.findIndex(h => h.suit===worst.suit && h.value===worst.value);
      if (i !== -1) players[vpIdx].hand.splice(i, 1);
      players[vaIdx].hand.push(worst);
      players[vaIdx].hand = sortHand(players[vaIdx].hand);
    }
  }
}

// ── Main simulation ───────────────────────────────────────────────────────────
const ROUNDS_PER_GAME = 5;
const TOTAL_GAMES     = 500;
const NUM_PLAYERS     = 4;
const STYLES          = ['conservative', 'neutral', 'aggressive', 'neutral'];

// Per-style accumulators
const styleAcc = {};
['conservative','neutral','aggressive'].forEach(s => {
  styleAcc[s] = {
    rounds: 0, posSum: 0, wins: 0, last: 0,
    plays: 0, passes: 0, twoPlays: 0,
    conserveMisfires: 0,  // conservative played 2 when had other cards
    aggroBurns: 0,        // aggressive burned 2 on weak pile
  };
});

// For win-rate tracking: does president advantage compound over multi-round?
let presWinFollow = 0; // times president (round N) won round N+1
let presCount = 0;

for (let g = 0; g < TOTAL_GAMES; g++) {
  // Create players with fixed styles for this game
  let players = STYLES.map((style, i) => ({
    name: `P${i}(${style.slice(0,3)})`,
    hand: [],
    role: null,
    finished: false,
    style,
    isHuman: false,
  }));

  let finishOrder = [];

  for (let r = 0; r < ROUNDS_PER_GAME; r++) {
    // Reorder seats for round 2+
    if (r > 0) players = reorderSeats(players, finishOrder);

    // Deal
    const deck = shuffle(buildDeck());
    const cardsEach = Math.floor(deck.length / NUM_PLAYERS);
    players.forEach(p => { p.hand = []; p.finished = false; });
    deck.slice(0, cardsEach * NUM_PLAYERS).forEach((card, i) => {
      players[i % NUM_PLAYERS].hand.push(card);
    });

    // Trading (round 2+)
    if (r > 0) doTrading(players, r + 1);

    // Play round
    const result = simulateRound(players, true);
    finishOrder = result.finishOrder;
    const { actionStats } = result;

    // Accumulate stats per-player-per-style
    finishOrder.forEach((pidx, pos) => {
      const style = players[pidx].style;
      if (!style) return;
      const acc = styleAcc[style];
      acc.rounds++;
      acc.posSum += (pos + 1); // 1-indexed finish position
      if (pos === 0) acc.wins++;
      if (pos === NUM_PLAYERS - 1) acc.last++;
      acc.plays  += actionStats[pidx].plays;
      acc.passes += actionStats[pidx].passes;
      acc.twoPlays += actionStats[pidx].twoPlays;
      acc.conserveMisfires += actionStats[pidx].conservePass;
      acc.aggroBurns += actionStats[pidx].aggroBurn;
    });

    // Assign roles for next round
    assignRoles(players, finishOrder);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  President AI Simulation — 100 games × 5 rounds');
console.log('  4 players: 1 conservative, 2 neutral, 1 aggressive');
console.log('══════════════════════════════════════════════════════\n');

for (const [style, acc] of Object.entries(styleAcc)) {
  const r = acc.rounds;
  const totalActions = acc.plays + acc.passes;
  const passRate  = r > 0 ? (acc.passes / totalActions * 100).toFixed(1) : 0;
  const twoRate   = acc.plays > 0 ? (acc.twoPlays / acc.plays * 100).toFixed(1) : 0;
  const avgPos    = r > 0 ? (acc.posSum / r).toFixed(2) : '—';
  const winPct    = r > 0 ? (acc.wins / r * 100).toFixed(1) : 0;
  const lastPct   = r > 0 ? (acc.last / r * 100).toFixed(1) : 0;

  console.log(`── ${style.toUpperCase()} ──`);
  console.log(`  Rounds played   : ${r}`);
  console.log(`  Avg finish pos  : ${avgPos}  (1=best, ${NUM_PLAYERS}=worst)`);
  console.log(`  Win rate (1st)  : ${winPct}%`);
  console.log(`  Last place rate : ${lastPct}%`);
  console.log(`  Pass rate       : ${passRate}%`);
  console.log(`  2-play rate     : ${twoRate}% of plays`);

  if (style === 'conservative') {
    console.log(`  Misfire 2s      : ${acc.conserveMisfires} (played 2 when had other cards — should be 0)`);
  }
  if (style === 'aggressive') {
    console.log(`  Wasteful 2-burns: ${acc.aggroBurns} (burned 2 on pile rank <10)`);
  }
  console.log();
}

// Breakdown: pass rate per player count situation would require more tracking.
// Instead, spot-check one full round with verbose logging.
console.log('── SPOT CHECK: one verbose 4-player round ──\n');

const verbosePlayers = STYLES.map((style, i) => ({
  name: `P${i}(${style.slice(0,3)})`,
  hand: [],
  role: null,
  finished: false,
  style,
}));

const vDeck = shuffle(buildDeck());
const vCardsEach = Math.floor(vDeck.length / NUM_PLAYERS);
verbosePlayers.forEach(p => p.hand = []);
vDeck.slice(0, vCardsEach * NUM_PLAYERS).forEach((card, i) => {
  verbosePlayers[i % NUM_PLAYERS].hand.push(card);
});
verbosePlayers.forEach(p => { p.hand = sortHand(p.hand); });

// Override simulateRound with verbose version
function simulateRoundVerbose(players) {
  const n = players.length;
  let pile = [];
  let trickLeader = 0;
  let currentTurn = 0;
  let trickTurns = 0;
  let trickPlayerCount = n;
  let passCount = 0;
  const finishOrder = [];
  let trickNum = 0;

  function advanceTurn(from) {
    let next = (from + 1) % n;
    let loops = 0;
    while (players[next].finished && loops < n) { next=(next+1)%n; loops++; }
    currentTurn = next;
  }
  function nextActive(from) {
    let next = (from+1)%n;
    let loops = 0;
    while (players[next].finished && loops < n) { next=(next+1)%n; loops++; }
    return next;
  }
  function endTrick(winnerIdx) {
    console.log(`  → Trick ${trickNum} won by ${players[winnerIdx]?.name}`);
    pile = []; passCount = 0; trickTurns = 0;
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) return true;
    trickPlayerCount = active.length;
    if (players[winnerIdx].finished) {
      const next = nextActive(winnerIdx);
      trickLeader = next; currentTurn = next;
    } else {
      trickLeader = winnerIdx; currentTurn = winnerIdx;
    }
    return false;
  }
  function checkRoundEnd() {
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) {
      const last = players.find(p => !p.finished);
      if (last) { last.finished = true; finishOrder.push(players.indexOf(last)); }
      return true;
    }
    return false;
  }

  let maxIter = 5000;
  let lastTrickLeader = -1;
  while (!checkRoundEnd() && maxIter-- > 0) {
    const player = players[currentTurn];
    const pidx = currentTurn;

    if (trickLeader !== lastTrickLeader || pile.length === 0) {
      if (pile.length === 0) {
        trickNum++;
        console.log(`\nTrick ${trickNum} — ${players[trickLeader].name} leads (${players[trickLeader].hand.length} cards left)`);
        lastTrickLeader = trickLeader;
      }
    }

    const play = aiChoosePlay(player.hand, pile, player.style || 'neutral');

    if (play) {
      const label = play.map(c => c.value+c.suit).join(' ');
      console.log(`  ${player.name} plays ${label}${isTrump(play[0])?' [TRUMP 2]':''}`);
      play.forEach(c => {
        const i = player.hand.findIndex(h => h.suit===c.suit && h.value===c.value);
        if (i !== -1) player.hand.splice(i, 1);
      });
      pile = play;
      trickLeader = pidx;
      passCount = 0;
      trickTurns++;

      if (player.hand.length === 0) {
        player.finished = true;
        finishOrder.push(pidx);
        console.log(`  *** ${player.name} goes out! (pos ${finishOrder.length}) ***`);
      }

      if (isTrump(play[0])) {
        if (checkRoundEnd()) break;
        if (endTrick(pidx)) break;
        continue;
      }
      if (checkRoundEnd()) break;
      if (trickTurns >= trickPlayerCount) {
        if (endTrick(trickLeader)) break;
        continue;
      }
      advanceTurn(pidx);
      if (players[trickLeader].finished) trickLeader = currentTurn;
    } else {
      console.log(`  ${player.name} passes`);
      passCount++;
      trickTurns++;
      if (trickTurns >= trickPlayerCount) {
        if (endTrick(trickLeader)) break;
        continue;
      }
      advanceTurn(pidx);
    }
  }

  console.log('\nFinish order:');
  finishOrder.forEach((pidx, pos) => {
    console.log(`  ${pos+1}. ${players[pidx].name}`);
  });
  return finishOrder;
}

simulateRoundVerbose(verbosePlayers);
console.log('\nDone.\n');
