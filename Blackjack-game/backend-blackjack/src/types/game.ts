export enum GameState {
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS',
  BETTING = 'BETTING',
  DEALING_INITIAL_CARDS = 'DEALING_INITIAL_CARDS',
  PLAYER_TURN = 'PLAYER_TURN',
  DEALER_TURN = 'DEALER_TURN',
  ROUND_ENDED = 'ROUND_ENDED'
}

export enum PlayerMove {
  HIT = 'HIT',
  STAND = 'STAND',
  DOUBLE = 'DOUBLE',
  SPLIT = 'SPLIT'
}

export interface Card {
  suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';
  rank: 'ACE' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'JACK' | 'QUEEN' | 'KING';
  isFaceUp: boolean;
}

export interface Player {
  id: string;
  hand: Card[];
  bet: number;
  balance: number;
  isDealer: boolean;
  moveTimeoutId?: NodeJS.Timeout; // ID timera dla ruchu gracza
  betTimeoutId?: NodeJS.Timeout;  // ID timera dla zakładu
}

export interface GameSession {
  id: string;
  state: GameState;
  players: Player[];
  currentPlayerIndex: number;
  deck: Card[];
  lastMoveTime?: number;      // Timestamp ostatniego ruchu
  currentTurnStartTime?: number; // Timestamp rozpoczęcia aktualnej tury
}
