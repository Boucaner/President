'use strict';
// ── 2-Player President Simulation ─────────────────────────────────────────────
// 100 games × 10 rounds, all 6 AI style matchups, with and without hold hand.
//
// Cards: 52-card deck, ranks 3(0)–A(11)–2(12)
// Hold hand: 3-way round-robin deal → hold=18 cards, each player=17 cards
// No hold: normal 2-way deal → 26 cards each
// Card trading (round 2+): Wiper gives President top 2; President returns 2 worst
// Hold swap (round 2+): President decides first, then Wiper; AI swaps if hold > own score

const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

function buildDeck() {
  const d = [];
  for (const s of SUITS) for (const v of VALUES)
    d.push({ suit: s, value: v, rank: VALUES.indexOf(v) });
  return d;
}
function shuffle(d) {
  const a = [...d];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function isTrump(c) { return c.value === '2'; }
function sortHand(h) {
  return [...h].sort((a,b) => a.rank !== b.rank ? a.rank-b.rank : SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit));
}
function handScore(h) { return h.reduce((s,c) => s+c.rank, 0); }

// ── AI play logic ──────────────────────────────────────────────────────────────
// oppHandSize: passed in 2-player mode, undefined otherwise
function aiLead(nonTwoGroups, twos, hand, style, oppHandSize) {
  if (!nonTwoGroups.length && twos.length) return twos;
  if (hand.length === 2 && twos.length && nonTwoGroups.length) return [twos[0]];
  if (oppHandSize !== undefined) {
    // 2-player: unified strategy for all styles
    // Endgame: have a 2 and ≤4 cards — lead high, save 2 as finisher
    if (twos.length && hand.length <= 4 && nonTwoGroups.length)
      return nonTwoGroups[nonTwoGroups.length-1];
    // Pressure: opponent close to going out — lead high single
    if (oppHandSize <= 3 && nonTwoGroups.length)
      return [nonTwoGroups[nonTwoGroups.length-1][0]];
    // Normal: lead biggest group at lowest rank
    const byCount2P = [...nonTwoGroups].sort((a,b) =>
      b.length !== a.length ? b.length-a.length : a[0].rank-b[0].rank);
    if (byCount2P.length) return byCount2P[0];
    return twos.length ? [twos[0]] : [hand[0]];
  }
  // 4+ player: style-differentiated
  if (style === 'aggressive') {
    const byCount = [...nonTwoGroups].sort((a,b) => b.length !== a.length ? b.length-a.length : a[0].rank-b[0].rank);
    return byCount[0] || (twos.length ? [twos[0]] : [hand[0]]);
  }
  // conservative/neutral 4+ player
  if (twos.length && hand.length <= 4 && nonTwoGroups.length)
    return nonTwoGroups[nonTwoGroups.length-1];
  if (nonTwoGroups.length) return nonTwoGroups[0];
  return twos.length ? [twos[0]] : [hand[0]];
}
function aiFollow(nonTwoGroups, twos, pileCount, pileRank, style, is2P) {
  const beaters = nonTwoGroups
    .filter(g => g.length >= pileCount && g[0].rank > pileRank)
    .sort((a,b) => a[0].rank-b[0].rank);
  // 2-player: always beat, always use 2 when needed (target='top' behavior)
  if (is2P) {
    if (beaters.length) return beaters[0].slice(0, pileCount);
    if (twos.length) return [twos[0]];
    return null;
  }
  // 4+ player: style-differentiated
  if (style === 'conservative') {
    if (beaters.length) return beaters[0].slice(0, pileCount);
    if (twos.length && pileRank >= 9) return [twos[0]];
    return null;
  }
  if (style === 'neutral') {
    if (beaters.length) return beaters[0].slice(0, pileCount);
    if (twos.length) return [twos[0]];
    return null;
  }
  // aggressive
  if (beaters.length) return beaters[0].slice(0, pileCount);
  if (twos.length && pileRank >= 7) return [twos[0]];
  return null;
}
function aiChoosePlay(hand, pile, style, oppHandSize) {
  const pileCount = pile.length;
  const pileRank  = pileCount > 0 ? pile[0].rank : -1;
  const groups = {};
  hand.forEach(c => { groups[c.value] = groups[c.value] || []; groups[c.value].push(c); });
  const nonTwo = Object.values(groups).filter(g => g[0].value !== '2').sort((a,b) => a[0].rank-b[0].rank);
  const twos   = groups['2'] || [];
  const is2P   = oppHandSize !== undefined;
  return pileCount === 0
    ? aiLead(nonTwo, twos, hand, style, oppHandSize)
    : aiFollow(nonTwo, twos, pileCount, pileRank, style, is2P);
}

