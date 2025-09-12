import type { Card, Hand, HandResult } from '../types/game';

/**
 * Oblicza wartość pojedynczej karty
 */
export function getCardValue(card: Card): number {
  if (card.rank === 'ACE') return 11; // As początkowo ma wartość 11
  if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

/**
 * Oblicza wartość ręki uwzględniając asy
 */
export function getHandValue(hand: Hand): number {
  let value = 0;
  let aces = 0;

  // Zlicz wartość wszystkich kart i liczbę asów
  for (const card of hand.cards) {
    if (card.rank === 'ACE') {
      aces++;
      value += 11;
    } else if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Przelicz asy z 11 na 1 jeśli wartość przekracza 21
  while (value > 21 && aces > 0) {
    value -= 10; // Zmiana asa z 11 na 1
    aces--;
  }

  return value;
}


/**
 * Sprawdza czy można podwoić stawkę (dwie karty + wystarczające środki)
 */
export function canDouble(hand: Hand, balance: number, currentBet: number): boolean {
  return hand.cards.length === 2 && balance >= currentBet;
}


/**
 * Zwraca nazwę karty dla wyświetlenia
 */
export function getCardDisplayName(card: Card): string {
  const suitSymbols = {
    HEARTS: '♥️',
    DIAMONDS: '♦️',
    CLUBS: '♣️',
    SPADES: '♠️'
  };
  
  const rankNames = {
    ACE: 'A',
    JACK: 'J',
    QUEEN: 'Q',
    KING: 'K'
  };
  
  const rank = rankNames[card.rank as keyof typeof rankNames] || card.rank;
  const suit = suitSymbols[card.suit];
  
  return `${rank}${suit}`;
}

/**
 * Returns display text for hand result
 */
export function getHandResultText(result: HandResult | undefined): string | null {
  if (!result) return null;
  
  switch (result) {
    case 'WIN':
      return 'WIN';
    case 'PUSH':
      return 'PUSH';
    case 'LOSE':
      return 'LOSE';
    default:
      return null;
  }
}

/**
 * Returns CSS class for hand result styling
 */
export function getHandResultClass(result: HandResult | undefined): string {
  if (!result) return '';
  
  switch (result) {
    case 'WIN':
      return 'result-win';
    case 'PUSH':
      return 'result-push';
    case 'LOSE':
      return 'result-lose';
    default:
      return '';
  }
}

// ✅ POKER HAND EVALUATION FUNCTIONS

export function evaluatePokerHand(cards: Card[]): string {
  if (cards.length < 2) return 'High Card';
  
  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);
  
  // Policz wystąpienia każdego ranku
  const rankCounts: Record<string, number> = {};
  ranks.forEach(rank => {
    rankCounts[rank] = (rankCounts[rank] || 0) + 1;
  });
  
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  
  // Sprawdź układy (od najwyższego)
  if (counts[0] === 4) return 'Four of a Kind';
  if (counts[0] === 3 && counts[1] === 2) return 'Full House';
  if (counts[0] === 3) return 'Three of a Kind';
  if (counts[0] === 2 && counts[1] === 2) return 'Two Pair';
  if (counts[0] === 2) return 'Pair';
  
  return 'High Card';
}

export function getHandRankValue(handRank: string): number {
  const rankings = {
    'High Card': 1,
    'Pair': 2,
    'Two Pair': 3,
    'Three of a Kind': 4,
    'Straight': 5,
    'Flush': 6,
    'Full House': 7,
    'Four of a Kind': 8,
    'Straight Flush': 9,
    'Royal Flush': 10
  };
  return rankings[handRank as keyof typeof rankings] || 1;
}

export function evaluatePokerHandWithCommunity(playerCards: Card[], communityCards: Card[]): string {
  const allCards = [...playerCards, ...communityCards];
  return evaluatePokerHand(allCards);
}
