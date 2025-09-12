// Typy kart
export enum Suit {
  HEARTS = '♥️',
  DIAMONDS = '♦️',
  CLUBS = '♣️',
  SPADES = '♠️'
}

export enum Rank {
  TWO = '2',
  THREE = '3',
  FOUR = '4',
  FIVE = '5',
  SIX = '6',
  SEVEN = '7',
  EIGHT = '8',
  NINE = '9',
  TEN = '10',
  JACK = 'J',
  QUEEN = 'Q',
  KING = 'K',
  ACE = 'A'
}

export interface Card {
  suit: Suit;
  rank: Rank;
}

// Status gry
export enum GameStatus {
  // BETTING = 'BETTING', // 🚫 LEGACY: Betting phase - nie używane w pokerze
  PLAYER_TURN = 'PLAYER_TURN',
  DEALER_TURN = 'DEALER_TURN',
  ROUND_OVER = 'ROUND_OVER'
}

// Interfejs reprezentujący rękę (gracza lub krupiera)
export interface Hand {
  cards: Card[];
  value: number;
}

// Stan gry
export interface GameState {
  status: GameStatus;
  playerHand: Hand;
  dealerHand: Hand;
  balance: number;
  currentBet: number;
  message: string;
}

// Akcje gracza
export type PlayerAction = 'fold' | 'check';
