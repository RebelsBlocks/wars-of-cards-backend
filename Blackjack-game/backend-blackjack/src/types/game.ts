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
  WAITING_FOR_NEXT_ROUND = 'WAITING_FOR_NEXT_ROUND', // Nowy gracz czeka na następną rundę
  ACTIVE = 'ACTIVE',                                  // Gra w rundzie  
  SITTING_OUT = 'SITTING_OUT',                       // Przerwa na rundę
  OBSERVING = 'OBSERVING',                           // Nowy gracz obserwuje grę (nie brał udziału w tej rundzie)
  AWAITING_BUY_IN = 'AWAITING_BUY_IN'                // Gracz czeka na buy-in po zerowym balansie
}

export enum HandResult {
  BLACKJACK = 'BLACKJACK',    // Natural 21 with 2 cards
  WIN = 'WIN',                // Won with any value
  PUSH = 'PUSH',              // Tie with dealer
  BUST = 'BUST',              // Over 21
  LOSE = 'LOSE'               // Lost to dealer
}

export interface Card {
  suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';
  rank: 'ACE' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'JACK' | 'QUEEN' | 'KING';
  isFaceUp: boolean;
}

export interface HandData {
  cards: Card[];
  bet: number;
  isFinished: boolean;
  hasDoubled: boolean;
  hasSplit: boolean;
  result?: HandResult; // Result of the hand after round ends
}

export interface Player {
  id: string;
  hands: HandData[];
  balance: number;
  isDealer: boolean;
  seatNumber?: number; // Dodany numer miejsca (1, 2, 3)
  moveTimeoutId?: NodeJS.Timeout;
  betTimeoutId?: NodeJS.Timeout;
  betIntervalId?: NodeJS.Timeout; // Interval dla bet timeUpdate
  moveIntervalId?: NodeJS.Timeout; // Interval dla move timeUpdate
  currentHandIndex?: number;
  state?: PlayerState; // Nowy stan gracza
  hasPerformedSplit?: boolean; // NOWE POLE - proste boolean
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
  occupiedSeats: Set<number>; // Śledzenie zajętych miejsc (1, 2, 3)
  // Globalne timery dla całej gry
  globalBetTimeoutId?: NodeJS.Timeout;
  globalBetIntervalId?: NodeJS.Timeout;
  globalBetStartTime?: number;
}
