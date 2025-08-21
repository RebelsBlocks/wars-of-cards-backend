import { GameState, PlayerMove, GameSession, Player, Card, Hand, PlayerState } from '../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../types/socket';
import { v4 as uuidv4 } from 'uuid';

// Typ dla stanu gry wysyłanego do klienta (z occupiedSeats jako array)
type GameStateForClient = Omit<GameSession, 'occupiedSeats'> & {
  occupiedSeats: number[];
};

export class GameService {
  private games: Map<string, GameSession> = new Map();

  // Helper function to format card for logging
  private formatCard(card: Card): string {
    const suitSymbols: Record<string, string> = {
      'HEARTS': '♥️',
      'DIAMONDS': '♦️',
      'CLUBS': '♣️',
      'SPADES': '♠️'
    };
    const rankDisplay: Record<string, string> = {
      'ACE': 'A',
      'JACK': 'J',
      'QUEEN': 'Q',
      'KING': 'K'
    };
    const rank = rankDisplay[card.rank] || card.rank;
    const suit = suitSymbols[card.suit] || card.suit;
    return `${rank}${suit}`;
  }

  // Helper function to format hand for logging
  private formatHand(cards: Card[]): string {
    return cards.map(card => this.formatCard(card)).join(', ');
  }
  private gameStartTimers: Map<string, NodeJS.Timeout> = new Map(); // Mapa timerów startowych dla każdej gry
  private readonly MAX_PLAYERS = 3; // Maksymalna liczba graczy przy stole (nie licząc dealera)
  private readonly MOVE_TIMEOUT = 30000;  // 30 sekund na ruch
  private readonly BET_TIMEOUT = 45000;   // 45 sekund na postawienie zakładu
  private readonly GAME_START_TIMEOUT = 20000; // 20 sekund na start gry (skrócone)
  private readonly ROUND_BREAK_TIMEOUT = 5000; // 5 sekund przerwy między rundami
  private readonly TIME_UPDATE_INTERVAL = 1000; // Co ile ms wysyłać aktualizacje czasu
  private readonly PLAYER_TIMEOUT = 60000; // 60 sekund na usunięcie nieaktywnego gracza

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    // Uruchom czyszczenie co 60 sekund (zmniejszona częstotliwość)
    setInterval(() => {
      this.cleanupDisconnectedPlayers();
    }, 60000);
  }

  // Tworzenie nowej gry
  public createGame(): GameSession {
    const gameId = uuidv4();
    const dealer: Player = {
      id: 'dealer',
      hands: [{
        cards: [],
      bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false
      }],
      balance: 0,
      isDealer: true
    };

    const newGame: GameSession = {
      id: gameId,
      state: GameState.WAITING_FOR_PLAYERS,
      players: [dealer],
      currentPlayerIndex: 0,
      deck: this.createNewDeck(),
      insuranceAvailable: false,
      insurancePhase: false,
      occupiedSeats: new Set()
    };

    this.games.set(gameId, newGame);
    this.broadcastGameState(newGame);
    return newGame;
  }

  // Dołączanie gracza do gry
  public joinGame(gameId: string, seatNumber: number, initialBalance: number = 1000): Player {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');

    // Sprawdzenie czy miejsce jest już zajęte
    if (game.occupiedSeats.has(seatNumber)) {
      throw new Error(`Miejsce ${seatNumber} jest już zajęte`);
    }

    // Sprawdzenie czy numer miejsca jest prawidłowy
    if (seatNumber < 1 || seatNumber > this.MAX_PLAYERS) {
      throw new Error(`Nieprawidłowy numer miejsca. Dozwolone: 1-${this.MAX_PLAYERS}`);
    }

    // Sprawdzenie liczby graczy (nie licząc dealera)
    const playerCount = game.players.filter(p => !p.isDealer).length;
    if (playerCount >= this.MAX_PLAYERS) {
      throw new Error(`Stół jest pełny. Maksymalna liczba graczy: ${this.MAX_PLAYERS}`);
    }

    // Określ stan gracza w zależności od stanu gry
    let playerState = PlayerState.ACTIVE;
    if (game.state === GameState.PLAYER_TURN || 
        game.state === GameState.DEALER_TURN || 
        game.state === GameState.BETTING) {
      playerState = PlayerState.WAITING_FOR_NEXT_ROUND;
    }

    const player: Player = {
      id: uuidv4(),
      hands: [{
        cards: [],
      bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false
      }],
      balance: initialBalance,
      isDealer: false,
      seatNumber: seatNumber,
      currentHandIndex: 0,
      state: playerState
    };

    // Dodaj znacznik czasu aktywności
    (player as any).lastActivity = Date.now();

    game.players.push(player);
    game.occupiedSeats.add(seatNumber);

    // Jeśli to pierwszy gracz i gra czeka na graczy, rozpocznij odliczanie
    if (playerCount === 0 && game.state === GameState.WAITING_FOR_PLAYERS) {
      this.startGameCountdown(game);
    }

    this.broadcastGameState(game);
    
    if (playerState === PlayerState.WAITING_FOR_NEXT_ROUND) {
      this.io.to(gameId).emit('notification', 
        `Gracz dołączył do miejsca ${seatNumber}. Zagra w następnej rundzie.`);
    } else {
      this.io.to(gameId).emit('notification', `Gracz dołączył do miejsca ${seatNumber}.`);
    }
    
    return player;
  }

  // Rozpoczęcie nowej rundy
  public startRound(gameId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    // Wyczyść wszystkie timery przed rozpoczęciem nowej rundy
    this.clearAllTimers(game);
    
    game.state = GameState.BETTING;
    game.deck = this.createNewDeck();
    
    // Aktywuj wszystkich graczy którzy czekali na rundę
    game.players.forEach(player => {
      if (!player.isDealer && player.state === PlayerState.WAITING_FOR_NEXT_ROUND) {
        player.state = PlayerState.ACTIVE;
        this.io.to(gameId).emit('notification', 
          `Gracz z miejsca ${player.seatNumber} dołącza do gry!`);
      }
      
      // Reset dla wszystkich graczy (włącznie z krupierem)
      if (player.isDealer) {
        // Czyść ręce krupiera
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false
        }];
        console.log(`🧹 Dealer hands cleared for new round`);
      } else if (player.state === PlayerState.ACTIVE) {
        // Reset tylko dla aktywnych graczy
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false
        }];
        player.currentHandIndex = 0;
        console.log(`🧹 Player ${player.seatNumber} hands cleared for new round`);
      }
    });

    // Wyślij stan bez timeoutów
    this.broadcastGameState(game);
    
    // Ustaw timeouty na zakłady z krótkim opóźnieniem
    setTimeout(() => {
      const activePlayers = game.players.filter(p => !p.isDealer && p.state === PlayerState.ACTIVE);
      activePlayers.forEach(player => this.startBetTimeout(game, player));
      console.log(`⏰ Bet timeouts started for ${activePlayers.length} players`);
    }, 2000); // 2 sekundy opóźnienia przed rozpoczęciem timeoutów
    
    return game;
  }

  // Postawienie zakładu
  public placeBet(gameId: string, playerId: string, amount: number): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');
    
    if (player.balance < amount) throw new Error('Niewystarczające środki');
    
    if (game.state !== GameState.BETTING) {
      throw new Error('Zakłady są obecnie niedozwolone');
    }
    
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
    }
    if (player.betIntervalId) {
      clearInterval(player.betIntervalId);
      player.betIntervalId = undefined;
      console.log(`🧹 Cleared bet interval for player ${player.id} who placed bet`);
    }
    
    player.hands[0].bet = amount;
    player.balance -= amount;

    console.log(`💰 BET: Player ${player.seatNumber} bets $${amount} (balance: $${player.balance})`);

    // Sprawdź czy wszyscy aktywni gracze postawili zakłady
    const activePlayers = game.players.filter(p => !p.isDealer && p.state === PlayerState.ACTIVE);
    const allBetsPlaced = activePlayers.every(p => p.hands.every(hand => hand.bet > 0));

    if (allBetsPlaced) {
      console.log(`🎲 All bets placed! Starting card dealing...`);
      
      // Wyczyść wszystkie bet timeouty i interwały
      activePlayers.forEach(p => {
        if (p.betTimeoutId) {
          clearTimeout(p.betTimeoutId);
          p.betTimeoutId = undefined;
        }
        if (p.betIntervalId) {
          clearInterval(p.betIntervalId);
          p.betIntervalId = undefined;
          console.log(`🧹 Cleared bet interval for player ${p.id} (all bets placed)`);
        }
      });
      
      // Przejście do stanu rozdawania kart z krótkim opóźnieniem
      game.state = GameState.DEALING_INITIAL_CARDS;
      this.broadcastGameState(game);
      
      // Krótka pauza przed rozdaniem kart i rozpoczęciem tury
      setTimeout(() => {
        this.dealInitialCards(game);
        game.state = GameState.PLAYER_TURN;
        game.currentTurnStartTime = Date.now();
        
        // Nie startuj timeout dla ruchów - tylko dla zakładów
        const firstPlayer = game.players[game.currentPlayerIndex];
        console.log(`🎯 First player ${firstPlayer?.id} turn started (no timeout)`);
        // this.startMoveTimeout(game, firstPlayer); // WYŁĄCZONE
        
        this.broadcastGameState(game);
      }, 2000); // 2 sekundy przerwy
    }

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Proces dobierania karty (hit)
  public processHit(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Niedozwolony ruch w tym momencie gry');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const card = this.drawCard(game);
    const handIndex = player.currentHandIndex || 0;
    player.hands[handIndex].cards.push(card);

    const newHandValue = this.calculateHandValue(player.hands[handIndex].cards);
    const oldHand = this.formatHand(player.hands[handIndex].cards.slice(0, -1)); // Hand before hit
    
    console.log(`🎯 HIT: Player ${player.seatNumber} draws ${this.formatCard(card)}`);
    console.log(`   Previous hand: [${oldHand}]`);
    console.log(`   New hand: [${this.formatHand(player.hands[handIndex].cards)}] = ${newHandValue}`);

    game.lastMoveTime = Date.now();

    if (newHandValue > 21) {
      console.log(`💥 BUST! Player ${player.seatNumber} went over 21 with ${newHandValue}`);
      this.nextPlayer(game);
    } else {
      console.log(`✅ Player ${player.seatNumber} is safe with ${newHandValue}`);
      // Nie startuj timeoutu - tylko manual ruchy
      console.log(`✅ Player ${player.seatNumber} can continue (no timeout)`);
    }

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Proces zatrzymania się (stand)
  public processStand(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const handIndex = player.currentHandIndex || 0;
    const handValue = this.calculateHandValue(player.hands[handIndex].cards);
    
    console.log(`🛑 STAND: Player ${player.seatNumber} stands with ${handValue}`);
    console.log(`   Final hand: [${this.formatHand(player.hands[handIndex].cards)}]`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Proces podwojenia zakładu (double)
  public processDouble(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const handIndex = player.currentHandIndex || 0;
    const currentHand = player.hands[handIndex];
    
    if (currentHand.cards.length !== 2) {
      throw new Error('Podwojenie możliwe tylko z pierwszymi dwoma kartami');
    }
    
    if (player.balance < currentHand.bet) {
      throw new Error('Niewystarczające środki na podwojenie');
    }

    // Podwój zakład
    player.balance -= currentHand.bet;
    currentHand.bet *= 2;
    currentHand.hasDoubled = true;

    // Dobierz jedną kartę
    const card = this.drawCard(game);
    currentHand.cards.push(card);

    const handValue = this.calculateHandValue(currentHand.cards);
    
    console.log(`💰 DOUBLE: Player ${player.seatNumber} doubles to $${currentHand.bet}`);
    console.log(`   Draws: ${this.formatCard(card)}`);
    console.log(`   Final hand: [${this.formatHand(currentHand.cards)}] = ${handValue}`);

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Proces dzielenia kart (split)
  public processSplit(gameId: string, playerId: string): any {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    if (player.state !== PlayerState.ACTIVE) throw new Error('Gracz nie jest aktywny w tej rundzie');

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const handIndex = player.currentHandIndex || 0;
    const currentHand = player.hands[handIndex];
    
    if (currentHand.cards.length !== 2) {
      throw new Error('Split możliwy tylko z pierwszymi dwoma kartami');
    }
    
    const firstCard = currentHand.cards[0];
    const secondCard = currentHand.cards[1];
    
    if (firstCard.rank !== secondCard.rank) {
      throw new Error('Split możliwy tylko z kartami o tej samej wartości');
    }
    
    if (player.balance < currentHand.bet) {
      throw new Error('Niewystarczające środki na split');
    }

    // Utwórz nową rękę
    const newHand: Hand = {
      cards: [secondCard],
      bet: currentHand.bet,
      isFinished: false,
      hasDoubled: false,
      hasSplit: true
    };

    // Zmodyfikuj obecną rękę
    currentHand.cards = [firstCard];
    currentHand.hasSplit = true;
    
    // Dodaj nową rękę
    player.hands.push(newHand);
    
    // Pobierz zakład za nową rękę
    player.balance -= currentHand.bet;

    // Dobierz karty dla obu rąk
    currentHand.cards.push(this.drawCard(game));
    newHand.cards.push(this.drawCard(game));

    console.log(`✂️ SPLIT: Player ${player.seatNumber} splits ${this.formatCard(firstCard)} / ${this.formatCard(secondCard)}`);
    console.log(`   Hand 1: [${this.formatHand(currentHand.cards)}]`);
    console.log(`   Hand 2: [${this.formatHand(newHand.cards)}]`);

    game.lastMoveTime = Date.now();
    // Nie startuj timeoutu po splicie - manual play  
    console.log(`✂️ Player ${player.seatNumber} split completed (no timeout)`);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // Pobranie stanu gry
  public getGameState(gameId: string): GameSession | null {
    const game = this.getGame(gameId);
    return game || null;
  }

  // Znajdź dostępną grę z wolnymi miejscami
  public findAvailableGame(): GameSession | null {
    console.log(`Searching for available games among ${this.games.size} total games`);
    
    for (const game of this.games.values()) {
      const playerCount = game.players.filter(p => !p.isDealer).length;
      console.log(`Game ${game.id}: state=${game.state}, players=${playerCount}/${this.MAX_PLAYERS}`);
      
      // ✅ Pozwól dołączać ZAWSZE gdy jest miejsce (niezależnie od stanu gry)
      if (playerCount < this.MAX_PLAYERS) {
        console.log(`Found available game: ${game.id} with ${playerCount} players`);
        return game; // Znaleziono grę z wolnymi miejscami
      }
    }
    
    console.log('No available games found');
    return null; // Brak dostępnych gier
  }

  // Pobranie informacji o liczbie graczy
  public getPlayerCount(gameId: string): { current: number; maximum: number } {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');

    const currentPlayers = game.players.filter(p => !p.isDealer).length;
    return {
      current: currentPlayers,
      maximum: this.MAX_PLAYERS
    };
  }

  // Nowe metody do obsługi timeoutów

  private startBetTimeout(game: GameSession, player: Player): void {
    // Wyczyść stary timeout i interval jeśli istnieją
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
      console.log(`🧹 Cleared old bet timeout for player ${player.id}`);
    }
    if (player.betIntervalId) {
      clearInterval(player.betIntervalId);
      player.betIntervalId = undefined;
      console.log(`🧹 Cleared old bet interval for player ${player.id}`);
    }
    
    const startTime = Date.now();
    
    // Ustaw interwał do aktualizacji pozostałego czasu
    player.betIntervalId = setInterval(() => {
      const remainingTime = this.BET_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        // Log co 10 sekund
        if (remainingTime % 10000 < 1000) {
          console.log(`💰 Betting time: ${Math.ceil(remainingTime/1000)}s remaining (Player ${player.id})`);
        }
        this.io.to(game.id).emit('timeUpdate', {
          type: 'bet',
          playerId: player.id,
          remainingTime,
          totalTime: this.BET_TIMEOUT
        });
      } else {
        clearInterval(player.betIntervalId);
        player.betIntervalId = undefined;
      }
    }, this.TIME_UPDATE_INTERVAL);

    player.betTimeoutId = setTimeout(() => {
      clearInterval(player.betIntervalId);
      player.betIntervalId = undefined;
      console.log(`⏰ BET TIMEOUT EXPIRED for player ${player.id}`);
      // Jeśli gracz nie postawił zakładu, automatycznie postaw minimalny zakład
      if (player.hands.every(hand => hand.bet === 0) && game.state === GameState.BETTING) {
        const minBet = 10; // Minimalny zakład
        if (player.balance >= minBet) {
          console.log(`💰 Auto-betting ${minBet} for player ${player.id}`);
          this.placeBet(game.id, player.id, minBet);
          this.io.to(game.id).emit('notification', 
            `Gracz ${player.id} nie postawił zakładu w czasie. Automatycznie postawiono minimalny zakład.`
          );
        } else {
          console.log(`💸 Player ${player.id} removed - insufficient funds`);
          // Jeśli gracz nie ma wystarczających środków, usuń go z gry
          game.players = game.players.filter(p => p.id !== player.id);
          this.io.to(game.id).emit('notification', 
            `Gracz ${player.id} został usunięty z gry z powodu braku środków.`
          );
        }
      }
    }, this.BET_TIMEOUT);
    
    console.log(`⏰ Bet timeout started for player ${player.id} (${this.BET_TIMEOUT/1000}s)`);
  }

  private startMoveTimeout(game: GameSession, player: Player): void {
    console.log(`🚨 ALERT: startMoveTimeout called for player ${player.id} - should be disabled!`);
    // Wyczyść stary timeout jeśli istnieje
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
      console.log(`🧹 Cleared old move timeout for player ${player.id}`);
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
        this.io.to(game.id).emit('timeUpdate', {
          type: 'move',
          playerId: player.id,
          remainingTime,
          totalTime: this.MOVE_TIMEOUT
        });
      } else {
        clearInterval(updateInterval);
      }
    }, this.TIME_UPDATE_INTERVAL);

    player.moveTimeoutId = setTimeout(() => {
      clearInterval(updateInterval);
      if (game.state === GameState.PLAYER_TURN) {
        console.log(`⏰ Move timeout for player ${player.id} - auto STAND`);
        this.io.to(game.id).emit('notification', 
          `Czas na ruch gracza ${player.id} upłynął. Automatycznie wykonano STAND.`
        );
        this.processStand(game.id, player.id);
      }
    }, this.MOVE_TIMEOUT);
    
    console.log(`⏰ Move timeout started for player ${player.id} (${this.MOVE_TIMEOUT/1000}s)`);
  }

  // Nowa metoda do obsługi odliczania do startu gry
  private startGameCountdown(game: GameSession): void {
    // Anuluj poprzedni timer jeśli istnieje
    this.clearGameStartTimer(game.id);
    
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
      clearInterval(updateInterval);
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

    // Zapisz timer w mapie
    this.gameStartTimers.set(game.id, gameStartTimer);
  }

  // Metoda do anulowania timera startowego
  private clearGameStartTimer(gameId: string): void {
    const timer = this.gameStartTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.gameStartTimers.delete(gameId);
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
    
    // Usuń gracza z listy
    game.players.splice(playerIndex, 1);
    
    // Zwolnij miejsce
    if (player.seatNumber) {
      game.occupiedSeats.delete(player.seatNumber);
    }

    // Wyczyść timeouty
    if (player.moveTimeoutId) clearTimeout(player.moveTimeoutId);
    if (player.betTimeoutId) clearTimeout(player.betTimeoutId);

    // Sprawdź czy to był ostatni gracz (nie licząc dealera)
    const remainingPlayers = game.players.filter(p => !p.isDealer).length;
    if (remainingPlayers === 0) {
      // Anuluj timer startowy jeśli istnieje
      this.clearGameStartTimer(game.id);
      
      // Resetuj stan gry do oczekiwania na graczy
      if (game.state !== GameState.WAITING_FOR_PLAYERS) {
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(gameId).emit('notification', 'Wszyscy gracze opuścili stół. Oczekiwanie na nowych graczy...');
      }
    }

    // Powiadom innych graczy
    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz opuścił miejsce ${player.seatNumber || 'nieznane'}.`);
  }

  // Metoda do broadcastowania stanu gry
  private broadcastGameState(game: GameSession): void {
    if (!this.io) return;
    
    const cleanGame = this.cleanGameStateForClient(game);
    this.io.to(game.id).emit('gameState', cleanGame);
  }

  // Dodaj tę metodę do klasy GameService
  private cleanGameStateForClient(game: GameSession): any {
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

    return cleanGame;
  }

  // Prywatne metody pomocnicze

  private getGame(gameId: string): GameSession | undefined {
    return this.games.get(gameId);
  }

  private findPlayer(game: GameSession, playerId: string): Player | undefined {
    return game.players.find(p => p.id === playerId);
  }

  private createNewDeck(): Card[] {
    const suits = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'] as const;
    const ranks = ['ACE', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING'] as const;
    
    const deck: Card[] = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, isFaceUp: false });
      }
    }

    return this.shuffleDeck(deck);
  }

  private shuffleDeck(deck: Card[]): Card[] {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private drawCard(game: GameSession): Card {
    if (game.deck.length === 0) {
      console.log('🔄 Deck empty, creating new shuffled deck');
      game.deck = this.createNewDeck();
    }
    const card = game.deck.pop();
    if (!card) throw new Error('Brak kart w talii');
    card.isFaceUp = true;
    
    // Optional: Uncomment for very detailed card tracking
    // console.log(`🃏 Drew card: ${this.formatCard(card)} (${game.deck.length} cards remaining)`);
    
    return card;
  }

  private dealInitialCards(game: GameSession): void {
    console.log(`🃏 === DEALING INITIAL CARDS FOR GAME ${game.id} ===`);
    
    // Pobierz tylko aktywnych graczy (plus dealer)
    const activePlayers = game.players.filter(p => p.isDealer || p.state === PlayerState.ACTIVE);
    console.log(`👥 Active players in game: ${activePlayers.length} (including dealer)`);
    
    // DODATKOWE ZABEZPIECZENIE: Upewnij się, że wszystkie ręce są puste
    activePlayers.forEach(player => {
      if (player.hands[0].cards.length > 0) {
        console.log(`⚠️ WARNING: Player ${player.isDealer ? 'Dealer' : player.seatNumber} had ${player.hands[0].cards.length} cards, clearing...`);
        player.hands[0].cards = [];
      }
    });
    
    // Pierwsza runda rozdawania
    console.log(`📤 First round of dealing:`);
    for (const player of activePlayers) {
      const card = this.drawCard(game);
      player.hands[0].cards.push(card);
      
      if (player.isDealer) {
        console.log(`🎩 Dealer gets: ${this.formatCard(card)} (face up)`);
      } else {
        console.log(`🪑 Player ${player.seatNumber} gets: ${this.formatCard(card)} (face up)`);
      }
    }

    // Druga runda rozdawania
    console.log(`📤 Second round of dealing:`);
    for (const player of activePlayers) {
      const card = this.drawCard(game);
      if (player.isDealer) {
        card.isFaceUp = false; // Druga karta dealera zakryta
        console.log(`🎩 Dealer gets: ${this.formatCard(card)} (FACE DOWN)`);
      } else {
        console.log(`🪑 Player ${player.seatNumber} gets: ${this.formatCard(card)} (face up)`);
      }
      player.hands[0].cards.push(card);
    }

    // Show final hands
    console.log(`🃏 === FINAL INITIAL HANDS ===`);
    for (const player of activePlayers) {
      if (player.isDealer) {
        const visibleCards = player.hands[0].cards.filter(card => card.isFaceUp);
        console.log(`🎩 Dealer shows: ${this.formatHand(visibleCards)} + [HIDDEN]`);
      } else {
        console.log(`🪑 Player ${player.seatNumber}: ${this.formatHand(player.hands[0].cards)} (value: ${this.calculateHandValue(player.hands[0].cards)})`);
      }
    }

    // Znajdź pierwszego aktywnego gracza (nie-krupiera)
    const firstPlayer = game.players.findIndex(p => !p.isDealer && p.state === PlayerState.ACTIVE);
    if (firstPlayer !== -1) {
      game.currentPlayerIndex = firstPlayer;
      console.log(`👉 Setting first player: Player ${game.players[firstPlayer].seatNumber} (index: ${firstPlayer})`);
      
      // Ustaw czas rozpoczęcia tury
      game.currentTurnStartTime = Date.now();
      console.log(`🎯 First player set in dealInitialCards (no timeout)`);
      // this.startMoveTimeout(game, game.players[firstPlayer]); // WYŁĄCZONE
    } else {
      console.log(`⚠️ No active players found to set as first player`);
    }

    // Sprawdzamy czy któryś z graczy ma Blackjacka
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) return;

    const dealerHasBlackjack = this.isBlackjack(dealer.hands[0]);
    let someoneHasBlackjack = dealerHasBlackjack;

    // Sprawdzamy aktywnych graczy
    for (const player of activePlayers) {
      if (!player.isDealer && this.isBlackjack(player.hands[0])) {
        someoneHasBlackjack = true;
        this.io.to(game.id).emit('notification', `Gracz z miejsca ${player.seatNumber} ma Blackjacka!`);
      }
    }

    // Jeśli ktoś ma Blackjacka, odkrywamy kartę dealera i kończymy rundę
    if (someoneHasBlackjack) {
      dealer.hands[0].cards.forEach(card => card.isFaceUp = true);
      if (dealerHasBlackjack) {
        this.io.to(game.id).emit('notification', 'Dealer ma Blackjacka!');
      }
      this.determineWinners(game);
      game.state = GameState.ROUND_ENDED;
    }
  }

  private calculateHandValue(hand: Card[]): number {
    let value = 0;
    let aces = 0;

    for (const card of hand) {
      if (card.rank === 'ACE') {
        aces += 1;
      } else if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) {
        value += 10;
      } else {
        value += parseInt(card.rank);
      }
    }

    // Dodaj wartość asów
    for (let i = 0; i < aces; i++) {
      if (value + 11 <= 21) {
        value += 11;
      } else {
        value += 1;
      }
    }

    return value;
  }

  private nextPlayer(game: GameSession): void {
    const currentPlayer = game.players[game.currentPlayerIndex];
    
    if (!currentPlayer.isDealer) {
      // Sprawdź czy gracz ma więcej rąk do zagrania
      if (currentPlayer.hands.length > (currentPlayer.currentHandIndex || 0) + 1) {
        currentPlayer.currentHandIndex = (currentPlayer.currentHandIndex || 0) + 1;
        // Dobierz kartę dla nowej ręki jeśli powstała ze splitu
        if (currentPlayer.hands[currentPlayer.currentHandIndex].cards.length === 1) {
          currentPlayer.hands[currentPlayer.currentHandIndex].cards.push(this.drawCard(game));
        }
        game.currentTurnStartTime = Date.now();
        console.log(`🎯 Player ${currentPlayer.id} next hand (no timeout)`);
        return;
      }
    }

    // Standardowa logika przejścia do następnego gracza
    const activePlayers = game.players.filter(p => !p.isDealer && p.state === PlayerState.ACTIVE);
    const currentPlayerIndex = activePlayers.findIndex(p => p.id === currentPlayer.id);

    if (currentPlayerIndex === activePlayers.length - 1) {
      game.state = GameState.DEALER_TURN;
      this.playDealerTurn(game);
    } else {
      game.currentPlayerIndex = game.players.findIndex(p => 
        p.id === activePlayers[currentPlayerIndex + 1].id
      );
      const nextPlayer = game.players[game.currentPlayerIndex];
      nextPlayer.currentHandIndex = 0;
        game.currentTurnStartTime = Date.now();
        console.log(`🎯 Next player ${nextPlayer.id} turn started (no timeout)`);
    }
  }

  private playDealerTurn(game: GameSession): void {
    console.log(`🎩 === DEALER'S TURN ===`);
    
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');

    // Odkryj zakrytą kartę dealera
    dealer.hands.forEach(hand => hand.cards.forEach(card => card.isFaceUp = true));
    
    const initialValue = this.calculateHandValue(dealer.hands[0].cards);
    console.log(`🎩 Dealer reveals hand: [${this.formatHand(dealer.hands[0].cards)}] = ${initialValue}`);

    // Dealer dobiera karty dopóki nie ma co najmniej 17 punktów
    while (this.calculateHandValue(dealer.hands[0].cards) < 17) {
      const card = this.drawCard(game);
      dealer.hands[0].cards.push(card);
      
      const newValue = this.calculateHandValue(dealer.hands[0].cards);
      console.log(`🎩 Dealer draws ${this.formatCard(card)} → [${this.formatHand(dealer.hands[0].cards)}] = ${newValue}`);
    }

    const finalValue = this.calculateHandValue(dealer.hands[0].cards);
    if (finalValue > 21) {
      console.log(`💥 Dealer BUSTS with ${finalValue}!`);
    } else {
      console.log(`✅ Dealer stands with ${finalValue}`);
    }

    this.determineWinners(game);
    game.state = GameState.ROUND_ENDED;
    this.broadcastGameState(game);
  }

  private determineWinners(game: GameSession): void {
    // Wyczyść wszystkie timery na końcu rundy
    this.clearAllTimers(game);
    
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');
    
    const dealerHand = dealer.hands[0];
    const dealerValue = this.calculateHandValue(dealerHand.cards);
    const dealerHasBlackjack = this.isBlackjack(dealerHand);
    const dealerBusted = dealerValue > 21;

    for (const player of game.players) {
      if (player.isDealer) continue;

      // Sprawdzamy każdą rękę gracza
      player.hands.forEach(hand => {
        const playerValue = this.calculateHandValue(hand.cards);
        const playerHasBlackjack = this.isBlackjack(hand);
      const playerBusted = playerValue > 21;

      if (playerBusted) {
          // Gracz przebił - przegrywa
          this.io.to(game.id).emit('notification', `Gracz ${player.id} przebił!`);
          return;
        }

        if (playerHasBlackjack) {
          if (dealerHasBlackjack) {
            // Obaj mają blackjacka - remis
            player.balance += hand.bet;
            this.io.to(game.id).emit('notification', `Remis! Obaj mają Blackjacka.`);
          } else {
            // Tylko gracz ma blackjacka - wypłata 3:2
            const blackjackPayout = hand.bet * 2.5; // Wypłata 3:2 (1.5 * bet + oryginalny bet)
            player.balance += blackjackPayout;
            this.io.to(game.id).emit('notification', `Blackjack! Gracz ${player.id} wygrywa ${blackjackPayout}!`);
          }
        } else if (dealerBusted) {
          // Dealer przebił - normalna wygrana 1:1
          player.balance += hand.bet * 2;
          this.io.to(game.id).emit('notification', `Dealer przebił! Gracz ${player.id} wygrywa!`);
        } else if (playerValue > dealerValue) {
          // Gracz ma więcej niż dealer - normalna wygrana 1:1
          player.balance += hand.bet * 2;
          this.io.to(game.id).emit('notification', `Gracz ${player.id} wygrywa z ${playerValue} przeciwko ${dealerValue}!`);
        } else if (playerValue === dealerValue) {
          // Remis - zwrot zakładu
          player.balance += hand.bet;
          this.io.to(game.id).emit('notification', `Remis! ${playerValue}`);
        } else {
          // Przegrana - nie dostaje nic
          this.io.to(game.id).emit('notification', `Gracz ${player.id} przegrywa z ${playerValue} przeciwko ${dealerValue}.`);
        }
      });
    }

    // Po określeniu zwycięzców, automatycznie następna runda jeśli są gracze
    console.log(`⏸️ ROUND BREAK: ${this.ROUND_BREAK_TIMEOUT/1000}s break before next round`);
    setTimeout(() => {
      const totalPlayers = game.players.filter(p => !p.isDealer).length;
      
      if (totalPlayers > 0) {
        // ✅ Ciągłe rundy - krótka przerwa między rundami
        console.log(`🔄 Round break finished - starting new round`);
        this.io.to(game.id).emit('notification', 
          `Następna runda rozpocznie się za ${this.ROUND_BREAK_TIMEOUT / 1000} sekund...`);
        this.startRound(game.id);
      } else {
        console.log(`⏳ No players left - waiting for players`);
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Oczekiwanie na graczy...');
      }
    }, this.ROUND_BREAK_TIMEOUT); // 5 sekund przerwy
  }

  // Pomocnicza metoda do określania wartości karty
  private getCardValue(card: Card): number {
    if (card.rank === 'ACE') return 11;
    if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) return 10;
    return parseInt(card.rank);
  }

  // Dodajemy metodę sprawdzającą czy dana ręka to Blackjack
  private isBlackjack(hand: Hand): boolean {
    return hand.cards.length === 2 && this.calculateHandValue(hand.cards) === 21;
  }

  // Dodaj metodę do aktualizacji czasu ostatniej aktywności gracza
  private updatePlayerActivity(playerId: string, gameId: string) {
    const game = this.getGame(gameId);
    if (!game) return;

    const player = this.findPlayer(game, playerId);
    if (player && !player.isDealer) {
      (player as any).lastActivity = Date.now();
    }
  }

  // System czyszczenia nieaktywnych graczy
  private cleanupDisconnectedPlayers() {
    const now = Date.now();
    
    this.games.forEach((game, gameId) => {
      const playersToRemove: string[] = [];
      
      game.players.forEach(player => {
        if (!player.isDealer) {
          const lastActivity = (player as any).lastActivity || now;
          const timeSinceActivity = now - lastActivity;
          
          // Usuń graczy nieaktywnych przez więcej niż 60 sekund
          if (timeSinceActivity > this.PLAYER_TIMEOUT) {
            console.log(`Removing inactive player ${player.id} from game ${gameId}`);
            playersToRemove.push(player.id);
          }
        }
      });

      // Usuń nieaktywnych graczy
      playersToRemove.forEach(playerId => {
        this.leaveGame(gameId, playerId);
      });

      // Usuń puste gry (bez graczy, tylko dealer)
      const activePlayers = game.players.filter(p => !p.isDealer);
      if (activePlayers.length === 0 && game.state === GameState.WAITING_FOR_PLAYERS) {
        console.log(`Removing empty game ${gameId}`);
        // Wyczyść timer startowy przed usunięciem gry
        this.clearGameStartTimer(gameId);
        this.games.delete(gameId);
      }
    });
  }

  // Nowa metoda do czyszczenia wszystkich timerów gry
  private clearAllTimers(game: GameSession): void {
    console.log(`🧹 Clearing all timers for game ${game.id}`);
    
    // Wyczyść timery startowe
    this.clearGameStartTimer(game.id);
    
    // Wyczyść wszystkie timeouty i interwały graczy
    game.players.forEach(player => {
      if (player.betTimeoutId) {
        clearTimeout(player.betTimeoutId);
        player.betTimeoutId = undefined;
        console.log(`🧹 Cleared bet timeout for player ${player.id}`);
      }
      if (player.betIntervalId) {
        clearInterval(player.betIntervalId);
        player.betIntervalId = undefined;
        console.log(`🧹 Cleared bet interval for player ${player.id}`);
      }
      if (player.moveTimeoutId) {
        clearTimeout(player.moveTimeoutId);
        player.moveTimeoutId = undefined;
        console.log(`🧹 Cleared move timeout for player ${player.id}`);
      }
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
        console.log(`🧹 Cleared move interval for player ${player.id}`);
      }
    });
  }
}
