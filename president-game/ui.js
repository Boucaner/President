// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const elHand       = $('hand');
const elPile       = $('pile');
const elRoundInfo  = $('round-info');
const elPlayerName = $('player-name');
const elPlayerRole = $('player-role');
const elBtnPlay    = $('btn-play');
const elBtnPass    = $('btn-pass');
const elModalStart = $('modal-start');
const elModalSettings = $('modal-settings');

// Seats in clockwise order from the human's left, indexed by number of AI players
const SEAT_LAYOUTS = [
  null,
  ['seat-top-center'],
  ['seat-top-left','seat-top-right'],
  ['seat-mid-left','seat-top-center','seat-mid-right'],
  ['seat-mid-left','seat-top-left','seat-top-right','seat-mid-right'],
  ['seat-mid-left','seat-top-left','seat-top-center','seat-top-right','seat-mid-right'],
  ['seat-bot-left','seat-mid-left','seat-top-left','seat-top-center','seat-top-right','seat-mid-right'],
];
const ALL_SEAT_IDS = ['seat-top-left','seat-top-center','seat-top-right','seat-mid-right','seat-bot-left','seat-mid-left'];

let selectedCards = [];
let tradeSelectedCards = [];
let aiDelay = 800; // ms between AI moves

const ROLE_KEYS = ['President', 'Vice President', 'Neutral', 'Vice Asshole', 'Asshole'];
const ROLE_IDS  = ['president', 'vp', 'neutral', 'va', 'asshole'];

function displayRoleName(role) {
  if (!role) return '';
  return state.settings.roleNames[role] || role;
}

function renderGameName() {
  const name = state.settings.gameName || 'President';
  $('game-title').textContent = name;
  document.title = name;
  const startTitle = $('start-title');
  if (startTitle) startTitle.textContent = name;
}

console.log('%c[President] ui.js loaded — build 17', 'color:lime;font-weight:bold');

// ── Boot ──────────────────────────────────────────────────────────────────────

$('btn-start').addEventListener('click', () => {
  const settings = {
    numPlayers:     parseInt($('start-players').value),
    oneTimeAround:  $('start-one-time-around').checked,
    cardTrading:    $('start-card-trading').checked,
    autoPass:       $('start-auto-pass').checked,
  };
  elModalStart.classList.add('hidden');
  initGame(settings);
  render();
  scheduleAiIfNeeded();
});

$('btn-new-game').addEventListener('click', () => {
  // Pre-fill start modal with current settings so they persist across games
  $('start-players').value          = state.settings.numPlayers;
  $('start-one-time-around').checked = state.settings.oneTimeAround;
  $('start-card-trading').checked    = state.settings.cardTrading;
  $('start-auto-pass').checked       = state.settings.autoPass;
  elModalStart.classList.remove('hidden');
});

$('btn-settings').addEventListener('click', () => {
  $('setting-game-name').value         = state.settings.gameName || 'President';
  $('setting-players').value           = state.settings.numPlayers;
  $('setting-one-time-around').checked = state.settings.oneTimeAround;
  $('setting-card-trading').checked    = state.settings.cardTrading;
  $('setting-auto-pass').checked       = state.settings.autoPass;
  for (let i = 1; i <= 6; i++) {
    $(`ai-name-${i}`).value = state.settings.aiNames[i - 1] || '';
  }
  ROLE_KEYS.forEach((key, i) => {
    $('role-name-' + ROLE_IDS[i]).value = state.settings.roleNames[key] || key;
  });
  syncCardBackPickers();
  elModalSettings.classList.remove('hidden');
});
$('btn-settings-close').addEventListener('click', () => {
  state.settings.gameName      = $('setting-game-name').value.trim() || 'President';
  state.settings.numPlayers    = parseInt($('setting-players').value);
  state.settings.oneTimeAround = $('setting-one-time-around').checked;
  state.settings.cardTrading   = $('setting-card-trading').checked;
  state.settings.autoPass      = $('setting-auto-pass').checked;
  for (let i = 1; i <= 6; i++) {
    const val = $(`ai-name-${i}`).value.trim();
    state.settings.aiNames[i - 1] = val || DEFAULT_AI_NAMES[i - 1];
  }
  ROLE_KEYS.forEach((key, i) => {
    const val = $('role-name-' + ROLE_IDS[i]).value.trim();
    state.settings.roleNames[key] = val || key;
  });
  localStorage.setItem('presidentAiNames', JSON.stringify(state.settings.aiNames));
  localStorage.setItem('presidentGameName', state.settings.gameName);
  localStorage.setItem('presidentRoleNames', JSON.stringify(state.settings.roleNames));
  elModalSettings.classList.add('hidden');
  renderGameName();
  render();
});

