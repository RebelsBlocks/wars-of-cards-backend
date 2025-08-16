import { GameState, PlayerMove, GameSession, Player, Card } from '../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../types/socket';
import { v4 as uuidv4 } from 'uuid';

export class GameService {
  private games: Map<string, GameSession> = new Map();
  private readonly MAX_PLAYERS = 3; // Maksymalna liczba graczy przy stole (nie licząc dealera)
  private readonly MOVE_TIMEOUT = 30000;  // 30 sekund na ruch
  private readonly BET_TIMEOUT = 45000;   // 45 sekund na postawienie zakładu
  private readonly TIME_UPDATE_INTERVAL = 1000; // Co ile ms wysyłać aktualizacje czasu

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {}

  // Tworzenie nowej gry
  public createGame(): GameSession {
    const gameId = uuidv4();
    const dealer: Player = {
      id: 'dealer',
      hand: [],
      bet: 0,
      balance: 0,
      isDealer: true
    };

    const newGame: GameSession = {
      id: gameId,
      state: GameState.WAITING_FOR_PLAYERS,
      players: [dealer],
      currentPlayerIndex: 0,
      deck: this.createNewDeck()
    };

    this.games.set(gameId, newGame);
    this.broadcastGameState(newGame);
    return newGame;
  }

  // Dołączanie gracza do gry
  public joinGame(gameId: string, initialBalance: number = 1000): Player {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    if (game.state !== GameState.WAITING_FOR_PLAYERS) {
      throw new Error('Nie można dołączyć do rozpoczętej gry');
    }

    // Sprawdzenie liczby graczy (nie licząc dealera)
    const playerCount = game.players.filter(p => !p.isDealer).length;
    if (playerCount >= this.MAX_PLAYERS) {
      throw new Error(`Stół jest pełny. Maksymalna liczba graczy: ${this.MAX_PLAYERS}`);
    }

    const player: Player = {
      id: uuidv4(),
      hand: [],
      bet: 0,
      balance: initialBalance,
      isDealer: false
    };

    game.players.push(player);

    // Jeśli osiągnięto maksymalną liczbę graczy, automatycznie rozpocznij rundę
    if (game.players.filter(p => !p.isDealer).length === this.MAX_PLAYERS) {
      this.startRound(gameId);
    }

    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Nowy gracz dołączył do gry.`);
    return player;
  }

  // Rozpoczęcie nowej rundy
  public startRound(gameId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    game.state = GameState.BETTING;
    game.deck = this.createNewDeck();
    game.players.forEach(player => {
      player.hand = [];
      player.bet = 0;
      // Usuń stare timeouty jeśli istnieją
      if (player.moveTimeoutId) clearTimeout(player.moveTimeoutId);
      if (player.betTimeoutId) clearTimeout(player.betTimeoutId);
    });

    // Ustaw timeouty na zakłady dla wszystkich graczy
    game.players
      .filter(p => !p.isDealer)
      .forEach(player => this.startBetTimeout(game, player));

    return game;
  }

  // Postawienie zakładu
  public placeBet(gameId: string, playerId: string, amount: number): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    
    if (player.balance < amount) throw new Error('Niewystarczające środki');
    
    // Wyczyść timeout na zakład dla tego gracza
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
    }
    
    player.bet = amount;
    player.balance -= amount;

    // Sprawdź czy wszyscy gracze postawili zakłady
    const allBetsPlaced = game.players
      .filter(p => !p.isDealer)
      .every(p => p.bet > 0);

    if (allBetsPlaced) {
      this.dealInitialCards(game);
      game.state = GameState.PLAYER_TURN;
      game.currentTurnStartTime = Date.now();
      // Rozpocznij timeout dla pierwszego gracza
      const firstPlayer = game.players[game.currentPlayerIndex];
      if (!firstPlayer.isDealer) {
        this.startMoveTimeout(game, firstPlayer);
      }
    }

    this.broadcastGameState(game);
    return game;
  }

  // Proces dobierania karty (hit)
  public processHit(gameId: string, playerId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Niedozwolony ruch w tym momencie gry');
    }

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    const card = this.drawCard(game);
    player.hand.push(card);

    game.lastMoveTime = Date.now();

    if (this.calculateHandValue(player.hand) > 21) {
      this.nextPlayer(game);
    } else {
      // Ustaw nowy timeout dla tego samego gracza
      this.startMoveTimeout(game, player);
    }

    this.broadcastGameState(game);
    return game;
  }

  // Proces zatrzymania się (stand)
  public processStand(gameId: string, playerId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    if (game.state !== GameState.PLAYER_TURN) {
      throw new Error('Niedozwolony ruch w tym momencie gry');
    }

    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');

    // Wyczyść timeout dla tego gracza
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }

    game.lastMoveTime = Date.now();
    this.nextPlayer(game);
    this.broadcastGameState(game);
    return game;
  }

  // Proces podwojenia stawki (double)
  public processDouble(gameId: string, playerId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    
    if (game.state !== GameState.PLAYER_TURN || player.hand.length !== 2) {
      throw new Error('Podwojenie możliwe tylko na początku tury');
    }

    if (player.balance < player.bet) {
      throw new Error('Niewystarczające środki na podwojenie');
    }

    player.balance -= player.bet;
    player.bet *= 2;

    const card = this.drawCard(game);
    player.hand.push(card);

    this.nextPlayer(game);
    this.broadcastGameState(game);
    return game;
  }

  // Proces podziału kart (split)
  public processSplit(gameId: string, playerId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');

    if (game.state !== GameState.PLAYER_TURN || 
        player.hand.length !== 2 || 
        player.hand[0].rank !== player.hand[1].rank) {
      throw new Error('Split niemożliwy w tej sytuacji');
    }

    if (player.balance < player.bet) {
      throw new Error('Niewystarczające środki na split');
    }

    // TODO: Implementacja splitu - wymaga modyfikacji struktury gracza
    // aby obsługiwać wiele rąk
    throw new Error('Split nie jest jeszcze zaimplementowany');
  }

  // Pobranie stanu gry
  public getGameState(gameId: string): GameSession | undefined {
    return this.games.get(gameId);
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
      game.deck = this.createNewDeck();
    }
    const card = game.deck.pop();
    if (!card) throw new Error('Brak kart w talii');
    card.isFaceUp = true;
    return card;
  }

  private dealInitialCards(game: GameSession): void {
    // Pierwsza runda rozdawania
    for (const player of game.players) {
      const card = this.drawCard(game);
      player.hand.push(card);
    }

    // Druga runda rozdawania
    for (const player of game.players) {
      const card = this.drawCard(game);
      if (player.isDealer) {
        card.isFaceUp = false; // Druga karta dealera zakryta
      }
      player.hand.push(card);
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
    const activePlayers = game.players.filter(p => !p.isDealer);
    const currentPlayerIndex = activePlayers.findIndex(p => 
      p.id === game.players[game.currentPlayerIndex].id
    );

    if (currentPlayerIndex === activePlayers.length - 1) {
      // Wszyscy gracze zakończyli swoje tury
      game.state = GameState.DEALER_TURN;
      this.playDealerTurn(game);
    } else {
      // Przejdź do następnego gracza
      game.currentPlayerIndex = game.players.findIndex(p => 
        p.id === activePlayers[currentPlayerIndex + 1].id
      );
      
      // Ustaw timeout dla następnego gracza
      const nextPlayer = game.players[game.currentPlayerIndex];
      if (!nextPlayer.isDealer) {
        game.currentTurnStartTime = Date.now();
        this.startMoveTimeout(game, nextPlayer);
      }
    }
  }

  private playDealerTurn(game: GameSession): void {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');

    // Odkryj zakrytą kartę dealera
    dealer.hand.forEach(card => card.isFaceUp = true);

    // Dealer dobiera karty dopóki nie ma co najmniej 17 punktów
    while (this.calculateHandValue(dealer.hand) < 17) {
      const card = this.drawCard(game);
      dealer.hand.push(card);
    }

    this.determineWinners(game);
    game.state = GameState.ROUND_ENDED;
    this.broadcastGameState(game);
  }

  private determineWinners(game: GameSession): void {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');
    
    const dealerValue = this.calculateHandValue(dealer.hand);
    const dealerBusted = dealerValue > 21;

    for (const player of game.players) {
      if (player.isDealer) continue;

      const playerValue = this.calculateHandValue(player.hand);
      const playerBusted = playerValue > 21;

      if (playerBusted) {
        // Gracz przegrał
        continue;
      } else if (dealerBusted || playerValue > dealerValue) {
        // Gracz wygrał
        player.balance += player.bet * 2;
      } else if (playerValue === dealerValue) {
        // Remis
        player.balance += player.bet;
      }
      // W przeciwnym razie gracz przegrał i nie dostaje nic
    }
  }

  // Nowe metody do obsługi timeoutów

  private startBetTimeout(game: GameSession, player: Player): void {
    const startTime = Date.now();
    
    // Ustaw interwał do aktualizacji pozostałego czasu
    const updateInterval = setInterval(() => {
      const remainingTime = this.BET_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        this.io.to(game.id).emit('timeUpdate', {
          type: 'bet',
          playerId: player.id,
          remainingTime,
          totalTime: this.BET_TIMEOUT
        });
      }
    }, this.TIME_UPDATE_INTERVAL);

    player.betTimeoutId = setTimeout(() => {
      clearInterval(updateInterval);
      // Jeśli gracz nie postawił zakładu, automatycznie postaw minimalny zakład
      if (player.bet === 0 && game.state === GameState.BETTING) {
        const minBet = 10; // Minimalny zakład
        if (player.balance >= minBet) {
          this.placeBet(game.id, player.id, minBet);
          this.io.to(game.id).emit('notification', 
            `Gracz ${player.id} nie postawił zakładu w czasie. Automatycznie postawiono minimalny zakład.`
          );
        } else {
          // Jeśli gracz nie ma wystarczających środków, usuń go z gry
          game.players = game.players.filter(p => p.id !== player.id);
          this.io.to(game.id).emit('notification', 
            `Gracz ${player.id} został usunięty z gry z powodu braku środków.`
          );
        }
      }
    }, this.BET_TIMEOUT);
  }

  private startMoveTimeout(game: GameSession, player: Player): void {
    const startTime = Date.now();
    
    // Ustaw interwał do aktualizacji pozostałego czasu
    const updateInterval = setInterval(() => {
      const remainingTime = this.MOVE_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        this.io.to(game.id).emit('timeUpdate', {
          type: 'move',
          playerId: player.id,
          remainingTime,
          totalTime: this.MOVE_TIMEOUT
        });
      }
    }, this.TIME_UPDATE_INTERVAL);

    player.moveTimeoutId = setTimeout(() => {
      clearInterval(updateInterval);
      if (game.state === GameState.PLAYER_TURN) {
        this.io.to(game.id).emit('notification', 
          `Czas na ruch gracza ${player.id} upłynął. Automatycznie wykonano STAND.`
        );
        this.processStand(game.id, player.id);
      }
    }, this.MOVE_TIMEOUT);
  }

  // Metoda do broadcastowania stanu gry
  private broadcastGameState(game: GameSession): void {
    this.io.to(game.id).emit('gameState', game);
  }
}
