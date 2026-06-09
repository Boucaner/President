const SUITS = ['♠','♥','♦','♣'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
// index in VALUES = card rank (0=lowest 3, 12=highest 2)

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const val of VALUES) {
      deck.push({ suit, value: val, rank: VALUES.indexOf(val) });
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardColor(card) {
  return (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
}

function isTrump(card) {
  return card.value === '2';
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

// Returns true if `cards` is a legal play on top of `pile`
// pile: array of cards last played (empty = trick opener)
// cards: proposed play
function isLegalPlay(cards, pile) {
  if (!cards || cards.length === 0) return false;

  const allSameValue = cards.every(c => c.value === cards[0].value);
  if (!allSameValue) return false;

  // Any play made entirely of 2s is trump — ends trick immediately, can't be beaten
  if (isTrump(cards[0])) {
    if (cards.length === 1) return true;   // single 2 beats anything
    if (pile.length === 0) return true;    // multiple 2s can open a trick
    return cards.length === pile.length;   // multiple 2s must match pile count
  }

  if (pile.length === 0) return true;
  if (cards.length !== pile.length) return false;
  if (cards[0].rank <= pile[0].rank) return false;

  return true;
}