elBtnPlay.addEventListener('click', () => {
  if (selectedCards.length === 0) return;
  const result = humanPlay(selectedCards);
  if (!result.ok) {
    showToast(result.msg || 'Invalid play');
    return;
  }
  selectedCards = [];
  render();
  if (state.phase === 'roundEnd') { showRoundEnd(); return; }
  scheduleAiIfNeeded();
});

elBtnPass.addEventListener('click', () => {
  const result = humanPass();
  if (!result.ok) return;
  selectedCards = [];
  render();
  if (state.phase === 'roundEnd') { showRoundEnd(); return; }
  scheduleAiIfNeeded();
});

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderSeats();
  renderPile();
  renderHand();
  renderActionBar();
  renderPlayerInfo();
}

function renderSeats() {
  const n = state.players.length;
  const hIdx = state.players.findIndex(p => p.isHuman);
  const numAI = n - 1;
  const layout = SEAT_LAYOUTS[numAI] || [];

  // Clear every seat
  ALL_SEAT_IDS.forEach(id => {
    const el = $(id);
    el.innerHTML = '';
    el.classList.remove('active');
  });

  // Map clockwise order from human's left to layout seats
  for (let i = 0; i < numAI; i++) {
    const playerIdx = (hIdx + 1 + i) % n;
    const player = state.players[playerIdx];
    const seatId = layout[i];
    if (!seatId) continue;

    const el = $(seatId);
    const isActive = state.currentTurn === playerIdx && state.phase === 'playing';
    if (isActive) el.classList.add('active');

    const inner = document.createElement('div');
    inner.className = 'seat-inner';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
    if (state.pile.length > 0 && state.trickLeader === playerIdx) {
      const starEl = document.createElement('span');
      starEl.className = 'trick-leader-star';
      starEl.textContent = '★';
      nameRow.appendChild(starEl);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';
    nameEl.textContent = player.name;
    nameRow.appendChild(nameEl);
    inner.appendChild(nameRow);

    if (player.style) {
      const styleEl = document.createElement('div');
      styleEl.className = 'seat-style seat-style-' + player.style;
      styleEl.textContent = player.style;
      inner.appendChild(styleEl);
    }

    if (player.role) {
      const roleEl = document.createElement('div');
      roleEl.className = 'seat-role role-badge ' + roleClass(player.role);
      roleEl.textContent = displayRoleName(player.role);
      inner.appendChild(roleEl);
    }

    const cardCount = player.hand.length;
    if (cardCount > 0) {
      const cardsEl = document.createElement('div');
      cardsEl.className = 'seat-cards';
      const shown = Math.min(cardCount, 4);
      for (let j = 0; j < shown; j++) {
        const back = document.createElement('div');
        back.className = `card-back card-back--${state.settings.cardBack || 'blue'}`;
        if (j === 0) {
          back.classList.add('count-badge');
          back.dataset.count = cardCount;
        }
        cardsEl.appendChild(back);
      }
      inner.appendChild(cardsEl);
    } else if (player.finished) {
      const done = document.createElement('div');
      done.style.cssText = 'font-size:.7rem;color:#4ade80;letter-spacing:1px';
      done.textContent = '✓ Done';
      inner.appendChild(done);
    }

    el.appendChild(inner);
  }
}

function renderPile() {
  elPile.innerHTML = '';

  if (state.pile.length > 0) {
    state.pile.forEach(card => {
      elPile.appendChild(buildCardEl(card, false));
    });
  } else if (state.lastPlay) {
    // Show last played cards dimmed so a 2 played by AI is still visible
    state.lastPlay.cards.forEach(card => {
      const el = buildCardEl(card, false);
      el.classList.add('last-play');
      elPile.appendChild(el);
    });
  }

  const isHumanTurn = state.phase === 'playing' && state.players[state.currentTurn]?.isHuman;
  if (state.pile.length === 0) {
    if (isHumanTurn) {
      elRoundInfo.textContent = 'Your lead — play any cards';
    } else if (state.phase === 'playing') {
      const leader = state.players[state.currentTurn];
      elRoundInfo.textContent = leader ? `${leader.name}'s lead` : '';
    } else {
      elRoundInfo.textContent = '';
    }
  } else {
    const count = state.pile.length;
    const val = state.pile[0].value;
    const label = count === 1 ? val : `${count}× ${val}`;
    const human = state.players.find(p => p.isHuman);
    const hasTrump = isHumanTurn && human?.hand.some(c => isTrump(c));
    elRoundInfo.textContent = isHumanTurn
      ? `Beat ${label} — play ${count === 1 ? 'higher' : count + ' of a kind, higher'}${hasTrump ? ' — or play a single 2' : ''}`
      : `On table: ${label}`;
  }
}


function renderHand() {
  elHand.innerHTML = '';
  const human = state.players.find(p => p.isHuman);
  if (!human) return;

  human.hand.forEach(card => {
    const el = buildCardEl(card, true);
    const sel = selectedCards.some(c => c.suit === card.suit && c.value === card.value);
    if (sel) el.classList.add('selected');

    el.addEventListener('click', () => toggleSelect(card, el));
    elHand.appendChild(el);
  });
}

function renderActionBar() {
  const isMyTurn = state.phase === 'playing' && state.players[state.currentTurn]?.isHuman;
  elBtnPass.disabled = !isMyTurn;

  // Play is enabled when selected cards form a legal play
  const canPlay = isMyTurn && selectedCards.length > 0 && isLegalPlay(selectedCards, state.pile);
  elBtnPlay.disabled = !canPlay;
}

function renderPlayerInfo() {
  const human = state.players.find(p => p.isHuman);
  if (!human) return;
  elPlayerName.textContent = 'You';
  elPlayerRole.textContent = displayRoleName(human.role);
  elPlayerRole.className = 'role-badge ' + roleClass(human.role);
  const hIdx = state.players.indexOf(human);
  $('player-trick-star').textContent = (state.pile.length > 0 && state.trickLeader === hIdx) ? '★' : '';
}

// ── Card element builder ──────────────────────────────────────────────────────

function buildCardEl(card, interactive) {
  const el = document.createElement('div');
  el.className = `card ${cardColor(card)}${isTrump(card) ? ' trump' : ''}`;
  if (!interactive) el.style.cursor = 'default';

  const top = document.createElement('div');
  top.className = 'card-value';
  top.textContent = card.value;

  const suit = document.createElement('div');
  suit.className = 'card-suit';
  suit.textContent = card.suit;

  const bot = document.createElement('div');
  bot.className = 'card-value-bottom';
  bot.textContent = card.value;

  el.appendChild(top);
  el.appendChild(suit);
  el.appendChild(bot);
  return el;
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleSelect(card, el) {
  if (!state.players[state.currentTurn]?.isHuman) return;
  const idx = selectedCards.findIndex(c => c.suit === card.suit && c.value === card.value);
  if (idx === -1) {
    selectedCards.push(card);
    el.classList.add('selected');
  } else {
    selectedCards.splice(idx, 1);
    el.classList.remove('selected');
  }
  renderActionBar();
}

// ── AI scheduling ─────────────────────────────────────────────────────────────

function scheduleAiIfNeeded() {
  if (state.phase !== 'playing') return;
  const cur = state.players[state.currentTurn];
  if (!cur) return;

  if (cur.isHuman) {
    if (state.settings.autoPass && state.pile.length > 0 && !hasLegalPlay(cur.hand, state.pile)) {
      $('auto-pass-msg').classList.remove('hidden');
      setTimeout(() => {
        $('auto-pass-msg').classList.add('hidden');
        const result = humanPass();
        if (!result.ok) return;
        selectedCards = [];
        render();
        if (state.phase === 'roundEnd') { showRoundEnd(); return; }
        scheduleAiIfNeeded();
      }, 1800);
    }
    return;
  }

  setTimeout(() => {
    if (state.phase !== 'playing') return;
    if (state.players[state.currentTurn]?.isHuman) return;
    const idx = state.currentTurn;
    aiTakeTurn(idx);
    render();
    if (state.phase === 'roundEnd') { showRoundEnd(); return; }
    scheduleAiIfNeeded();
  }, aiDelay);
}

// ── Round end ─────────────────────────────────────────────────────────────────

function showRoundEnd() {
  const lines = state.finishOrder.map((playerIdx, i) => {
    const pos = i + 1;
    const p = state.players[playerIdx];
    return `${pos}${ordinal(pos)}  ${p.name} — ${displayRoleName(p.role)}`;
  });
  showToast('Round over! ' + state.players[state.finishOrder[0]].name + ' wins!');

  setTimeout(() => {
    if (confirm('Round complete!\n\n' + lines.join('\n') + '\n\nDeal next round?')) {
      dealRound();
      render();
      if (state.phase === 'trading') {
        showTradingModal();
      } else {
        scheduleAiIfNeeded();
      }
    }
  }, 400);
}

function showTradingModal() {
  const t = state.trading;
  const human = state.players.find(p => p.isHuman);
  const role = human.role;

  // Neutral players skip the modal entirely
  if (role !== 'President' && role !== 'Vice President' && role !== 'Asshole' && role !== 'Vice Asshole') {
    state.phase = 'playing';
    render();
    scheduleAiIfNeeded();
    return;
  }

  let title = 'Card Trading';
  let desc  = '';

  if (role === 'President') {
    title = `Card Trading — You are ${displayRoleName('President')}`;
    desc  = `You received ${t.tradeCount} card${t.tradeCount > 1 ? 's' : ''} from the ${displayRoleName('Asshole')}. Select ${t.tradeCount} to give back.`;
  } else if (role === 'Vice President') {
    title = `Card Trading — You are ${displayRoleName('Vice President')}`;
    desc  = `You received 1 card from the ${displayRoleName('Vice Asshole')}. Select 1 card to give back.`;
  } else if (role === 'Asshole') {
    title = `Card Trading — You are the ${displayRoleName('Asshole')}`;
    desc  = `Your ${t.tradeCount} best card${t.tradeCount > 1 ? 's were' : ' was'} given to the ${displayRoleName('President')}. You received:`;
  } else {
    title = `Card Trading — You are ${displayRoleName('Vice Asshole')}`;
    desc  = `Your best card was given to the ${displayRoleName('Vice President')}. You received:`;
  }

  $('trading-title').textContent = title;
  $('trading-desc').textContent  = desc;

  // Received cards section
  const recEl = $('trading-received-cards');
  recEl.innerHTML = '';
  if (t.humanReceived.length > 0) {
    t.humanReceived.forEach(c => recEl.appendChild(buildCardEl(c, false)));
    $('trading-received-section').style.display = '';
  } else {
    $('trading-received-section').style.display = 'none';
  }

  // Give-back section
  tradeSelectedCards = [];
  const giveEl = $('trading-give-cards');
  giveEl.innerHTML = '';

  if (t.humanNeedsToGive) {
    $('trading-give-section').style.display = '';
    $('trading-give-label').textContent = `Select ${t.humanGiveCount} card${t.humanGiveCount > 1 ? 's' : ''} to give to ${t.humanGiveToName}:`;

    human.hand.forEach(card => {
      const el = buildCardEl(card, true);
      el.addEventListener('click', () => {
        const idx = tradeSelectedCards.findIndex(c => c.suit === card.suit && c.value === card.value);
        if (idx === -1) {
          if (tradeSelectedCards.length < t.humanGiveCount) {
            tradeSelectedCards.push(card);
            el.classList.add('selected');
          }
        } else {
          tradeSelectedCards.splice(idx, 1);
          el.classList.remove('selected');
        }
        $('btn-trading-confirm').disabled = tradeSelectedCards.length !== t.humanGiveCount;
      });
      giveEl.appendChild(el);
    });

    $('btn-trading-confirm').textContent = 'Confirm Trade';
    $('btn-trading-confirm').disabled    = true;
    $('btn-trading-confirm').onclick = () => {
      if (humanCompleteTrading(tradeSelectedCards)) {
        tradeSelectedCards = [];
        $('modal-trading').classList.add('hidden');
        render();
        scheduleAiIfNeeded();
      }
    };
  } else {
    $('trading-give-section').style.display = 'none';
    $('btn-trading-confirm').textContent = 'Continue';
    $('btn-trading-confirm').disabled    = false;
    $('btn-trading-confirm').onclick = () => {
      $('modal-trading').classList.add('hidden');
      state.phase = 'playing';
      render();
      scheduleAiIfNeeded();
    };
  }

  $('modal-trading').classList.remove('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncCardBackPickers() {
  const val = state.settings.cardBack || 'blue';
  document.querySelectorAll('.cb-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.value === val);
  });
}

function setupCardBackPicker(pickerId) {
  const picker = $(pickerId);
  if (!picker) return;
  picker.querySelectorAll('.cb-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      state.settings.cardBack = swatch.dataset.value;
      localStorage.setItem('presidentCardBack', swatch.dataset.value);
      syncCardBackPickers();
      render();
    });
  });
}

setupCardBackPicker('cb-picker-settings');
setupCardBackPicker('cb-picker-start');
syncCardBackPickers();

renderGameName();

function roleClass(role) {
  if (!role) return 'role-neutral';
  return ({
    'President':       'role-president',
    'Vice President':  'role-vp',
    'Neutral':         'role-neutral',
    'Vice Asshole':    'role-va',
    'Asshole':         'role-asshole',
  })[role] || 'role-neutral';
}

function ordinal(n) {
  return ['','st','nd','rd'][n] || 'th';
}

let toastTimer;
function showToast(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