// ── Round simulation (one-time-around) ────────────────────────────────────────
function simulateRound(players) {
  const n = players.length;
  players.forEach(p => { p.hand = sortHand(p.hand); p.finished = false; });
  let pile = [], trickLeader = 0, currentTurn = 0;
  let trickTurns = 0, trickPlayerCount = n;
  const finishOrder = [];

  function nextActive(from) {
    let next = (from+1)%n, loops = 0;
    while (players[next].finished && loops < n) { next=(next+1)%n; loops++; }
    return next;
  }
  function endTrick(winnerIdx) {
    pile = []; trickTurns = 0;
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) return true;
    trickPlayerCount = active.length;
    const w = players[winnerIdx].finished ? nextActive(winnerIdx) : winnerIdx;
    trickLeader = w; currentTurn = w;
    return false;
  }
  function checkEnd() {
    const active = players.filter(p => !p.finished);
    if (active.length <= 1) {
      const last = players.find(p => !p.finished);
      if (last) { last.finished = true; finishOrder.push(players.indexOf(last)); }
      return true;
    }
    return false;
  }

  let maxIter = 10000;
  while (!checkEnd() && maxIter-- > 0) {
    const pidx = currentTurn;
    const player = players[pidx];
    const opp  = players[1 - pidx];
    const oppHandSize = opp && !opp.finished ? opp.hand.length : 0;
    const play = aiChoosePlay(player.hand, pile, player.style, oppHandSize);

    if (play) {
      play.forEach(c => {
        const i = player.hand.findIndex(h => h.suit===c.suit && h.value===c.value);
        if (i !== -1) player.hand.splice(i, 1);
      });
      pile = play; trickLeader = pidx; trickTurns++;
      if (player.hand.length === 0) { player.finished = true; finishOrder.push(pidx); }
      if (isTrump(play[0])) {
        if (checkEnd()) break;
        if (endTrick(pidx)) break;
        continue;
      }
      if (checkEnd()) break;
      if (trickTurns >= trickPlayerCount) { if (endTrick(trickLeader)) break; continue; }
      currentTurn = nextActive(pidx);
      if (players[trickLeader].finished) trickLeader = currentTurn;
    } else {
      trickTurns++;
      if (trickTurns >= trickPlayerCount) { if (endTrick(trickLeader)) break; continue; }
      currentTurn = nextActive(pidx);
    }
  }
  return finishOrder;
}

// ── Card trading (2-player: 2-card swap) ──────────────────────────────────────
function doTrading(players, presIdx) {
  const wIdx = 1 - presIdx;
  const sorted = [...players[wIdx].hand].sort((a,b) => b.rank-a.rank);
  const taken = sorted.slice(0, 2);
  taken.forEach(c => {
    const i = players[wIdx].hand.findIndex(h => h.suit===c.suit && h.value===c.value);
    if (i !== -1) players[wIdx].hand.splice(i, 1);
    players[presIdx].hand.push(c);
  });
  players[presIdx].hand = sortHand(players[presIdx].hand);
  const recvKeys = new Set(taken.map(c => c.suit+c.value));
  const pool = players[presIdx].hand.filter(c => !recvKeys.has(c.suit+c.value));
  const give = (pool.length >= 2 ? pool : players[presIdx].hand).sort((a,b) => a.rank-b.rank).slice(0, 2);
  give.forEach(c => {
    const i = players[presIdx].hand.findIndex(h => h.suit===c.suit && h.value===c.value);
    if (i !== -1) players[presIdx].hand.splice(i, 1);
    players[wIdx].hand.push(c);
  });
  players[wIdx].hand = sortHand(players[wIdx].hand);
}

