// Typy importowane z backend'u - utrzymujemy zgodność
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

export enum PlayerState {
  WAITING_FOR_NEXT_ROUND = 'WAITING_FOR_NEXT_ROUND',
  ACTIVE = 'ACTIVE',
  SITTING_OUT = 'SITTING_OUT'
}

export interface Card {
  suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';
  rank: 'ACE' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'JACK' | 'QUEEN' | 'KING';
  isFaceUp: boolean;
}

export interface Hand {
  cards: Card[];
  bet: number;
  isFinished: boolean;
  hasDoubled: boolean;
  hasSplit: boolean;
}

export interface Player {
  id: string;
  hands: Hand[];
  balance: number;
  isDealer: boolean;
  seatNumber?: number;
  moveTimeoutId?: NodeJS.Timeout;
  betTimeoutId?: NodeJS.Timeout;
  currentHandIndex?: number;
  state?: PlayerState;
}

export interface GameSession {
  id: string;
  state: GameState;
  players: Player[];
  currentPlayerIndex: number;
  deck: Card[];
  lastMoveTime?: number;
  currentTurnStartTime?: number;
  insuranceAvailable?: boolean;
  insurancePhase?: boolean;
  occupiedSeats: Set<number>;
}

// Dodatkowe typy dla UI
export interface GameInfo {
  // Podstawowe dane
  currentPlayer: Player | null;
  dealer: Player | null;
  otherPlayers: Player[];
  
  // Stan gry
  isMyTurn: boolean;
  gameStatus: string;
  availableActions: {
    canHit: boolean;
    canStand: boolean;
    canDouble: boolean;
    canSplit: boolean;
  };
  
  // Informacje o rękach
  myHandValue: number;
  dealerHandValue: number;
  isBlackjack: boolean;
  isBusted: boolean;
  
  // Timer/czas
  timeRemaining?: number;
  isTimeRunning: boolean;
}
