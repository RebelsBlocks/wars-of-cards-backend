import { Card, GameState, HandResult, Player } from '../types/game';
import { Hand } from './Hand';

export class Game {
  constructor(
    public id: string,
    public state: GameState = GameState.WAITING_FOR_PLAYERS,
    public players: Player[] = [],
    public currentPlayerIndex: number = 0,
    public deck: Card[] = [],
    public lastMoveTime?: number,
    public currentTurnStartTime?: number,
    public insuranceAvailable: boolean = false,
    public insurancePhase: boolean = false,
    public occupiedSeats: Set<number> = new Set()
  ) {}

  // Tworzy nową talię kart (6 talii = 312 kart)
  public createNewDeck(): Card[] {
    const suits = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'] as const;
    const ranks = ['ACE', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING'] as const;
    const NUMBER_OF_DECKS = 6;
    
    const deck: Card[] = [];
    // Tworzymy 6 talii
    for (let deckIndex = 0; deckIndex < NUMBER_OF_DECKS; deckIndex++) {
      for (const suit of suits) {
        for (const rank of ranks) {
          deck.push({ suit, rank, isFaceUp: false });
        }
      }
    }

    console.log(`🃏 Created new deck with ${NUMBER_OF_DECKS} decks (${deck.length} cards total)`);
    
    // Sprawdź czy są duplikaty
    const cardStrings = deck.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    if (uniqueCards.size !== deck.length) {
      console.error(`🚨 DUPLICATE CARDS DETECTED! Expected ${deck.length}, got ${uniqueCards.size} unique cards`);
    } else {
      console.log(`✅ Deck validation passed - ${uniqueCards.size} unique cards`);
    }

    return this.shuffleDeck(deck);
  }

  // Tasuje talię kart
  public shuffleDeck(deck: Card[]): Card[] {
    console.log(`🃏 Shuffling deck with ${deck.length} cards`);
    
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    // Sprawdź czy po tasowaniu nie ma duplikatów
    const cardStrings = deck.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    if (uniqueCards.size !== deck.length) {
      console.error(`🚨 DUPLICATE CARDS AFTER SHUFFLE! Expected ${deck.length}, got ${uniqueCards.size} unique cards`);
    } else {
      console.log(`✅ Shuffle validation passed - ${uniqueCards.size} unique cards`);
    }
    
    return deck;
  }

  // Dobiera kartę z talii
  public drawCard(): Card {
    if (this.deck.length === 0) {
      console.log('🔄 Deck empty, creating new shuffled deck');
      this.deck = this.createNewDeck();
    }
    
    // Cut card logic - shuffle when less than 25% cards remain (78 cards from 312)
    const CUT_CARD_THRESHOLD = 78;
    if (this.deck.length < CUT_CARD_THRESHOLD) {
      console.log(`🃏 Cut card reached! ${this.deck.length} cards remaining, shuffling new deck...`);
      this.deck = this.createNewDeck();
    }
    
    const card = this.deck.pop();
    if (!card) throw new Error('Brak kart w talii');
    card.isFaceUp = true;
    return card;
  }

  // Sprawdza czy gracz może wykonać ruch
  public canPlayerMove(playerId: string): boolean {
    const player = this.findPlayer(playerId);
    if (!player || player.isDealer) return false;
    
    return this.state === GameState.PLAYER_TURN && 
           player.state === 'ACTIVE' && 
           this.players[this.currentPlayerIndex]?.id === playerId;
  }

  // Sprawdza czy gracz może postawić zakład
  public canPlayerBet(playerId: string): boolean {
    // 🚫 LEGACY: Betting phase - nie używane w pokerze
    return false;
  }

  // Określa zwycięzców rundy - POKER VERSION
  public determineWinners(): void {
    // TODO: Implementacja dla pokera
    // Na razie placeholder - będzie porównywać układy kart
    for (const player of this.players) {
      if (player.isDealer || player.hasFolded) continue;
      
      player.hands.forEach(hand => {
        // Tymczasowo wszyscy wygrywają (do implementacji logic pokera)
        hand.result = HandResult.WIN;
        player.balance += hand.bet * 2; // Zwrot + wygrana
      });
    }
  }


  // Sprawdza czy runda się skończyła
  public isRoundFinished(): boolean {
    const activePlayers = this.players.filter(p => !p.isDealer && p.state === 'ACTIVE');
    
    // Sprawdź czy wszyscy gracze skończyli swoje tury
    for (const player of activePlayers) {
      for (const hand of player.hands) {
        if (!hand.isFinished && !new Hand(hand.cards).isBust()) {
          return false;
        }
      }
    }
    
    return true;
  }

  // Przechodzi do następnego gracza
  public nextPlayer(): void {
    const currentPlayer = this.players[this.currentPlayerIndex];
    
    if (!currentPlayer.isDealer) {
      // Sprawdź czy gracz ma więcej rąk do zagrania
      if (currentPlayer.hands.length > (currentPlayer.currentHandIndex || 0) + 1) {
        currentPlayer.currentHandIndex = (currentPlayer.currentHandIndex || 0) + 1;
        this.currentTurnStartTime = Date.now();
        return;
      }
    }

    // Standardowa logika przejścia do następnego gracza
    const activePlayers = this.players.filter(p => !p.isDealer && p.state === 'ACTIVE');
    const currentPlayerIndex = activePlayers.findIndex(p => p.id === currentPlayer.id);

    if (currentPlayerIndex === activePlayers.length - 1) {
      this.state = GameState.ROUND_ENDED; // ✅ POKER: Zakończ rundę zamiast tury dealera
    } else {
      this.currentPlayerIndex = this.players.findIndex(p => 
        p.id === activePlayers[currentPlayerIndex + 1].id
      );
      const nextPlayer = this.players[this.currentPlayerIndex];
      nextPlayer.currentHandIndex = 0;
      this.currentTurnStartTime = Date.now();
    }
  }

  // Resetuje grę do nowej rundy
  public resetForNewRound(): void {
    this.state = GameState.DEALING_INITIAL_CARDS; // 🆕 POKER: Karty od razu
    this.deck = this.createNewDeck(); // 6 talii (312 kart)
    this.currentPlayerIndex = 0;
    // Reset currentBet dla nowej rundy
    (this as any).currentBet = 0;
    
    // Reset dla wszystkich graczy
    this.players.forEach(player => {
      if (player.isDealer) {
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false,
          result: undefined
        }];
      } else if (player.state === 'ACTIVE') {
        player.hands = [{
          cards: [],
          bet: 0,
          isFinished: false,
          hasDoubled: false,
          hasSplit: false,
          result: undefined
        }];
        player.currentHandIndex = 0;
      }
    });
  }

  // Znajduje gracza po ID
  public findPlayer(playerId: string): Player | undefined {
    return this.players.find(p => p.id === playerId);
  }

  // Sprawdza czy miejsce jest zajęte
  public isSeatOccupied(seatNumber: number): boolean {
    return this.occupiedSeats.has(seatNumber);
  }

  // Dodaje gracza do gry
  public addPlayer(player: Player): void {
    this.players.push(player);
    if (player.seatNumber) {
      this.occupiedSeats.add(player.seatNumber);
    }
  }

  // Usuwa gracza z gry
  public removePlayer(playerId: string): void {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      const player = this.players[playerIndex];
      if (player.seatNumber) {
        this.occupiedSeats.delete(player.seatNumber);
      }
      this.players.splice(playerIndex, 1);
    }
  }

  // Sprawdza czy gra może się rozpocząć
  public canStartGame(): boolean {
    const activePlayers = this.players.filter(p => !p.isDealer && p.state === 'ACTIVE');
    return activePlayers.length > 0 && this.state === GameState.WAITING_FOR_PLAYERS;
  }

  // Sprawdza czy wszyscy gracze postawili zakłady
  public allBetsPlaced(): boolean {
    const activePlayers = this.players.filter(p => !p.isDealer && p.state === 'ACTIVE');
    return activePlayers.every(p => p.hands.every(hand => hand.bet > 0));
  }
}