// ── Run simulation ─────────────────────────────────────────────────────────────
function runSim(styleA, styleB, withHoldHand, games = 100, rounds = 10) {
  const acc = {
    roundWins: [0, 0],
    gameWins:  [0, 0],
    gameTies:  0,
    // president tracking
    presRetain: 0,
    presOpp:    0,
    // hold hand tracking (by role)
    presSwaps: 0,  presSwapOpp: 0,  presSwapHandScore: 0,  presHoldScore: 0,
    wiperSwaps: 0, wiperSwapOpp: 0, wiperSwapHandScore: 0, wiperHoldScore: 0,
    // card advantage tracking
    presTradeBenefit: 0,  // net rank gain for President per trade
    wiperTradeLoss:   0,  // net rank loss for Wiper per trade
    tradeCount:       0,
  };

  for (let g = 0; g < games; g++) {
    const players = [
      { style: styleA, hand: [], finished: false },
      { style: styleB, hand: [], finished: false },
    ];
    let presIdx = -1;
    const gameWins = [0, 0];

    for (let r = 0; r < rounds; r++) {
      // ── Deal ──
      let holdHand = [];
      if (withHoldHand) {
        const deck = shuffle(buildDeck());
        const slots = [[], [], []];
        deck.forEach((c, i) => slots[i % 3].push(c));
        holdHand = slots[0];          // 18 cards
        players[0].hand = sortHand(slots[1]);  // 17 cards
        players[1].hand = sortHand(slots[2]);  // 17 cards
      } else {
        const deck = shuffle(buildDeck());
        players[0].hand = sortHand(deck.slice(0, 26));
        players[1].hand = sortHand(deck.slice(26));
      }
      players.forEach(p => p.finished = false);

      // ── Hold hand exchange (round 2+, when a President is known) ──
      if (withHoldHand && r > 0 && presIdx >= 0) {
        const wIdx = 1 - presIdx;
        // President decides first
        const presScore  = handScore(players[presIdx].hand);
        const holdScore1 = handScore(holdHand);
        acc.presSwapOpp++;
        acc.presSwapHandScore += presScore;
        acc.presHoldScore     += holdScore1;
        if (holdScore1 > presScore) {
          acc.presSwaps++;
          const tmp = players[presIdx].hand;
          players[presIdx].hand = sortHand(holdHand);
          holdHand = tmp;
        }
        // Wiper decides second
        const wiperScore = handScore(players[wIdx].hand);
        const holdScore2 = handScore(holdHand);
        acc.wiperSwapOpp++;
        acc.wiperSwapHandScore += wiperScore;
        acc.wiperHoldScore     += holdScore2;
        if (holdScore2 > wiperScore) {
          acc.wiperSwaps++;
          const tmp = players[wIdx].hand;
          players[wIdx].hand = sortHand(holdHand);
          holdHand = tmp;
        }
      }

      // ── Card trading (round 2+) ──
      if (r > 0 && presIdx >= 0) {
        const wIdx = 1 - presIdx;
        const presBefore  = handScore(players[presIdx].hand);
        const wiperBefore = handScore(players[wIdx].hand);
        doTrading(players, presIdx);
        acc.presTradeBenefit += handScore(players[presIdx].hand) - presBefore;
        acc.wiperTradeLoss   += wiperBefore - handScore(players[wIdx].hand);
        acc.tradeCount++;
      }

      // ── Play ──
      players.forEach(p => p.finished = false);
      const finishOrder = simulateRound(players);
      const winner = finishOrder[0];
      acc.roundWins[winner]++;
      gameWins[winner]++;

      // President retention
      if (presIdx >= 0) {
        acc.presOpp++;
        if (winner === presIdx) acc.presRetain++;
      }
      presIdx = winner;
    }

    if      (gameWins[0] > gameWins[1]) acc.gameWins[0]++;
    else if (gameWins[1] > gameWins[0]) acc.gameWins[1]++;
    else                                 acc.gameTies++;
  }

  return acc;
}

// ── Report ─────────────────────────────────────────────────────────────────────
const GAMES  = 100;
const ROUNDS = 10;
const PAIRS = [
  ['conservative', 'conservative'],
  ['conservative', 'neutral'],
  ['conservative', 'aggressive'],
  ['neutral', 'neutral'],
  ['neutral', 'aggressive'],
  ['aggressive', 'aggressive'],
];

const W = 70;
const line = '═'.repeat(W);
console.log(`\n╔${line}╗`);
console.log(`║  2-Player President — AI Simulation Results${' '.repeat(W-43)}║`);
console.log(`║  ${GAMES} games × ${ROUNDS} rounds · one-time-around · card trading${' '.repeat(W - (3 + `${GAMES} games × ${ROUNDS} rounds · one-time-around · card trading`.length))}║`);
console.log(`╚${line}╝\n`);

// Collect aggregate data for summary
const styleTotals = {};
['conservative','neutral','aggressive'].forEach(s => {
  styleTotals[s] = { rw_no: 0, rr_no: 0, rw_hold: 0, rr_hold: 0 };
});

