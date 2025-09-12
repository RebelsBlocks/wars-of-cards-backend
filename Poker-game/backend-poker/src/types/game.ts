export enum GameState {
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS',
  DEALING_INITIAL_CARDS = 'DEALING_INITIAL_CARDS',
  PLAYER_TURN = 'PLAYER_TURN',
  DEALER_TURN = 'DEALER_TURN',
  ROUND_ENDED = 'ROUND_ENDED'
}

// Zachowaj stary PlayerMove jako PlayerMoveBlackjack
export enum PlayerMoveBlackjack {
  HIT = 'HIT',
  STAND = 'STAND', 
  DOUBLE = 'DOUBLE',
  SPLIT = 'SPLIT'
}

// 🆕 Dodaj nowy
export enum PlayerMovePoker {
  FOLD = 'FOLD',
  CHECK = 'CHECK',
  CALL = 'CALL',
  RAISE = 'RAISE',
  ALL_IN = 'ALL_IN'
}

// Tymczasowy alias - później zmienimy
export const PlayerMove = PlayerMoveBlackjack;

export enum PlayerState {
  WAITING_FOR_NEXT_ROUND = 'WAITING_FOR_NEXT_ROUND', // Nowy gracz czeka na następną rundę
  ACTIVE = 'ACTIVE',                                  // Gra w rundzie  
  SITTING_OUT = 'SITTING_OUT',                       // Przerwa na rundę
  OBSERVING = 'OBSERVING',                           // Nowy gracz obserwuje grę (nie brał udziału w tej rundzie)
  AWAITING_BUY_IN = 'AWAITING_BUY_IN'                // Gracz czeka na buy-in po zerowym balansie
}

export enum HandResult {
  WIN = 'WIN',                // Won the hand
  LOSE = 'LOSE',              // Lost the hand
  PUSH = 'PUSH'               // Tie (split pot)
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
  
  // 🆕 POKER FIELDS - dodaj na końcu  
  currentBet?: number;
  totalBet?: number;
  hasFolded?: boolean;
  isAllIn?: boolean;
  lastAction?: string; // na razie string, potem enum
  hasActedThisRound?: boolean; // Czy gracz już działał w tej rundzie
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
  
  // 🆕 POKER FIELDS - dodaj na końcu
  communityCards?: Card[];           // opcjonalne na początku
  pot?: number;
  currentBet?: number;
  bettingRound?: number;
  
  // ✅ POKER BLIND STRUCTURE:
  dealerButtonPosition?: number;    // Numer miejsca z buttonem (1,2,3)
  smallBlindPosition?: number;      // Numer miejsca small blind
  bigBlindPosition?: number;        // Numer miejsca big blind
  smallBlindAmount?: number;        // Kwota small blind (np. 5)
  bigBlindAmount?: number;          // Kwota big blind (np. 10)
}
