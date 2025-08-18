import { GameState, PlayerMove, GameSession, Player, Card, Hand } from '../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../types/socket';
import { v4 as uuidv4 } from 'uuid';

// Typ dla stanu gry wysyłanego do klienta (z occupiedSeats jako array)
type GameStateForClient = Omit<GameSession, 'occupiedSeats'> & {
  occupiedSeats: number[];
};

export class GameService {
  private games: Map<string, GameSession> = new Map();
  private readonly MAX_PLAYERS = 3; // Maksymalna liczba graczy przy stole (nie licząc dealera)
  private readonly MOVE_TIMEOUT = 30000;  // 30 sekund na ruch
  private readonly BET_TIMEOUT = 45000;   // 45 sekund na postawienie zakładu
  private readonly GAME_START_TIMEOUT = 45000; // 45 sekund na start gry
  private readonly TIME_UPDATE_INTERVAL = 1000; // Co ile ms wysyłać aktualizacje czasu
  private readonly PLAYER_TIMEOUT = 60000; // 60 sekund na usunięcie nieaktywnego gracza

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    // Uruchom czyszczenie co 30 sekund
    setInterval(() => {
      this.cleanupDisconnectedPlayers();
    }, 30000);
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
    
    if (game.state !== GameState.WAITING_FOR_PLAYERS) {
      throw new Error('Nie można dołączyć do rozpoczętej gry');
    }

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
      currentHandIndex: 0
    };

    // Dodaj znacznik czasu aktywności
    (player as any).lastActivity = Date.now();

    game.players.push(player);
    game.occupiedSeats.add(seatNumber);

    // Jeśli to pierwszy gracz, rozpocznij odliczanie do startu gry
    if (playerCount === 0) {
      this.startGameCountdown(game);
    }

    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz dołączył do miejsca ${seatNumber}.`);
    return player;
  }

  // Rozpoczęcie nowej rundy
  public startRound(gameId: string): GameSession {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    game.state = GameState.BETTING;
    game.deck = this.createNewDeck();
    game.players.forEach(player => {
      player.hands = [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false
      }];
      player.currentHandIndex = 0;
      // Usuń stare timeouty jeśli istnieją
      if (player.moveTimeoutId) clearTimeout(player.moveTimeoutId);
      if (player.betTimeoutId) clearTimeout(player.betTimeoutId);
    });

    // Ustaw timeouty na zakłady dla wszystkich graczy
    game.players
      .filter(p => !p.isDealer)
      .forEach(player => this.startBetTimeout(game, player));

    this.broadcastGameState(game);
    return game;
  }

  // Postawienie zakładu
  public placeBet(gameId: string, playerId: string, amount: number): GameSession {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    
    if (player.balance < amount) throw new Error('Niewystarczające środki');
    
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
    }
    
    player.hands[0].bet = amount;
    player.balance -= amount;

    // Sprawdź czy wszyscy gracze postawili zakłady
    const allBetsPlaced = game.players
      .filter(p => !p.isDealer)
      .every(p => p.hands.every(hand => hand.bet > 0));

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
    this.updatePlayerActivity(playerId, gameId);
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
    player.hands[player.currentHandIndex || 0].cards.push(card);

    game.lastMoveTime = Date.now();

    if (this.calculateHandValue(player.hands[player.currentHandIndex || 0].cards) > 21) {
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
    this.updatePlayerActivity(playerId, gameId);
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
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');
    
    if (game.state !== GameState.PLAYER_TURN || player.hands[player.currentHandIndex || 0].cards.length !== 2) {
      throw new Error('Podwojenie możliwe tylko na początku tury');
    }

    if (player.balance < player.hands[player.currentHandIndex || 0].bet) {
      throw new Error('Niewystarczające środki na podwojenie');
    }

    player.balance -= player.hands[player.currentHandIndex || 0].bet;
    player.hands[player.currentHandIndex || 0].bet *= 2;

    const card = this.drawCard(game);
    player.hands[player.currentHandIndex || 0].cards.push(card);

    this.nextPlayer(game);
    this.broadcastGameState(game);
    return game;
  }

  // Proces podziału kart (split)
  public processSplit(gameId: string, playerId: string): GameSession {
    this.updatePlayerActivity(playerId, gameId);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Gra nie istnieje');
    
    const player = this.findPlayer(game, playerId);
    if (!player) throw new Error('Gracz nie istnieje');

    const currentHand = player.hands[player.currentHandIndex || 0];
    
    // Sprawdzenie warunków dla splitu
    if (game.state !== GameState.PLAYER_TURN || 
        currentHand.cards.length !== 2 || 
        this.getCardValue(currentHand.cards[0]) !== this.getCardValue(currentHand.cards[1]) ||
        currentHand.hasDoubled ||
        currentHand.hasSplit) {
      throw new Error('Split niemożliwy w tej sytuacji');
    }

    if (player.balance < currentHand.bet) {
      throw new Error('Niewystarczające środki na split');
    }

    // Tworzenie dwóch nowych rąk
    const card1 = currentHand.cards[0];
    const card2 = currentHand.cards[1];

    const hand1: Hand = {
      cards: [card1],
      bet: currentHand.bet,
      isFinished: false,
      hasDoubled: false,
      hasSplit: true
    };

    const hand2: Hand = {
      cards: [card2],
      bet: currentHand.bet,
      isFinished: false,
      hasDoubled: false,
      hasSplit: true
    };

    // Pobranie dodatkowej karty dla pierwszej ręki
    hand1.cards.push(this.drawCard(game));
    
    // Aktualizacja stanu gracza
    player.hands = [hand1, hand2];
    player.currentHandIndex = 0;
    player.balance -= currentHand.bet; // Pobierz zakład dla drugiej ręki

    // Resetuj timeout dla aktualnego ruchu
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      this.startMoveTimeout(game, player);
    }

    this.broadcastGameState(game);
    return game;
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
      
      if (game.state === GameState.WAITING_FOR_PLAYERS) {
        if (playerCount < this.MAX_PLAYERS) {
          console.log(`Found available game: ${game.id} with ${playerCount} players`);
          return game; // Znaleziono grę z wolnymi miejscami
        }
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
      if (player.hands.every(hand => hand.bet === 0) && game.state === GameState.BETTING) {
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

  // Nowa metoda do obsługi odliczania do startu gry
  private startGameCountdown(game: GameSession): void {
    const startTime = Date.now();
    
    // Ustawiamy interwał do aktualizacji pozostałego czasu
    const updateInterval = setInterval(() => {
      const remainingTime = this.GAME_START_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        this.io.to(game.id).emit('timeUpdate', {
          type: 'gameStart',
          remainingTime,
          totalTime: this.GAME_START_TIMEOUT
        });
      }
    }, this.TIME_UPDATE_INTERVAL);

    // Ustawiamy timeout na start gry
    setTimeout(() => {
      clearInterval(updateInterval);
      const playerCount = game.players.filter(p => !p.isDealer).length;
      
      if (playerCount > 0) {
        // Jeśli jest przynajmniej jeden gracz, rozpocznij grę
        this.startRound(game.id);
        this.io.to(game.id).emit('notification', 
          `Gra rozpoczyna się z ${playerCount} graczami!`
        );
      } else {
        // W przypadku gdyby wszyscy gracze opuścili stół przed startem
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Brak graczy przy stole.');
      }
    }, this.GAME_START_TIMEOUT);
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

    // Powiadom innych graczy
    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz opuścił miejsce ${player.seatNumber || 'nieznane'}.`);
  }

  // Metoda do broadcastowania stanu gry
  private broadcastGameState(game: GameSession): void {
    // Twórz prostą kopię bez circular references
    const cleanGameState = {
      id: game.id,
      state: game.state,
      players: game.players.map(player => ({
        id: player.id,
        hands: player.hands.map(hand => ({
          cards: hand.cards,
          bet: hand.bet,
          isFinished: hand.isFinished,
          hasDoubled: hand.hasDoubled,
          hasSplit: hand.hasSplit
        })),
        balance: player.balance,
        isDealer: player.isDealer,
        seatNumber: player.seatNumber,
        currentHandIndex: player.currentHandIndex
        // Usuń moveTimeoutId i betTimeoutId - to może powodować circular reference
      })),
      currentPlayerIndex: game.currentPlayerIndex,
      lastMoveTime: game.lastMoveTime,
      currentTurnStartTime: game.currentTurnStartTime,
      insuranceAvailable: game.insuranceAvailable,
      insurancePhase: game.insurancePhase,
      occupiedSeats: Array.from(game.occupiedSeats)
    };
    
    this.io.to(game.id).emit('gameState', cleanGameState as any);
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
      player.hands[0].cards.push(card);
    }

    // Druga runda rozdawania
    for (const player of game.players) {
      const card = this.drawCard(game);
      if (player.isDealer) {
        card.isFaceUp = false; // Druga karta dealera zakryta
      }
      player.hands[0].cards.push(card);
    }

    // Sprawdzamy czy któryś z graczy ma Blackjacka
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) return;

    const dealerHasBlackjack = this.isBlackjack(dealer.hands[0]);
    let someoneHasBlackjack = dealerHasBlackjack;

    // Sprawdzamy graczy
    for (const player of game.players) {
      if (!player.isDealer && this.isBlackjack(player.hands[0])) {
        someoneHasBlackjack = true;
        this.io.to(game.id).emit('notification', `Gracz ${player.id} ma Blackjacka!`);
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
        this.startMoveTimeout(game, currentPlayer);
        return;
      }
    }

    // Standardowa logika przejścia do następnego gracza
    const activePlayers = game.players.filter(p => !p.isDealer);
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
        this.startMoveTimeout(game, nextPlayer);
    }
  }

  private playDealerTurn(game: GameSession): void {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');

    // Odkryj zakrytą kartę dealera
    dealer.hands.forEach(hand => hand.cards.forEach(card => card.isFaceUp = true));

    // Dealer dobiera karty dopóki nie ma co najmniej 17 punktów
    while (this.calculateHandValue(dealer.hands[0].cards) < 17) {
      const card = this.drawCard(game);
      dealer.hands[0].cards.push(card);
    }

    this.determineWinners(game);
    game.state = GameState.ROUND_ENDED;
    this.broadcastGameState(game);
  }

  private determineWinners(game: GameSession): void {
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

    // Po określeniu zwycięzców, rozpocznij odliczanie do następnej rundy
    setTimeout(() => {
      // Sprawdź czy są jeszcze gracze przy stole
      const remainingPlayers = game.players.filter(p => !p.isDealer).length;
      if (remainingPlayers > 0) {
        this.startRound(game.id);
      } else {
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Oczekiwanie na graczy...');
      }
    }, this.GAME_START_TIMEOUT);
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
        this.games.delete(gameId);
      }
    });
  }
}