for (const [sA, sB] of PAIRS) {
  const no   = runSim(sA, sB, false, GAMES, ROUNDS);
  const hold = runSim(sA, sB, true,  GAMES, ROUNDS);

  const totalR = GAMES * ROUNDS;
  const pA_no   = (no.roundWins[0]   / totalR * 100).toFixed(1);
  const pB_no   = (no.roundWins[1]   / totalR * 100).toFixed(1);
  const pA_hold = (hold.roundWins[0] / totalR * 100).toFixed(1);
  const pB_hold = (hold.roundWins[1] / totalR * 100).toFixed(1);
  const ret_no   = no.presOpp   ? (no.presRetain   / no.presOpp   * 100).toFixed(1) : '—';
  const ret_hold = hold.presOpp ? (hold.presRetain / hold.presOpp * 100).toFixed(1) : '—';

  const label = sA === sB ? `${sA} vs ${sB}` : `${sA} vs ${sB}`;
  console.log(`┌─ ${label.toUpperCase()} ${'─'.repeat(Math.max(0, W - label.length - 4))}┐`);

  console.log(`│  WITHOUT hold hand:`);
  console.log(`│    Round win%  — P0(${sA.slice(0,4)}): ${String(no.roundWins[0]).padStart(4)}/${totalR} = ${pA_no}%    P1(${sB.slice(0,4)}): ${String(no.roundWins[1]).padStart(4)}/${totalR} = ${pB_no}%`);
  console.log(`│    Game wins   — P0: ${no.gameWins[0]}   P1: ${no.gameWins[1]}   Ties: ${no.gameTies}`);
  console.log(`│    President retains next round: ${ret_no}%`);
  if (no.tradeCount > 0) {
    const tb = (no.presTradeBenefit / no.tradeCount).toFixed(2);
    const tl = (no.wiperTradeLoss   / no.tradeCount).toFixed(2);
    console.log(`│    Avg trade benefit — President: +${tb} rank pts/trade   Wiper: −${tl} rank pts/trade`);
  }

  console.log(`│  WITH hold hand (17 cards each + 18-card hold):`);
  console.log(`│    Round win%  — P0(${sA.slice(0,4)}): ${String(hold.roundWins[0]).padStart(4)}/${totalR} = ${pA_hold}%    P1(${sB.slice(0,4)}): ${String(hold.roundWins[1]).padStart(4)}/${totalR} = ${pB_hold}%`);
  console.log(`│    Game wins   — P0: ${hold.gameWins[0]}   P1: ${hold.gameWins[1]}   Ties: ${hold.gameTies}`);
  console.log(`│    President retains next round: ${ret_hold}%`);
  if (hold.tradeCount > 0) {
    const tb = (hold.presTradeBenefit / hold.tradeCount).toFixed(2);
    const tl = (hold.wiperTradeLoss   / hold.tradeCount).toFixed(2);
    console.log(`│    Avg trade benefit — President: +${tb} rank pts/trade   Wiper: −${tl} rank pts/trade`);
  }
  const pSwapRate = hold.presSwapOpp  ? (hold.presSwaps  / hold.presSwapOpp  * 100).toFixed(1) : '—';
  const wSwapRate = hold.wiperSwapOpp ? (hold.wiperSwaps / hold.wiperSwapOpp * 100).toFixed(1) : '—';
  const avgPresHand  = hold.presSwapOpp  ? (hold.presSwapHandScore  / hold.presSwapOpp).toFixed(1)  : '—';
  const avgPresHold1 = hold.presSwapOpp  ? (hold.presHoldScore      / hold.presSwapOpp).toFixed(1)  : '—';
  const avgWiperHand = hold.wiperSwapOpp ? (hold.wiperSwapHandScore / hold.wiperSwapOpp).toFixed(1) : '—';
  const avgWiperHold = hold.wiperSwapOpp ? (hold.wiperHoldScore     / hold.wiperSwapOpp).toFixed(1) : '—';
  console.log(`│    Hold swap rate — President: ${pSwapRate}%  (avg hand ${avgPresHand} vs hold ${avgPresHold1})`);
  console.log(`│    Hold swap rate — Wiper:     ${wSwapRate}%  (avg hand ${avgWiperHand} vs hold ${avgWiperHold})`);

  console.log(`└${'─'.repeat(W)}┘\n`);

  // Accumulate for summary
  [[sA, 0, no, hold], [sB, 1, no, hold]].forEach(([s, idx, n, h]) => {
    styleTotals[s].rw_no   += n.roundWins[idx];
    styleTotals[s].rr_no   += totalR;
    styleTotals[s].rw_hold += h.roundWins[idx];
    styleTotals[s].rr_hold += totalR;
  });
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`╔${line}╗`);
console.log(`║  OVERALL WIN RATES BY STYLE (pooled across all matchups)${' '.repeat(W-56)}║`);
console.log(`╚${line}╝`);
console.log(`\n  ${'Style'.padEnd(15)} ${'No hold hand'.padEnd(18)} ${'With hold hand'.padEnd(18)}`);
console.log(`  ${'─'.repeat(53)}`);
for (const [s, t] of Object.entries(styleTotals)) {
  const wno   = t.rr_no   ? (t.rw_no   / t.rr_no   * 100).toFixed(1) : '—';
  const whold = t.rr_hold ? (t.rw_hold / t.rr_hold * 100).toFixed(1) : '—';
  console.log(`  ${s.padEnd(15)} ${(wno + '%').padEnd(18)} ${(whold + '%').padEnd(18)}`);
}

console.log(`\n  Note: 50% = expected in symmetric matchups (same style vs same style).`);
console.log(`  Deviations in asymmetric matchups reflect style advantages.\n`);
