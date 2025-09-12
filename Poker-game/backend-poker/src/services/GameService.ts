import { GameState, PlayerMove, GameSession, Player, Card, HandData, PlayerState, HandResult } from '../types/game';
import { Server, Socket, RemoteSocket } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../types/socket';
import { v4 as uuidv4 } from 'uuid';
import { Hand } from '../models/Hand';
import { Game } from '../models/Game';

// Typ dla stanu gry wysyłanego do klienta (z occupiedSeats jako array)
type GameStateForClient = Omit<GameSession, 'occupiedSeats'> & {
  occupiedSeats: number[];
};

export class GameService {
  private games: Map<string, GameSession> = new Map();

  // Helper function to format card for logging
  private formatCard(card: Card): string {
    const hand = new Hand([card]);
    return hand.formatHand();
  }

  // Helper function to format hand for logging
  private formatHand(cards: Card[]): string {
    const hand = new Hand(cards);
    return hand.formatHand();
  }
  private gameStartTimers: Map<string, {
    timeout: NodeJS.Timeout;
    interval: NodeJS.Timeout;
  }> = new Map(); // Mapa timerów startowych dla każdej gry

  private roundBreakTimers: Map<string, NodeJS.Timeout> = new Map(); // Mapa timerów przerwy między rundami
  
