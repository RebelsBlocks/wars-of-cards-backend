import type { Card } from '../types/game';

// Poker hand rankings (wyższe = lepsze)
export enum PokerHandRank {
  HIGH_CARD = 1,
  PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10
}

// Na razie tylko placeholder dla UI
export function evaluatePokerHandForDisplay(_cards: Card[]): PokerHandRank {
  // TODO: implement later for UI
  return PokerHandRank.HIGH_CARD;
}

export function getPokerHandName(rank: PokerHandRank): string {
  // Helper dla wyświetlania nazw rąk w UI
  switch (rank) {
    case PokerHandRank.HIGH_CARD:
      return 'High Card';
    case PokerHandRank.PAIR:
      return 'Pair';
    case PokerHandRank.TWO_PAIR:
      return 'Two Pair';
    case PokerHandRank.THREE_OF_A_KIND:
      return 'Three of a Kind';
    case PokerHandRank.STRAIGHT:
      return 'Straight';
    case PokerHandRank.FLUSH:
      return 'Flush';
    case PokerHandRank.FULL_HOUSE:
      return 'Full House';
    case PokerHandRank.FOUR_OF_A_KIND:
      return 'Four of a Kind';
    case PokerHandRank.STRAIGHT_FLUSH:
      return 'Straight Flush';
    case PokerHandRank.ROYAL_FLUSH:
      return 'Royal Flush';
    default:
      return 'Unknown';
  }
}
