// Typy importowane z backend'u - utrzymujemy zgodność
export enum GameState {
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS',
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
  SITTING_OUT = 'SITTING_OUT',
  OBSERVING = 'OBSERVING'
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

export interface Hand {
  cards: Card[];
  bet: number;
  isFinished: boolean;
  hasDoubled: boolean;
  hasSplit: boolean;
  result?: HandResult; // Result of the hand after round ends
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
  hasPerformedSplit?: boolean; // NOWE POLE - proste boolean
  
  // 🆕 Poker fields
  currentBet?: number;       // ile gracz postawił w tej rundzie
  hasFolded?: boolean;       // czy gracz spasował
  lastAction?: string;       // ostatnia akcja gracza
  hasActedThisRound?: boolean; // czy gracz już działał w tej rundzie
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
  
  // 🆕 Poker fields
  pot?: number;              // całkowita pula
  currentBet?: number;       // obecna stawka w rundzie
  lastRaiseAmount?: number;  // o ile ostatnio podniesiono
  communityCards?: Card[];   // karty wspólne w pokerze
  bettingRound?: number;     // 0=pre-flop, 1=flop, 2=turn, 3=river
  
  // ✅ POKER BLIND STRUCTURE:
  dealerButtonPosition?: number;    // Numer miejsca z buttonem (1,2,3)
  smallBlindPosition?: number;      // Numer miejsca small blind
  bigBlindPosition?: number;        // Numer miejsca big blind
  smallBlindAmount?: number;        // Kwota small blind (np. 5)
  bigBlindAmount?: number;          // Kwota big blind (np. 10)
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
    canFold: boolean;
    canCheck: boolean;
    // Later: canCall, canRaise
  };
  
  // Informacje o rękach
  myPokerHand: string;
  potAmount: number;
  currentBet: number;
  
  // Timer/czas
  timeRemaining?: number;
  isTimeRunning: boolean;
}