  // Helper method to draw card directly from game deck
  private drawCardFromGame(game: GameSession): Card {
    console.log(`🃏 Drawing from deck with ${game.deck.length} cards`);
    
    if (game.deck.length === 0) {
      console.log('🔄 Deck empty, creating new shuffled deck');
      game.deck = new Game('temp').createNewDeck();
    }
    
    // Cut card logic - shuffle when less than 25% cards remain (78 cards from 312)
    const CUT_CARD_THRESHOLD = 78;
    if (game.deck.length < CUT_CARD_THRESHOLD) {
      console.log(`🃏 Cut card reached! ${game.deck.length} cards remaining, shuffling new deck...`);
      game.deck = new Game('temp').createNewDeck();
    }
    
    const card = game.deck.pop();
    if (!card) throw new Error('Brak kart w talii');
    card.isFaceUp = true;
    
    console.log(`🃏 Drew: ${this.formatCard(card)} (remaining: ${game.deck.length})`);
    return card;
  }
  private readonly MAX_PLAYERS = 3; // Maksymalna liczba graczy przy stole (nie licząc dealera)
  // ✅ NOWA NUMERACJA: seat 3 = lewy (pierwszy gracz), seat 2 = środek, seat 1 = prawy (ostatni gracz)
  private readonly MOVE_TIMEOUT = 30000;  // 30 sekund na ruch
  private readonly GAME_START_TIMEOUT = 20000; // 20 sekund na start gry (skrócone)
  private readonly ROUND_BREAK_TIMEOUT = 5000; // 5 sekund przerwy między rundami
  private readonly TIME_UPDATE_INTERVAL = 1000; // Co ile ms wysyłać aktualizacje czasu
  private readonly PLAYER_TIMEOUT = 180000; // 3 minuty na usunięcie nieaktywnego gracza
  private readonly MIN_BUY_IN = 100; // Minimalny buy-in

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    // Uruchom czyszczenie co 60 sekund (zmniejszona częstotliwość)
    setInterval(() => {
      this.cleanupDisconnectedPlayers();
    }, 60000);
  }

  // Tworzenie nowej gry
  public createGame(gameId?: string): any {
    const finalGameId = gameId || uuidv4(); // ✅ Użyj podanego ID lub wygeneruj
    
    const newGame: GameSession = {
      id: finalGameId, // ✅ Użyj finalGameId zamiast gameId
      state: GameState.WAITING_FOR_PLAYERS,
      players: [],
      currentPlayerIndex: 0,
      deck: new Game('temp').createNewDeck(), // 6 talii (312 kart)
      insuranceAvailable: false,
      insurancePhase: false,
      occupiedSeats: new Set(),
      // 🆕 POKER FIELDS
      pot: 0,
      currentBet: 0,
      bettingRound: 0, // 0=pre-flop, 1=flop, 2=turn, 3=river
      
      // ✅ DODAJ - BLIND STRUCTURE:
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      dealerButtonPosition: 1  // Zaczynaj z seat 1
    };

    this.games.set(finalGameId, newGame); // ✅ I tutaj też
    this.broadcastGameState(newGame);
    return this.cleanGameStateForClient(newGame);
  }

  // Dołączanie gracza do gry
  public joinGame(gameId: string, seatNumber: number, initialBalance: number = 1000): Player {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');

    // ✅ Jeśli dołączasz do gry w trakcie (nie w WAITING_FOR_PLAYERS), wyczyść potencjalne stare timery
    // Nie czyść timerów gdy gra czeka na graczy - to przerwie odliczanie
    // ✅ NOWE: Nie czyść timerów gdy gra jest w PLAYER_TURN - nie przerywaj aktualnego ruchu
    let wasInPlayerTurn = false;
    if (game.state !== GameState.WAITING_FOR_PLAYERS && game.state !== GameState.PLAYER_TURN) {
      this.clearAllTimers(game);
    } else if (game.state === GameState.PLAYER_TURN) {
      wasInPlayerTurn = true;
    }

    // Check if seat is already occupied
    if (game.occupiedSeats.has(seatNumber)) {
      throw new Error(`Seat ${seatNumber} is already occupied`);
    }

    // Check if seat number is valid
    if (seatNumber < 1 || seatNumber > this.MAX_PLAYERS) {
      throw new Error(`Invalid seat number. Allowed: 1-${this.MAX_PLAYERS}`);
    }

    // Check number of players (excluding dealer and sitting out)
    const playerCount = game.players.filter(p => !p.isDealer && p.state !== PlayerState.SITTING_OUT).length;
    console.log(`🔍 DEBUG joinGame: playerCount=${playerCount}, game.state=${game.state}`);
    console.log(`🔍 DEBUG existing players:`, game.players.map(p => ({ isDealer: p.isDealer, state: p.state })));
    if (playerCount >= this.MAX_PLAYERS) {
      throw new Error(`Table is full. Maximum number of players: ${this.MAX_PLAYERS}`);
    }

    // Określ stan gracza w zależności od stanu gry
    let playerState = PlayerState.ACTIVE;
    if (game.state === GameState.PLAYER_TURN || 
        game.state === GameState.DEALER_TURN || 
        game.state === GameState.ROUND_ENDED ||
        game.state === GameState.DEALING_INITIAL_CARDS) {
      // Gracz dołącza w trakcie rundy - będzie obserwował
      playerState = PlayerState.OBSERVING;
    }

    const player: Player = {
      id: uuidv4(),
      hands: [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false,
        result: undefined
      }],
      balance: initialBalance,
      isDealer: false,
      seatNumber: seatNumber,
      currentHandIndex: 0,
      state: playerState,
      hasPerformedSplit: false
    };

    // Dodaj znacznik czasu aktywności
    (player as any).lastActivity = Date.now();

    game.players.push(player);
    game.occupiedSeats.add(seatNumber);

    // Sprawdź czy stół będzie pełny po dodaniu tego gracza - jeśli tak, uruchom grę natychmiast
    if (playerCount + 1 >= this.MAX_PLAYERS && game.state === GameState.WAITING_FOR_PLAYERS) {
      console.log(`🔍 DEBUG joinGame: Table will be full (${playerCount + 1}/${this.MAX_PLAYERS} players) - starting game immediately`);
      this.startRound(game.id);
      this.io.to(game.id).emit('notification', `Stół pełny! Gra rozpoczyna się z ${playerCount + 1} graczami!`);
    }
    // Jeśli to pierwszy gracz i gra czeka na graczy, rozpocznij odliczanie
    else if (playerCount === 0 && game.state === GameState.WAITING_FOR_PLAYERS) {
      console.log(`🔍 DEBUG joinGame: Starting game countdown for first player`);
      this.startGameCountdown(game);
    }
    // Jeśli dołącza kolejny gracz i nie ma aktywnego timera startowego, uruchom go ponownie
    else if (playerCount > 0 && game.state === GameState.WAITING_FOR_PLAYERS && !this.gameStartTimers.has(game.id)) {
      console.log(`🔍 DEBUG joinGame: Restarting game countdown for additional player (${playerCount + 1} total)`);
      this.startGameCountdown(game);
    }
    // Jeśli dołączasz do gry w stanie ROUND_ENDED i nie ma aktywnego roundBreakTimer, uruchom go
    else if (game.state === GameState.ROUND_ENDED && !this.roundBreakTimers.has(game.id)) {
      console.log(`🔍 DEBUG joinGame: Player joined during ROUND_ENDED - starting round break timer`);
      this.determineWinners(game);
    } else {
      console.log(`🔍 DEBUG joinGame: Not starting countdown - playerCount=${playerCount}, game.state=${game.state}, hasTimer=${this.gameStartTimers.has(game.id)}, hasRoundBreakTimer=${this.roundBreakTimers.has(game.id)}`);
    }

    this.broadcastGameState(game);
    
    // ✅ NOWE: Jeśli gra jest w PLAYER_TURN, nie przerywaj aktualnego timera
    if (wasInPlayerTurn) {
      console.log(`👥 New player joined during PLAYER_TURN - continuing current timer without interruption`);
    }
    
    if (playerState === PlayerState.OBSERVING) {
      this.io.to(gameId).emit('notification', 
        `Gracz dołączył do miejsca ${seatNumber}. Obserwuje grę i zagra w następnej rundzie.`);
    } else {
      this.io.to(gameId).emit('notification', `Gracz dołączył do miejsca ${seatNumber}.`);
    }
    
    return player;
  }

  // Rozpoczęcie nowej rundy - NOWY FLOW POKERA
  public startRound(gameId: string): any {
    console.log(`🔍 DEBUG startRound called for game ${gameId}`);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    console.log(`🔍 DEBUG startRound: game.state=${game.state}, players=${game.players.length}`);
    
    // ✅ DEALER BUTTON ROTATION - Set up dealer button and blinds for new round
    this.setupDealerButtonAndBlinds(game);
    
    // Wyczyść currentPlayerIndex przed nową rundą
    game.currentPlayerIndex = -1;
    console.log('🔄 Preparing next round - cleared currentPlayerIndex');
    
    // Wyczyść wszystkie timery przed rozpoczęciem nowej rundy
    this.clearAllTimers(game);
    
    // Reset currentBet dla nowej rundy
    game.currentBet = 0;
    game.bettingRound = 0; // Reset to pre-flop
    console.log('🔄 Reset currentBet to 0 and bettingRound to 0 for new round');
    
    game.deck = new Game('temp').createNewDeck(); // 6 talii (312 kart)
    
    // Wyczyść community cards na początku rundy
    game.communityCards = [];
    
    // Aktywuj wszystkich graczy którzy czekali na rundę, siedzieli lub obserwowali
    game.players.forEach(player => {
      if (!player.isDealer && (player.state === PlayerState.WAITING_FOR_NEXT_ROUND || 
                               player.state === PlayerState.SITTING_OUT ||
                               player.state === PlayerState.OBSERVING)) {
        player.state = PlayerState.ACTIVE;
        this.io.to(gameId).emit('notification', 
          `Gracz z miejsca ${player.seatNumber} dołącza do gry!`);
      }
      
      // Gracze w stanie AWAITING_BUY_IN pozostają w tym stanie - nie mogą grać
      if (!player.isDealer && player.state === PlayerState.AWAITING_BUY_IN) {
        console.log(`💰 Player ${player.seatNumber} still awaiting buy-in - skipping round`);
      }
      
      // ✅ NOWE: Reset dla wszystkich graczy (włącznie z krupierem) - CZYŚĆ KARTY DLA WSZYSTKICH
      if (player.isDealer) {
              // Czyść ręce krupiera
      player.hands = [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false,
        result: undefined
      }];
      player.hasPerformedSplit = false; // Reset split status for dealer
      console.log(`🧹 Dealer hands cleared for new round`);
      } else {
        // ✅ CZYŚĆ KARTY DLA WSZYSTKICH GRACZY (niezależnie od stanu)
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false,
          result: undefined
        }];
        player.currentHandIndex = 0;
        player.hasPerformedSplit = false; // Reset split status for new round
        console.log(`🧹 Player ${player.seatNumber} hands cleared for new round (state: ${player.state})`);
      }
    });

    // ✅ DODAJ po wyczyszczeniu kart: Inicjalizacja pól licytacji
    game.pot = 0;
    game.currentBet = 0;

    game.players.forEach(player => {
      if (!player.isDealer) {
        player.currentBet = 0;
        player.totalBet = 0;
        player.hasFolded = false;
        player.isAllIn = false;
        player.lastAction = undefined;
        player.hasActedThisRound = false; // ✅ Reset action tracking for initial betting round
      }
    });

    console.log(`🔄 Poker betting fields initialized: pot=${game.pot}, currentBet=${game.currentBet}`);

    // Sprawdź graczy z zerowym balansem na początku rundy
    this.checkPlayersForBuyIn(game);
    
    // ✅ NOWY FLOW POKERA: Karty → Licytacja
    // 1. Rozdaj karty od razu
    game.state = GameState.DEALING_INITIAL_CARDS;
    this.broadcastGameState(game);
    
    // Krótka pauza przed rozdaniem kart
    setTimeout(() => {
      this.dealInitialCards(game);
      // 2. Przejdź do PLAYER_TURN (licytacja)
      game.state = GameState.PLAYER_TURN;
      this.broadcastGameState(game);
    }, 1000); // 1 sekunda przerwy
    
    return this.cleanGameStateForClient(game);
  }

  // 🚫 LEGACY: Postawienie zakładu - nie używane w pokerze
  // W pokerze zakłady są w czasie ruchu gracza (call/raise), nie ma betting phase

  // 🆕 Proces spasowania (fold) - zastępuje processHit
  public processFold(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Player is not active in this round');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Move not allowed at this time');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }

    // Gracz rezygnuje z ręki
    player.hasFolded = true;
    player.hands[0].result = HandResult.LOSE; // używamy istniejącego typu
    player.lastAction = 'FOLD';
    player.hasActedThisRound = true; // ✅ Mark player as having acted
    
    console.log(`🃏 FOLD: Player ${player.seatNumber} folds their hand`);
    console.log(`   Hand: [${this.formatHand(player.hands[0].cards)}]`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // 🆕 Proces czekania (check) - zastępuje processStand
  public processCheck(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Player is not active in this round');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Move not allowed at this time');
    }

    // Gracz czeka (możliwe tylko gdy currentBet = 0)
    if (game.currentBet && game.currentBet > 0) {
      throw new Error('Cannot check when there is a bet');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }
    
    player.lastAction = 'CHECK';
    player.hasActedThisRound = true; // ✅ Mark player as having acted
    
    console.log(`✅ CHECK: Player ${player.seatNumber} checks`);
    console.log(`   Hand: [${this.formatHand(player.hands[0].cards)}]`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // 🆕 Proces dorównania (call)
  public processCall(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Player is not active in this round');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Move not allowed at this time');
    }

    // Gracz dorównuje do currentBet
    const callAmount = (game.currentBet || 0) - (player.currentBet || 0);
    
    if (callAmount <= 0) {
      throw new Error('No bet to call');
    }
    
    if (player.balance < callAmount) {
      throw new Error('Insufficient funds to call');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }
    
    player.balance -= callAmount;
    player.currentBet = (player.currentBet || 0) + callAmount;
    game.pot = (game.pot || 0) + callAmount;
    player.lastAction = 'CALL';
    player.hasActedThisRound = true; // ✅ Mark player as having acted
    
    console.log(`📞 CALL: Player ${player.seatNumber} calls $${callAmount}`);
    console.log(`   Total bet: $${player.currentBet}, Pot: $${game.pot}`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // 🆕 Proces podniesienia stawki (raise)
  public processRaise(gameId: string, playerId: string, amount: number): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Player is not active in this round');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Move not allowed at this time');
    }

    if (amount <= 0) {
      throw new Error('Raise amount must be positive');
    }

    // Gracz podnosi stawkę
    const totalBetNeeded = (game.currentBet || 0) + amount;
    const playerNeedsToPay = totalBetNeeded - (player.currentBet || 0);
    
    if (player.balance < playerNeedsToPay) {
      throw new Error('Insufficient funds to raise');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }
    
    player.balance -= playerNeedsToPay;
    player.currentBet = totalBetNeeded;
    game.currentBet = totalBetNeeded;
    game.pot = (game.pot || 0) + playerNeedsToPay;
    player.lastAction = `RAISE ${amount}`;
    player.hasActedThisRound = true; // ✅ Mark player as having acted
    
    console.log(`📈 RAISE: Player ${player.seatNumber} raises by $${amount}`);
    console.log(`   Total bet: $${player.currentBet}, Pot: $${game.pot}`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // 🚫 LEGACY: Proces podwojenia zakładu (double) - nie używane w pokerze
  /*
  public processDouble(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const handIndex = player.currentHandIndex || 0;
    const currentHand = player.hands[handIndex];
    
    if (currentHand.cards.length !== 2) {
      throw new Error('Double is only possible with the first two cards');
    }
    
    if (player.balance < currentHand.bet) {
      throw new Error('Insufficient funds for double');
    }

    // Podwój zakład
    player.balance -= currentHand.bet;
    currentHand.bet *= 2;
    currentHand.hasDoubled = true;

    // Dobierz jedną kartę
    const card = this.drawCardFromGame(game);
    currentHand.cards.push(card);

    const handInstance = new Hand(currentHand.cards);
    const handValue = handInstance.calculateValue();
    
    console.log(`💰 DOUBLE: Player ${player.seatNumber} doubles to $${currentHand.bet}`);
    console.log(`   Draws: ${this.formatCard(card)}`);
    console.log(`   Final hand: [${this.formatHand(currentHand.cards)}] = ${handValue}`);

    currentHand.isFinished = true;
    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }
  */

  // 🚫 LEGACY: Proces dzielenia kart (split) - nie używane w pokerze
  /*
  public processSplit(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }

    const handIndex = player.currentHandIndex || 0;
    const currentHand = player.hands[handIndex];
    
    if (currentHand.cards.length !== 2) {
      throw new Error('Split is only possible with the first two cards');
    }
    
    const firstCard = currentHand.cards[0];
    const secondCard = currentHand.cards[1];
    
    if (firstCard.rank !== secondCard.rank) {
      throw new Error('Split is only possible with cards of the same value');
    }
    
    if (player.balance < currentHand.bet) {
      throw new Error('Insufficient funds for split');
    }
    
    // Sprawdź czy gracz już wykonał split w tej rundzie
    if (player.hasPerformedSplit) {
      console.log(`🚫 SPLIT BLOCKED: Player ${player.seatNumber} already split in this round`);
      throw new Error('Split can only be performed once per round');
    }

    // Utwórz nową rękę
    const newHand: HandData = {
      cards: [secondCard],
      bet: currentHand.bet,
      isFinished: false,
      hasDoubled: false,
      hasSplit: true,
      result: undefined
    };

    // Zmodyfikuj obecną rękę
    currentHand.cards = [firstCard];
    currentHand.hasSplit = true;
    currentHand.isFinished = false; // Resetuj stan ręki po split
    
    // Resetuj currentHandIndex do pierwszej ręki po split
    player.currentHandIndex = 0;
    
    // Dodaj nową rękę
    player.hands.push(newHand);
    
    // Pobierz zakład za nową rękę
    player.balance -= currentHand.bet;
    
    // Oznacz że gracz wykonał split w tej rundzie
    player.hasPerformedSplit = true;

    // Dobierz karty dla obu rąk
    currentHand.cards.push(this.drawCardFromGame(game));
    newHand.cards.push(this.drawCardFromGame(game));

    console.log(`✂️ SPLIT: Player ${player.seatNumber} splits ${this.formatCard(firstCard)} / ${this.formatCard(secondCard)}`);
    console.log(`   Hand 1: [${this.formatHand(currentHand.cards)}]`);
    console.log(`   Hand 2: [${this.formatHand(newHand.cards)}]`);

    game.lastMoveTime = Date.now();
    
    // ✅ Po splicie - wyczyść timer i uruchom nowy pełny timer
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }

    // Reset czasu tury i uruchom nowy pełny timer
    game.currentTurnStartTime = Date.now();
    console.log(`⏰ SPLIT executed - starting fresh 30s timer`);
    this.startMoveTimeout(game, player);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }
  */

  // Pobranie stanu gry
  public getGameState(gameId: string): any {
    const game = this.getGame(gameId);
    return game ? this.cleanGameStateForClient(game) : null;
  }

  // Znajdź dostępną grę z wolnymi miejscami
  public findAvailableGame(): any {
    console.log(`Searching for available games among ${this.games.size} total games`);
    
    for (const game of this.games.values()) {
      const playerCount = game.players.filter(p => !p.isDealer && p.state !== PlayerState.SITTING_OUT).length;
      console.log(`Game ${game.id}: state=${game.state}, players=${playerCount}/${this.MAX_PLAYERS}`);
      
      // ✅ Pozwól dołączać ZAWSZE gdy jest miejsce (niezależnie od stanu gry)
      if (playerCount < this.MAX_PLAYERS) {
        console.log(`Found available game: ${game.id} with ${playerCount} players`);
        return this.cleanGameStateForClient(game); // Znaleziono grę z wolnymi miejscami
      }
    }
    
    console.log('No available games found');
    return null; // Brak dostępnych gier
  }

  // Pobranie informacji o liczbie graczy
  public getPlayerCount(gameId: string): { current: number; maximum: number } {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');

    const currentPlayers = game.players.filter(p => !p.isDealer && p.state !== PlayerState.SITTING_OUT).length;
    return {
      current: currentPlayers,
      maximum: this.MAX_PLAYERS
    };
  }

  // Nowe metody do obsługi timeoutów

  // 🚫 LEGACY: Globalny timer zakładów - nie używane w pokerze

  // ✅ NOWA METODA: Indywidualne timery buy-in dla graczy (30 sekund)
  private startBuyInTimeout(game: GameSession, player: Player): void {
    // Wyczyść stary timer buy-in jeśli istnieje
    if ((player as any).buyInTimer) {
      clearTimeout((player as any).buyInTimer);
      (player as any).buyInTimer = undefined;
    }
    
    const needsBuyIn = player.balance === 0;
    const buyInTimeout = 30000; // 30 sekund na buy-in
    
    if (needsBuyIn) {
      console.log(`⏰ Starting buy-in timeout for player ${player.seatNumber}: ${buyInTimeout/1000}s`);
      
      const buyInTimer = setTimeout(() => {
        if (player.state === PlayerState.AWAITING_BUY_IN && player.balance === 0) {
          console.log(`💸 Player ${player.seatNumber} failed to buy-in in 30s - removing from game`);
          this.leaveGame(game.id, player.id);
          this.io.to(game.id).emit('notification', 
            `Gracz z miejsca ${player.seatNumber} nie dokupił żetonów w 30 sekund. Opuścił stół.`
          );
          
          // 🚫 LEGACY: Sprawdzanie betting phase - nie używane w pokerze
        }
      }, buyInTimeout);
      
      // Zapisz timer buy-in w graczu
      (player as any).buyInTimer = buyInTimer;
    }
  }

  // 🚫 LEGACY: Timer zakładów - nie używane w pokerze

  // 🚫 LEGACY: Sprawdzanie czy wszyscy gracze skończyli stawiać zakłady - nie używane w pokerze

  private startMoveTimeout(game: GameSession, player: Player): void {
    // ✅ Sprawdź czy player istnieje i ma id
    if (!player) {
      console.log(`⚠️ Player is undefined - cannot start move timeout`);
      return;
    }
    
    if (!player.id) {
      console.log(`⚠️ Player.id is undefined - cannot start move timeout (seat: ${player.seatNumber})`);
      return;
    }
    
    console.log(`⏰ Starting move timeout for player ${player.id} (seat ${player.seatNumber})`);
    
    // ✅ Sprawdź czy this.io istnieje
    if (!this.io) {
      console.log(`⚠️ this.io is undefined - cannot start move timeout`);
      return;
    }
    
    // ✅ Wyczyść istniejące timery gracza przed uruchomieniem nowego
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
      console.log(`🧹 Cleared existing move timeout for player ${player.seatNumber}`);
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
      console.log(`🧹 Cleared existing move interval for player ${player.seatNumber}`);
    }
    
    // Sprawdź czy ręka gracza istnieje i nie jest zakończona
    const handIndex = player.currentHandIndex || 0;
    const currentHand = player.hands[handIndex];
    console.log(`🔍 DEBUG startMoveTimeout: handIndex=${handIndex}, handExists=${!!currentHand}, isFinished=${currentHand?.isFinished}`);
    
    if (!currentHand) {
      console.log(`⏰ Player ${player.id} hand does not exist - skipping timeout`);
      return;
    }
    
    if (currentHand.isFinished === true) {
      console.log(`⏰ Player ${player.id} hand is already finished - skipping timeout`);
      return;
    }
    
    const startTime = Date.now();
    
    // Ustaw interwał do aktualizacji pozostałego czasu
    const updateInterval = setInterval(() => {
      const remainingTime = this.MOVE_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        // Log co 10 sekund
        if (remainingTime % 10000 < 1000) {
          console.log(`🎯 Move time: ${Math.ceil(remainingTime/1000)}s remaining (Player ${player.id})`);
        }
        // ✅ Sprawdź czy this.io istnieje przed użyciem
        if (this.io) {
          this.io.to(game.id).emit('timeUpdate', {
            type: 'move',
            playerId: player.id,
            remainingTime,
            totalTime: this.MOVE_TIMEOUT
          });
        }
      } else {
        clearInterval(updateInterval);
        if (player.moveIntervalId) {
          clearInterval(player.moveIntervalId);
          player.moveIntervalId = undefined;
        }
      }
    }, this.TIME_UPDATE_INTERVAL);
    // Zachowaj referencję, aby móc ją wyczyścić przy opuszczeniu gry
    player.moveIntervalId = updateInterval;

    player.moveTimeoutId = setTimeout(() => {
      clearInterval(updateInterval);
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
      }
      
      // Sprawdź czy gra nadal jest w stanie PLAYER_TURN
      if (game.state !== GameState.PLAYER_TURN) {
        console.log(`⏰ Move timeout expired but game state is ${game.state} - ignoring`);
        return;
      }
      
      // Sprawdź czy gracz nadal jest aktualnym graczem
      if (game.players[game.currentPlayerIndex]?.id !== player.id) {
        console.log(`⏰ Move timeout expired but player ${player.id} is no longer current player - ignoring`);
        return;
      }
      
      // Sprawdź czy gracz nadal ma aktywną rękę
      const handIndex = player.currentHandIndex || 0;
      const currentHand = player.hands[handIndex];
      
      if (!currentHand) {
        console.log(`⏰ Move timeout expired but player ${player.id} hand does not exist - ignoring`);
        return;
      }
      
      if (currentHand.isFinished === true) {
        console.log(`⏰ Move timeout expired but player ${player.id} hand is already finished - ignoring`);
        return;
      }
      
      // Sprawdź czy CHECK jest możliwy (currentBet = 0)
      if (!game.currentBet || game.currentBet === 0) {
        console.log(`⏰ Move timeout for player ${player.id} - auto CHECK`);
        if (this.io) {
          this.io.to(game.id).emit('notification', 
            `Czas na ruch gracza ${player.seatNumber} upłynął. Automatycznie wykonano CHECK.`
          );
        }
        this.processCheck(game.id, player.id);
      } else {
        console.log(`⏰ Move timeout for player ${player.id} - auto CALL (currentBet: ${game.currentBet})`);
        if (this.io) {
          this.io.to(game.id).emit('notification', 
            `Czas na ruch gracza ${player.seatNumber} upłynął. Automatycznie wykonano CALL.`
          );
        }
        this.processCall(game.id, player.id);
      }
    }, this.MOVE_TIMEOUT);
    
    console.log(`⏰ Move timeout started for player ${player.id} (${this.MOVE_TIMEOUT/1000}s)`);
  }

  // Nowa metoda do obsługi odliczania do startu gry
  private startGameCountdown(game: GameSession): void {
    console.log(`🔍 DEBUG startGameCountdown called for game ${game.id}`);
    // ✅ Wyczyść tylko gameStart timery - NIE roundBreakTimer
    this.clearGameStartTimer(game.id);
    // Buy-in timery są teraz zintegrowane z timerami zakładów
    // Wyczyść timery graczy
    game.players.forEach(player => {
      if (player.moveTimeoutId) {
        clearTimeout(player.moveTimeoutId);
        player.moveTimeoutId = undefined;
      }
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
      }
      if (player.betTimeoutId) {
        clearTimeout(player.betTimeoutId);
        player.betTimeoutId = undefined;
      }
      if (player.betIntervalId) {
        clearInterval(player.betIntervalId);
        player.betIntervalId = undefined;
      }
    });
    
    const startTime = Date.now();
    console.log(`🕐 GAME START COUNTDOWN: ${this.GAME_START_TIMEOUT/1000}s to wait for players`);
    
    // Ustawiamy interwał do aktualizacji pozostałego czasu
    const updateInterval = setInterval(() => {
      const remainingTime = this.GAME_START_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        // Log co 5 sekund
        if (remainingTime % 5000 < 1000) {
          console.log(`🕐 Waiting for players: ${Math.ceil(remainingTime/1000)}s remaining`);
        }
        this.io.to(game.id).emit('timeUpdate', {
          type: 'gameStart',
          remainingTime,
          totalTime: this.GAME_START_TIMEOUT
        });
      }
    }, this.TIME_UPDATE_INTERVAL);

    // Ustawiamy timeout na start gry
    const gameStartTimer = setTimeout(() => {
      this.gameStartTimers.delete(game.id); // Usuń timer z mapy
      
      const playerCount = game.players.filter(p => !p.isDealer).length;
      
      if (playerCount > 0) {
        // Jeśli jest przynajmniej jeden gracz, rozpocznij grę
        console.log(`🕐 GAME START TIMEOUT EXPIRED - starting game with ${playerCount} players`);
        this.startRound(game.id);
        this.io.to(game.id).emit('notification', 
          `Gra rozpoczyna się z ${playerCount} graczami!`
        );
      } else {
        // W przypadku gdyby wszyscy gracze opuścili stół przed startem
        console.log(`🕐 GAME START TIMEOUT EXPIRED - no players left`);
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Brak graczy przy stole.');
      }
    }, this.GAME_START_TIMEOUT);

    // Zapisz oba timery w mapie
    this.gameStartTimers.set(game.id, {
      timeout: gameStartTimer,
      interval: updateInterval
    });
    console.log(`🔍 DEBUG startGameCountdown: Timer set for game ${game.id} (${this.GAME_START_TIMEOUT/1000}s)`);
  }

  // Metoda do anulowania timera startowego
  private clearGameStartTimer(gameId: string): void {
    const timers = this.gameStartTimers.get(gameId);
    if (timers) {
      clearTimeout(timers.timeout);
      clearInterval(timers.interval);
      this.gameStartTimers.delete(gameId);
      console.log(`🧹 CLEARED both gameStart timers for game ${gameId}`);
    } else {
      console.log(`🔍 No game start timer found for game ${gameId}`);
    }
  }

  // Nowa metoda do opuszczenia gry
  public leaveGame(gameId: string, playerId: string): void {
    const game = this.getGame(gameId);
    if (!game) {
      console.warn('Game not found:', gameId);
      return; // Nie rzucaj błędu
    }

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      console.warn('Player not found:', playerId);
      return; // Nie rzucaj błędu
    }

    const player = game.players[playerIndex];
    const wasCurrentPlayer = game.currentPlayerIndex === playerIndex && game.state === GameState.PLAYER_TURN;
    
    // ✅ Sprawdź czy to będzie ostatni gracz PRZED usunięciem
    const remainingPlayers = game.players.filter(p => !p.isDealer && p.id !== playerId).length;
    
    console.log(`🔍 DEBUG leaveGame: remainingPlayers=${remainingPlayers}, total players=${game.players.length}`);
    console.log(`🔍 DEBUG all players:`, game.players.map(p => ({ id: p.id, isDealer: p.isDealer, state: p.state, seatNumber: p.seatNumber })));
    
    // ✅ Jeśli usuwany gracz to current player w trakcie tury, przejdź do następnego PRZED usunięciem
    if (wasCurrentPlayer) {
      console.log(`🔄 Current player leaving, advancing to next player`);
      // Tymczasowo oznacz rękę jako zakończoną, żeby nextPlayer mogło przejść dalej bez akcji
      try {
        this.nextPlayer(game);
      } catch (e) {
        console.warn('nextPlayer threw during leaveGame, continuing cleanup', e);
      }
    }
    
    // ✅ WYCZYŚĆ TIMERY GRACZA PRZED USUNIĘCIEM
    if (player.moveTimeoutId) clearTimeout(player.moveTimeoutId);
    if (player.moveIntervalId) clearInterval(player.moveIntervalId);
    if (player.betTimeoutId) clearTimeout(player.betTimeoutId);
    if (player.betIntervalId) clearInterval(player.betIntervalId);
    // Buy-in timer jest zintegrowany z timerem zakładów
    
    // Usuń gracza z listy
    game.players.splice(playerIndex, 1);
    
    // ✅ Dostosuj currentPlayerIndex jeśli trzeba
    if (game.currentPlayerIndex > playerIndex) {
      game.currentPlayerIndex--;
      console.log(`🔄 Adjusted currentPlayerIndex to ${game.currentPlayerIndex}`);
    }
    
    // Jeśli po usunięciu nie ma już aktywnych graczy podczas tury gracza, zakończ rundę
    if (game.state === GameState.PLAYER_TURN) {
      const anyActive = game.players.some(p => !p.isDealer && p.state === PlayerState.ACTIVE);
      if (!anyActive) {
        // ✅ WYCZYŚĆ TIMERY PRZED ZMIANĄ STANU
        this.clearAllTimers(game);
        game.state = GameState.ROUND_ENDED;  // ✅ POKER: Przejdź do końca rundy
        this.determineWinners(game);
      } else {
        // ✅ NOWE: Jeśli są jeszcze aktywni gracze, ponownie uruchom timer dla aktualnego gracza
        if (game.currentPlayerIndex >= 0) {
          const currentPlayer = game.players[game.currentPlayerIndex];
          if (currentPlayer && currentPlayer.state === PlayerState.ACTIVE) {
            console.log(`🔄 Restarting move timeout for current player ${currentPlayer.seatNumber} after player left`);
            this.startMoveTimeout(game, currentPlayer);
          }
        }
      }
    }

    // Zwolnij miejsce
    if (player.seatNumber) {
      game.occupiedSeats.delete(player.seatNumber);
    }

    // Sprawdź czy to był ostatni gracz (nie licząc dealera)
    if (remainingPlayers === 0) {
      // ✅ Jeśli to ostatni gracz, wyczyść WSZYSTKIE timery gry
      this.clearAllTimers(game);
      this.clearGameStartTimer(game.id);
      
      // ✅ RESETUJ PEŁNY STAN GRY - nie tylko zmień state
      game.state = GameState.WAITING_FOR_PLAYERS;
      game.currentPlayerIndex = 0;
      game.currentTurnStartTime = undefined;
      game.lastMoveTime = undefined;
      
      // ✅ WYCZYŚĆ KARTY WSZYSTKICH GRACZY (włącznie z dealerem)
      game.players.forEach(player => {
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false,
          result: undefined
        }];
        if (!player.isDealer) {
          player.currentHandIndex = 0;
        }
      });
      
      // ✅ NOWA TALIA (6 talii = 312 kart)
      game.deck = new Game('temp').createNewDeck();
      
      // Wyczyść community cards na początku rundy
      game.communityCards = [];
      
      this.io.to(gameId).emit('notification', 'Wszyscy gracze opuścili stół. Gra zresetowana.');
    }

    // Powiadom innych graczy
    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz opuścił miejsce ${player.seatNumber || 'nieznane'}.`);
  }

  // Metoda do broadcastowania stanu gry
  private broadcastGameState(game: GameSession): void {
    if (!this.io) return;
    
    const cleanGame = this.cleanGameStateForClient(game);
    
    // Debug log removed for cleaner console
    
    this.io.to(game.id).emit('gameState', cleanGame);
  }

  // Dodaj tę metodę do klasy GameService
  public cleanGameStateForClient(game: GameSession): any {
    // Tworzymy kopię obiektu gry
    const cleanGame = { ...game };
    
    // Usuwamy pola związane z timerami i intervalami
    cleanGame.players = game.players.map(player => ({
      ...player,
      betTimeoutId: undefined,
      moveTimeoutId: undefined,
      betIntervalId: undefined,
      moveIntervalId: undefined,
      lastActivity: undefined
    }));
    
    // 🚫 LEGACY: Globalne timery zakładów - nie używane w pokerze

    // Debug log removed for cleaner console

    return cleanGame;
  }

  // Prywatne metody pomocnicze

  private getGame(gameId: string): GameSession | undefined {
    return this.games.get(gameId);
  }

  private findPlayer(game: GameSession, playerId: string): Player | undefined {
    return game.players.find(p => p.id === playerId);
  }



  private dealInitialCards(game: GameSession): void {
    console.log(`🃏 POKER: Starting to deal initial cards`);
    
    // ✅ POST BLINDS - Post small blind and big blind before dealing cards
    this.postBlinds(game);
    
    // CZĘŚĆ 1: Rozdaj 2 karty każdemu graczowi
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE && 
      p.hands.length > 0
    ).sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));

    // Wyczyść karty graczy
    activePlayers.forEach(player => {
      player.hands[0].cards = [];
    });

    // Rozdaj 2 karty każdemu graczowi
    for (let round = 0; round < 2; round++) {
      for (const player of activePlayers) {
        const card = this.drawCardFromGame(game);
        player.hands[0].cards.push(card);
        console.log(`🃏 Player ${player.seatNumber} gets: ${this.formatCard(card)}`);
      }
    }

    // CZĘŚĆ 2: Przygotuj community cards (na razie puste)
    const dealer = game.players.find(p => p.isDealer);
    if (dealer) {
      dealer.hands[0].cards = []; // Wyczyść - community cards będą dodane później
      console.log(`🃏 Community cards area prepared (empty)`);
    }

    // ✅ Find first player to act (after big blind in pre-flop)
    const firstPlayerToAct = this.findFirstPlayerToAct(game);
    
    if (firstPlayerToAct) {
      // Znajdź index pierwszego gracza w game.players array
      const firstPlayerIndex = game.players.findIndex(p => p.id === firstPlayerToAct.id);
      game.currentPlayerIndex = firstPlayerIndex;
      console.log(`🎯 POKER: First player to act: Player ${firstPlayerToAct.seatNumber} (index: ${firstPlayerIndex})`);
      
      // Ustaw czas rozpoczęcia tury
      game.currentTurnStartTime = Date.now();
      
      // Uruchom timer dla pierwszego gracza
      this.startMoveTimeout(game, game.players[firstPlayerIndex]);
    } else {
      // Brak aktywnych graczy - zakończ rundę
      console.log(`🎯 POKER: No active players - ending round`);
      game.state = GameState.ROUND_ENDED;
      this.determineWinners(game);
      this.broadcastGameState(game);
      return;
    }

    // Przejdź do następnego stanu
    game.state = GameState.PLAYER_TURN;
    this.broadcastGameState(game);
  }

  // 🆕 Nowa funkcja - dodaj w GameService.ts
  private dealCommunityCards(game: GameSession, count: number): void {
    console.log(`🃏 Dealing ${count} community cards`);
    
    // Inicjalizuj communityCards jeśli nie istnieją
    if (!game.communityCards) {
      game.communityCards = [];
    }
    
    for (let i = 0; i < count; i++) {
      const card = this.drawCardFromGame(game);
      game.communityCards.push(card);
      console.log(`🃏 Community card: ${this.formatCard(card)}`);
    }
    
    console.log(`🃏 Total community cards: ${game.communityCards.length}`);
    this.broadcastGameState(game);
  }

  // 🆕 Nowa funkcja dla turn i river - dodaj później
  private startNextBettingRound(game: GameSession): void {
    const dealer = game.players.find(p => p.isDealer);
    const communityCount = dealer?.hands[0].cards.length || 0;
    const currentBettingRound = game.bettingRound || 0;
    
    console.log(`🃏 Starting next betting round: ${currentBettingRound} -> ${currentBettingRound + 1}`);
    
    // Increment betting round
    game.bettingRound = (currentBettingRound + 1);
    
    if (currentBettingRound === 0) {
      // Pre-flop -> Flop: Deal 3 community cards
      this.dealCommunityCards(game, 3);
      console.log(`🃏 FLOP: Added 3 community cards`);
    } else if (currentBettingRound === 1) {
      // Flop -> Turn: Add 1 community card
      this.dealCommunityCards(game, 1);
      console.log(`🃏 TURN: Added 1 community card`);
    } else if (currentBettingRound === 2) {
      // Turn -> River: Add 1 community card
      this.dealCommunityCards(game, 1);
      console.log(`🃏 RIVER: Added 1 community card`);
    } else if (currentBettingRound >= 3) {
      // River -> Showdown: End the round
      console.log(`🃏 SHOWDOWN: All betting rounds complete - ending round`);
      game.state = GameState.ROUND_ENDED;
      this.determineWinners(game);
      this.broadcastGameState(game);
      return;
    }
    
    // Reset betting, start new round
    game.currentBet = 0;
    
    // Reset currentBet dla wszystkich graczy
    game.players.forEach(player => {
      if (!player.isDealer) {
        player.currentBet = 0;
        player.lastAction = undefined;
        player.hasActedThisRound = false; // ✅ Reset action tracking for new betting round
      }
    });
    
    // ✅ Find first player to act (after button in post-flop rounds)
    const firstPlayerToAct = this.findFirstPlayerToAct(game);
    
    if (firstPlayerToAct) {
      const firstPlayerIndex = game.players.findIndex(p => p.id === firstPlayerToAct.id);
      game.currentPlayerIndex = firstPlayerIndex;
      game.currentTurnStartTime = Date.now();
      
      console.log(`🎯 Next betting round: Player ${firstPlayerToAct.seatNumber} starts`);
      
      // Uruchom timer dla pierwszego gracza
      this.startMoveTimeout(game, game.players[firstPlayerIndex]);
    }
    
    this.broadcastGameState(game);
  }

  // ✅ Post blinds (small blind and big blind)
  private postBlinds(game: GameSession): void {
    if (!game.smallBlindPosition || !game.bigBlindPosition) {
      console.log(`🎯 No blind positions set - skipping blind posting`);
      return;
    }
    
    const smallBlindPlayer = game.players.find(p => p.seatNumber === game.smallBlindPosition);
    const bigBlindPlayer = game.players.find(p => p.seatNumber === game.bigBlindPosition);
    
    if (!smallBlindPlayer || !bigBlindPlayer) {
      console.log(`🎯 Blind players not found - skipping blind posting`);
      return;
    }
    
    const smallBlindAmount = game.smallBlindAmount || 5;
    const bigBlindAmount = game.bigBlindAmount || 10;
    
    // Post small blind
    if (smallBlindPlayer.balance >= smallBlindAmount) {
      smallBlindPlayer.balance -= smallBlindAmount;
      smallBlindPlayer.currentBet = smallBlindAmount;
      game.pot = (game.pot || 0) + smallBlindAmount;
      smallBlindPlayer.hasActedThisRound = true; // Small blind has acted
      console.log(`💰 Small Blind: Player ${smallBlindPlayer.seatNumber} posts $${smallBlindAmount}`);
    } else {
      // All-in small blind
      const allInAmount = smallBlindPlayer.balance;
      smallBlindPlayer.currentBet = allInAmount;
      game.pot = (game.pot || 0) + allInAmount;
      smallBlindPlayer.balance = 0;
      smallBlindPlayer.isAllIn = true;
      smallBlindPlayer.hasActedThisRound = true;
      console.log(`💰 Small Blind: Player ${smallBlindPlayer.seatNumber} all-in for $${allInAmount}`);
    }
    
    // Post big blind
    if (bigBlindPlayer.balance >= bigBlindAmount) {
      bigBlindPlayer.balance -= bigBlindAmount;
      bigBlindPlayer.currentBet = bigBlindAmount;
      game.pot = (game.pot || 0) + bigBlindAmount;
      
      // ✅ HEADS-UP PRE-FLOP: BB nie działał jeszcze, tylko wymusił blind
      const activePlayers = game.players.filter(p => !p.isDealer && p.state === PlayerState.ACTIVE);
      const isHeadsUp = activePlayers.length === 2;
      
      if (!isHeadsUp) {
        bigBlindPlayer.hasActedThisRound = true; // Tylko w grze 3+ graczy
      }
      // W heads-up, BB będzie mieć opcję check/raise po SB call
      
      console.log(`💰 Big Blind: Player ${bigBlindPlayer.seatNumber} posts $${bigBlindAmount}`);
    } else {
      // All-in big blind
      const allInAmount = bigBlindPlayer.balance;
      bigBlindPlayer.currentBet = allInAmount;
      game.pot = (game.pot || 0) + allInAmount;
      bigBlindPlayer.balance = 0;
      bigBlindPlayer.isAllIn = true;
      
      // ✅ HEADS-UP PRE-FLOP: BB all-in też nie działał jeszcze
      const activePlayers = game.players.filter(p => !p.isDealer && p.state === PlayerState.ACTIVE);
      const isHeadsUp = activePlayers.length === 2;
      
      if (!isHeadsUp) {
        bigBlindPlayer.hasActedThisRound = true; // Tylko w grze 3+ graczy
      }
      console.log(`💰 Big Blind: Player ${bigBlindPlayer.seatNumber} all-in for $${allInAmount}`);
    }
    
    // Set current bet to big blind amount
    game.currentBet = bigBlindAmount;
    
    console.log(`💰 Blinds posted: Pot = $${game.pot}, Current bet = $${game.currentBet}`);
  }

  // ✅ Find first player to act (after big blind in pre-flop, after button in other rounds)
  private findFirstPlayerToAct(game: GameSession): Player | null {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE && 
      !p.hasFolded
    ).sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));
    
    if (activePlayers.length === 0) return null;
    
    if (game.bettingRound === 0) {
      // Pre-flop: First player to act is after big blind
      if (!game.bigBlindPosition) return activePlayers[0];
      
      const bigBlindIndex = activePlayers.findIndex(p => p.seatNumber === game.bigBlindPosition);
      const firstToActIndex = (bigBlindIndex + 1) % activePlayers.length;
      return activePlayers[firstToActIndex];
    } else {
      // Post-flop: First player to act is after button (small blind)
      if (!game.dealerButtonPosition) return activePlayers[0];
      
      const buttonIndex = activePlayers.findIndex(p => p.seatNumber === game.dealerButtonPosition);
      const firstToActIndex = (buttonIndex + 1) % activePlayers.length;
      return activePlayers[firstToActIndex];
    }
  }

  // ✅ Setup dealer button and blinds for new round
  private setupDealerButtonAndBlinds(game: GameSession): void {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE
    ).sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));
    
    if (activePlayers.length < 2) {
      console.log(`🎯 Not enough players for dealer button/blinds (${activePlayers.length} players)`);
      return;
    }
    
    // If this is the first round, set dealer button to first player
    if (game.dealerButtonPosition === undefined) {
      game.dealerButtonPosition = activePlayers[0].seatNumber;
      console.log(`🎯 First round: Dealer button set to seat ${game.dealerButtonPosition}`);
    } else {
      // Rotate dealer button to next active player
      const currentButtonIndex = activePlayers.findIndex(p => p.seatNumber === game.dealerButtonPosition);
      const nextButtonIndex = (currentButtonIndex + 1) % activePlayers.length;
      game.dealerButtonPosition = activePlayers[nextButtonIndex].seatNumber;
      console.log(`🎯 Dealer button rotated to seat ${game.dealerButtonPosition}`);
    }
    
    // Set small blind and big blind positions
    const buttonIndex = activePlayers.findIndex(p => p.seatNumber === game.dealerButtonPosition);
    const smallBlindIndex = (buttonIndex + 1) % activePlayers.length;
    const bigBlindIndex = (buttonIndex + 2) % activePlayers.length;
    
    game.smallBlindPosition = activePlayers[smallBlindIndex].seatNumber;
    game.bigBlindPosition = activePlayers[bigBlindIndex].seatNumber;
    
    console.log(`🎯 Blinds: Small Blind seat ${game.smallBlindPosition}, Big Blind seat ${game.bigBlindPosition}`);
  }

  // 🆕 Check if all active players have finished betting (all have acted AND equal bets)
  private allPlayersFinishedBetting(game: GameSession): boolean {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE && 
      !p.hasFolded
    );
    
    if (activePlayers.length <= 1) {
      return true; // Only one player left, betting is finished
    }
    
    const currentBet = game.currentBet || 0;
    const allActed = activePlayers.every(p => p.hasActedThisRound === true);
    const allEqualBets = activePlayers.every(p => (p.currentBet || 0) === currentBet);
    
    // ✅ HEADS-UP PRE-FLOP: BB musi mieć option po SB call
    if (game.bettingRound === 0 && activePlayers.length === 2) {
      const bbPlayer = activePlayers.find(p => p.seatNumber === game.bigBlindPosition);
      if (bbPlayer && bbPlayer.lastAction !== 'CHECK' && bbPlayer.lastAction !== 'RAISE') {
        return false; // BB jeszcze nie działał po ostatnim call/raise
      }
    }
    
    return allActed && allEqualBets;
  }

  private nextPlayer(game: GameSession): void {
    const currentPlayer = game.players[game.currentPlayerIndex];
    
    // ✅ WYCZYŚĆ TIMERY POPRZEDNIEGO GRACZA
    if (currentPlayer && !currentPlayer.isDealer) {
      if (currentPlayer.moveTimeoutId) {
        clearTimeout(currentPlayer.moveTimeoutId);
        currentPlayer.moveTimeoutId = undefined;
        console.log(`🧹 Cleared move timeout for previous player ${currentPlayer.seatNumber}`);
      }
      if (currentPlayer.moveIntervalId) {
        clearInterval(currentPlayer.moveIntervalId);
        currentPlayer.moveIntervalId = undefined;
        console.log(`🧹 Cleared move interval for previous player ${currentPlayer.seatNumber}`);
      }
    }
    
    // ✅ POKER LOGIC: Sprawdź czy wszyscy gracze skończyli licytację
    if (this.allPlayersFinishedBetting(game)) {
      // Wszyscy wyrównali - przejdź do następnej fazy
      console.log(`🎯 POKER: All players finished betting - starting next betting round`);
      this.startNextBettingRound(game);
      return;
    }
    
    // ✅ POKER LOGIC: Znajdź następnego aktywnego gracza (nie zfoldowanego)
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE && 
      !p.hasFolded
    );
    
    if (activePlayers.length <= 1) {
      // Koniec rundy - tylko jeden gracz pozostał
      console.log(`🎯 POKER: Only ${activePlayers.length} active player(s) left - ending round`);
      game.state = GameState.ROUND_ENDED;
      this.determineWinners(game);
      this.broadcastGameState(game);
      return;
    }
    
    // Znajdź następnego gracza
    const currentIndex = activePlayers.findIndex(p => p.id === currentPlayer.id);
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    game.currentPlayerIndex = game.players.findIndex(p => p.id === activePlayers[nextIndex].id);
    
    const nextPlayer = game.players[game.currentPlayerIndex];
    game.currentTurnStartTime = Date.now();
    console.log(`🎯 Next player ${nextPlayer.seatNumber} turn started (with timeout)`);
    
    // Uruchom timer dla następnego gracza
    this.startMoveTimeout(game, nextPlayer);
  }

  private playDealerTurn(game: GameSession): void {
    // 🚫 POKER: Dealer doesn't play in poker
    console.log(`🎩 POKER: Dealer turn skipped - not used in poker`);
    return;
    
    console.log(`🎩 === DEALER'S TURN ===`);
    
    // Wyczyść currentPlayerIndex gdy zaczyna się tura dealera
    game.currentPlayerIndex = -1;
    console.log('🎩 Dealer turn started - cleared currentPlayerIndex');
    
    const dealer = game.players.find(p => p.isDealer)!;

    // Odkryj zakrytą kartę dealera
    dealer.hands.forEach(hand => hand.cards.forEach(card => card.isFaceUp = true));
    
    const dealerHandInstance = new Hand(dealer.hands[0].cards);
    const initialValue = dealerHandInstance.calculateValue();
    console.log(`🎩 Dealer reveals hand: [${this.formatHand(dealer.hands[0].cards)}] = ${initialValue}`);

    // Dealer dobiera karty dopóki nie ma co najmniej 17 punktów
    while (dealerHandInstance.calculateValue() < 17) {
      const currentValue = dealerHandInstance.calculateValue();
      console.log(`🎩 Dealer has ${currentValue}, needs to draw...`);
      console.log(`🎩 Current dealer cards: [${this.formatHand(dealer.hands[0].cards)}]`);
      console.log(`🎩 Cards before push:`, dealer.hands[0].cards.length);
      
      const card = this.drawCardFromGame(game);
      console.log(`🎩 About to add card: ${this.formatCard(card)}`);
      
      dealer.hands[0].cards.push(card);
      console.log(`🎩 Cards after push:`, dealer.hands[0].cards.length);
      
      // NIE dodawaj karty do dealerHandInstance - to powoduje duplikaty!
      // dealerHandInstance.addCard(card); // ← TO JEST PROBLEM!
      
      const newValue = dealerHandInstance.calculateValue();
      console.log(`🎩 Dealer draws ${this.formatCard(card)} → [${this.formatHand(dealer.hands[0].cards)}] = ${newValue}`);
      
      // Sprawdź czy nie przekroczył 21
      if (newValue > 21) {
        console.log(`💥 Dealer busted with ${newValue}!`);
        break;
      }
    }

    const finalValue = dealerHandInstance.calculateValue();
    if (finalValue > 21) {
      console.log(`💥 Dealer BUSTS with ${finalValue}!`);
    } else {
      console.log(`✅ Dealer stands with ${finalValue}`);
    }

    this.determineWinners(game);
    // ✅ NIE czyścimy timerów tutaj - determineWinners ustawia roundBreakTimer
    game.state = GameState.ROUND_ENDED;
    this.broadcastGameState(game);
  }

  private determineWinners(game: GameSession): void {
    console.log('🎯 POKER: Determining winners');

    // Wyczyść currentPlayerIndex podczas ogłaszania wyników
    game.currentPlayerIndex = -1;
    console.log('🏁 Results phase - cleared currentPlayerIndex');
    
    // Wyczyść wszystkie timery na końcu rundy
    this.clearGameStartTimer(game.id);
    game.players.forEach(player => {
      if (player.moveTimeoutId) {
        clearTimeout(player.moveTimeoutId);
        player.moveTimeoutId = undefined;
      }
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
      }
    });
    
    // Znajdź graczy którzy nie zfoldowali
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE && 
      !p.hasFolded
    );
    
    const pot = game.pot || 0;
    
    if (activePlayers.length === 0) {
      // Wszyscy zfoldowali - nie powinno się zdarzyć, ale zabezpieczenie
      console.log('🎯 All players folded - no winner');
      this.io.to(game.id).emit('notification', 'All players folded. No winner.');
    } else if (activePlayers.length === 1) {
      // Jeden gracz pozostał - wygrywa cały pot
      const winner = activePlayers[0];
      winner.balance += pot;
      winner.hands[0].result = HandResult.WIN; // Reuse existing enum
      
      console.log(`🏆 Player ${winner.seatNumber} wins $${pot} (last remaining)`);
      this.io.to(game.id).emit('notification', 
        `Player ${winner.seatNumber} wins $${pot}! All others folded.`);
        
      // Oznacz innych jako przegranych
      game.players.forEach(player => {
        if (!player.isDealer && player.hasFolded) {
          player.hands[0].result = HandResult.LOSE;
        }
      });
    } else {
      // Wielu graczy - na razie podziel pot równo (później: hand rankings)
      const winnings = Math.floor(pot / activePlayers.length);
      
      activePlayers.forEach(player => {
        player.balance += winnings;
        player.hands[0].result = HandResult.WIN; // Tie for now
      });
      
      console.log(`🏆 ${activePlayers.length} players split $${pot} ($${winnings} each)`);
      this.io.to(game.id).emit('notification', 
        `${activePlayers.length} players split the pot: $${winnings} each`);
    }

    // Reset pot
    game.pot = 0;

    // Po określeniu zwycięzców, sprawdź czy są gracze oczekujący na buy-in
    const playersAwaitingBuyIn = game.players.filter(p => 
      !p.isDealer && p.state === PlayerState.AWAITING_BUY_IN
    );
    
    if (playersAwaitingBuyIn.length > 0) {
      console.log(`💰 ${playersAwaitingBuyIn.length} players awaiting buy-in - they will be handled in next round`);
      this.io.to(game.id).emit('notification', 
        `Następna runda rozpocznie się za ${this.ROUND_BREAK_TIMEOUT / 1000} sekund...`
      );
    }
    
    // Jeśli nie ma graczy oczekujących na buy-in, uruchom następną rundę
    console.log(`⏸️ ROUND BREAK: ${this.ROUND_BREAK_TIMEOUT/1000}s break before next round`);
    
    // ✅ Wyczyść poprzedni round break timer jeśli istnieje
    this.clearRoundBreakTimer(game.id);
    
    const roundBreakTimer = setTimeout(() => {
      // 🔍 DEBUG - sprawdź stan graczy przed decyzją o następnej rundzie
      console.log(`🔍 DEBUG - Players check before next round:`);
      game.players.forEach(p => {
        console.log(`  Player ${p.isDealer ? 'DEALER' : p.seatNumber}: state=${p.state}, id=${p.id}`);
      });

      // Sprawdź czy gracze nadal istnieją w grze
      game.players = game.players.filter(p => p !== undefined);
      console.log(`🔍 Players after filtering undefined: ${game.players.length}`);

      // Sprawdź czy są gracze przy stole (niezależnie od stanu)
      const totalPlayers = game.players.filter(p => !p.isDealer).length;
      console.log(`🔍 Players at table found: ${totalPlayers}`);
      
      if (totalPlayers > 0) {
        // ✅ Ciągłe rundy - krótka przerwa między rundami
        console.log(`🔄 Round break finished - starting new round`);
        this.io.to(game.id).emit('notification', 
          `Następna runda rozpocznie się za ${this.ROUND_BREAK_TIMEOUT / 1000} sekund...`);
        this.startRound(game.id);
      } else {
        console.log(`⏳ No players left - waiting for players`);
        // ✅ WYCZYŚĆ TIMERY PRZED ZMIANĄ STANU
        this.clearAllTimers(game);
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Oczekiwanie na graczy...');
      }
      
      // ✅ Usuń timer z mapy po wykonaniu
      this.roundBreakTimers.delete(game.id);
    }, this.ROUND_BREAK_TIMEOUT); // 5 sekund przerwy
    
    // ✅ Zapisz timer w mapie
    this.roundBreakTimers.set(game.id, roundBreakTimer);
    console.log(`🔍 DEBUG determineWinners: Round break timer set for game ${game.id} (${this.ROUND_BREAK_TIMEOUT/1000}s)`);
  }

  // Pomocnicza metoda do określania wartości karty
  private getCardValue(card: Card): number {
    if (card.rank === 'ACE') return 11;
    if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) return 10;
    return parseInt(card.rank);
  }



  // Dodaj metodę do aktualizacji czasu ostatniej aktywności gracza
  private updatePlayerActivity(playerId: string, gameId: string) {
    const game = this.getGame(gameId);
    if (!game) return;

    const player = this.findPlayer(game, playerId);
    if (player && !player.isDealer) {
      const oldActivity = (player as any).lastActivity;
      (player as any).lastActivity = Date.now();
      console.log(`🔄 Updated activity for player ${player.seatNumber}: ${oldActivity} → ${(player as any).lastActivity}`);
    }
  }

  // Nowa metoda do usuwania nieaktywnych graczy z wysłaniem eventu
  private async removeInactivePlayer(player: Player, gameId: string) {
    console.log(`🚨 Removing inactive player ${player.id} from game ${gameId}`);
    
    // ✅ WYCZYŚĆ wszystkie timeouty tego gracza PRZED usunięciem
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
      console.log(`🧹 Cleared move timeout for removed player ${player.id}`);
    }
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
      console.log(`🧹 Cleared bet timeout for removed player ${player.id}`);
    }
    if (player.betIntervalId) {
      clearInterval(player.betIntervalId);
      player.betIntervalId = undefined;
      console.log(`🧹 Cleared bet interval for removed player ${player.id}`);
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
      console.log(`🧹 Cleared move interval for removed player ${player.id}`);
    }
    // Buy-in timer jest zintegrowany z timerem zakładów
    
    // Znajdź socket tego gracza w room i wyślij event
    try {
      const sockets = await this.io.in(gameId).fetchSockets();
      const playerSocket = sockets.find((s: RemoteSocket<ServerToClientEvents, SocketData>) => s.data.playerId === player.id);
      
      if (playerSocket) {
        console.log(`📡 Sending kicked_for_inactivity to socket ${playerSocket.id} for player ${player.id}`);
        playerSocket.emit('kicked_for_inactivity', {
          reason: 'Brak aktywności przez 3 minuty',
          canRejoin: true,
          gameId: gameId
        });
      } else {
        console.log(`⚠️ Socket not found for player ${player.id} in game ${gameId}`);
      }
    } catch (error) {
      console.error(`❌ Error sending kicked_for_inactivity to player ${player.id}:`, error);
    }
    
    // Usuń z gry
    this.leaveGame(gameId, player.id);
  }

  // Nowa metoda do usuwania pustej gry z wysłaniem eventu
  private removeEmptyGame(gameId: string) {
    console.log(`🏁 Removing empty game ${gameId}`);
    
    // Powiadom wszystkich w room że gra się kończy
    this.io.to(gameId).emit('gameEnded', {
      reason: 'Brak aktywnych graczy',
      shouldReturnToLobby: true,
      clearSeats: true
    });
    
    // ✅ Wyczyść wszystkie timery przed usunięciem gry
    const game = this.getGame(gameId);
    if (game) {
      this.clearAllTimers(game);
    }
    
    // Usuń grę
    this.games.delete(gameId);
  }

  // System czyszczenia nieaktywnych graczy
  private cleanupDisconnectedPlayers() {
    const now = Date.now();
    
    this.games.forEach((game, gameId) => {
      const playersToRemove: string[] = [];
      
      // 🔍 DEBUG - sprawdź wszystkich graczy przed cleanup
      console.log(`🔍 DEBUG - Cleanup check for game ${gameId}:`);
      game.players.forEach(player => {
        if (!player.isDealer) {
          const lastActivity = (player as any).lastActivity || now;
          const timeSinceActivity = now - lastActivity;
          
          console.log(`  Player ${player.seatNumber}: lastActivity=${lastActivity}, timeSince=${timeSinceActivity}ms, timeout=${this.PLAYER_TIMEOUT}ms`);
          
          // Usuń graczy nieaktywnych przez więcej niż 3 minuty
          if (timeSinceActivity > this.PLAYER_TIMEOUT) {
            console.log(`🚨 Removing inactive player ${player.id} (seat ${player.seatNumber}) from game ${gameId}`);
            playersToRemove.push(player.id);
          }
        }
      });

      // Usuń nieaktywnych graczy
      playersToRemove.forEach(async (playerId) => {
        const player = game.players.find(p => p.id === playerId);
        if (player) {
          await this.removeInactivePlayer(player, gameId);
        }
      });

      // Usuń puste gry (bez graczy, tylko dealer) - ale nie główny stół
      const activePlayers = game.players.filter(p => !p.isDealer && p.state !== PlayerState.SITTING_OUT);
      if (activePlayers.length === 0 && game.state === GameState.WAITING_FOR_PLAYERS && gameId !== 'main-blackjack-table') {
        console.log(`Removing empty game ${gameId}`);
        this.removeEmptyGame(gameId);
      } else if (activePlayers.length === 0 && game.state === GameState.WAITING_FOR_PLAYERS && gameId === 'main-blackjack-table') {
        console.log(`🏁 Keeping main blackjack table ${gameId} even though empty`);
      }
    });
  }

  // Nowa metoda do czyszczenia wszystkich timerów gry
  private clearAllTimers(game: GameSession): void {
    console.log(`🧹 Clearing all timers for game ${game.id} (state: ${game.state})`);
    
    // Wyczyść timery startowe
    this.clearGameStartTimer(game.id);
    
    // ✅ Wyczyść round break timer
    this.clearRoundBreakTimer(game.id);
    
    // 🚫 LEGACY: Globalne timery zakładów - nie używane w pokerze
    
    // ✅ Wyczyść buy-in timery
    let buyInTimersCleared = 0;
    
    // Wyczyść wszystkie timeouty i interwały graczy
    let playerTimersCleared = 0;
    game.players.forEach(player => {
      if (player.betTimeoutId) {
        clearTimeout(player.betTimeoutId);
        player.betTimeoutId = undefined;
        console.log(`🧹 Cleared bet timeout for player ${player.id}`);
        playerTimersCleared++;
      }
      if (player.betIntervalId) {
        clearInterval(player.betIntervalId);
        player.betIntervalId = undefined;
        console.log(`🧹 Cleared bet interval for player ${player.id}`);
        playerTimersCleared++;
      }
      if (player.moveTimeoutId) {
        clearTimeout(player.moveTimeoutId);
        player.moveTimeoutId = undefined;
        console.log(`🧹 Cleared move timeout for player ${player.id}`);
        playerTimersCleared++;
      }
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
        console.log(`🧹 Cleared move interval for player ${player.id}`);
        playerTimersCleared++;
      }
      // ✅ Wyczyść timer buy-in
      if ((player as any).buyInTimer) {
        clearTimeout((player as any).buyInTimer);
        (player as any).buyInTimer = undefined;
        console.log(`🧹 Cleared buy-in timer for player ${player.id}`);
        buyInTimersCleared++;
      }
    });
    
    console.log(`🧹 clearAllTimers summary: ${buyInTimersCleared} buy-in timers, ${playerTimersCleared} player timers cleared`);
  }

  // Sprawdź graczy z zerowym balansem na początku rundy i uruchom buy-in
  private checkPlayersForBuyIn(game: GameSession): void {
    const playersWithoutMoney = game.players.filter(p => 
      !p.isDealer && p.balance === 0 && p.state !== PlayerState.AWAITING_BUY_IN
    );

    console.log(`💰 Checking players for buy-in at round start: ${playersWithoutMoney.length} players with zero balance`);

    playersWithoutMoney.forEach(player => {
      console.log(`💰 Player ${player.seatNumber} needs buy-in (balance: $${player.balance})`);
      
      // Zmień stan gracza na AWAITING_BUY_IN
      player.state = PlayerState.AWAITING_BUY_IN;
      
      // Send buy-in event ONLY to this specific player
      this.sendBuyInToPlayer(game, player);
      
      this.io.to(game.id).emit('notification', 
        `Player in seat ${player.seatNumber} needs to buy chips.`
      );
    });
    
    // 🚫 LEGACY: Sprawdzanie betting phase - nie używane w pokerze
  }

  // Nowa metoda do wysyłania buy-in tylko do konkretnego gracza
  private async sendBuyInToPlayer(game: GameSession, player: Player): Promise<void> {
    try {
      const sockets = await this.io.in(game.id).fetchSockets();
      const playerSocket = sockets.find((s: RemoteSocket<ServerToClientEvents, SocketData>) => s.data.playerId === player.id);
      
      if (playerSocket) {
        console.log(`💰 Sending buy-in request to player ${player.seatNumber} (socket: ${playerSocket.id})`);
        playerSocket.emit('buyInRequired', {
          message: 'Your balance is 0. Buy chips or leave the table.',
          timeout: 30000, // 30 sekund na buy-in
          minBuyIn: this.MIN_BUY_IN,
          gameId: game.id
        });
        
        // Timer buy-in jest obsługiwany osobno przez startBuyInTimeout
        console.log(`💰 Buy-in request sent to player ${player.seatNumber} - timer handled separately`);
      } else {
        console.log(`⚠️ Socket not found for player ${player.seatNumber} - cannot send buy-in request`);
      }
    } catch (error) {
      console.error(`❌ Error sending buy-in to player ${player.seatNumber}:`, error);
    }
  }

  // Nowa metoda do wysyłania potwierdzenia buy-in tylko do konkretnego gracza
  private async sendBuyInConfirmedToPlayer(game: GameSession, player: Player, amount: number): Promise<void> {
    try {
      const sockets = await this.io.in(game.id).fetchSockets();
      const playerSocket = sockets.find((s: RemoteSocket<ServerToClientEvents, SocketData>) => s.data.playerId === player.id);
      
      if (playerSocket) {
        console.log(`✅ Sending buy-in confirmation to player ${player.seatNumber} (socket: ${playerSocket.id})`);
        playerSocket.emit('buyInConfirmed', {
          newBalance: player.balance,
          buyInAmount: amount
        });
        
        console.log(`✅ Buy-in confirmation sent to player ${player.seatNumber}`);
      } else {
        console.log(`⚠️ Socket not found for player ${player.seatNumber} - cannot send buy-in confirmation`);
      }
    } catch (error) {
      console.error(`❌ Error sending buy-in confirmation to player ${player.seatNumber}:`, error);
    }
  }





  // Wyczyść timer round break
  private clearRoundBreakTimer(gameId: string): void {
    const timer = this.roundBreakTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.roundBreakTimers.delete(gameId);
      console.log(`🧹 Cleared round break timer for game ${gameId}`);
    } else {
      console.log(`🔍 No round break timer found for game ${gameId}`);
    }
  }

  // Obsługa buy-in request od gracza
  public handleBuyInRequest(gameId: string, playerId: string, amount: number): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');
    
    if (player.state !== PlayerState.AWAITING_BUY_IN) {
      throw new Error('Player is not awaiting buy-in');
    }
    
    if (amount < this.MIN_BUY_IN) {
      throw new Error(`Minimum buy-in is $${this.MIN_BUY_IN}`);
    }
    
    // Dodaj środki do balansu gracza
    player.balance += amount;
    player.state = PlayerState.ACTIVE;
    
    // Timer buy-in jest już zintegrowany z timerem zakładów - nie trzeba go czyścić osobno
    
    console.log(`💰 Player ${player.seatNumber} bought in $${amount} (new balance: $${player.balance})`);
    
    // Powiadom tylko konkretnego gracza o potwierdzeniu
    this.sendBuyInConfirmedToPlayer(game, player, amount);
    
    this.io.to(gameId).emit('notification', 
      `Player in seat ${player.seatNumber} bought chips for $${amount}.`
    );
    
    // 🚫 LEGACY: Betting phase logic - nie używane w pokerze
    if (game.state !== GameState.ROUND_ENDED && game.state !== GameState.WAITING_FOR_PLAYERS) {
      // Jeśli gra już trwa (karty są rozdane), gracz będzie obserwował do następnej rundy
      player.state = PlayerState.OBSERVING;
      console.log(`👁️ Player ${player.seatNumber} bought in during active round - will observe until next round`);
      this.io.to(gameId).emit('notification', 
        `Player in seat ${player.seatNumber} bought chips and will join the next round.`
      );
    }
    
    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Obsługa odmowy buy-in (opuszczenie gry)
  public handleBuyInDecline(gameId: string, playerId: string): void {
    const game = this.getGame(gameId);
    if (!game) {
      console.warn('Game not found:', gameId);
      return;
    }
    
    const player = this.findPlayer(game, playerId);
    if (!player) {
      console.warn('Player not found:', playerId);
      return;
    }
    
    console.log(`🚪 Player ${player.seatNumber} declined buy-in - leaving game`);
    
    // Timer buy-in jest już zintegrowany z timerem zakładów - nie trzeba go czyścić osobno
    
    // Opuść grę
    this.leaveGame(gameId, playerId);
    
    this.io.to(gameId).emit('notification', 
      `Player in seat ${player.seatNumber} left the table.`
    );
    
    // 🚫 LEGACY: Betting phase logic - nie używane w pokerze
  }
}
