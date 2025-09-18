import { Card, GameState, HandResult, Player } from '../types/game';
import { Hand } from './Hand';
import { Deck } from './Deck';

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


  // Dobiera kartę z talii
  public drawCard(): Card {
    if (this.deck.length === 0) {
      console.log('🔄 Deck empty, creating new shuffled deck');
      const newDeck = new Deck();
      this.deck = newDeck.getDeckAsArray();
    }
    
    // Cut card logic - shuffle when less than 25% cards remain (78 cards from 312)
    const CUT_CARD_THRESHOLD = 78;
    if (this.deck.length < CUT_CARD_THRESHOLD) {
      console.log(`🃏 Cut card reached! ${this.deck.length} cards remaining, shuffling new deck...`);
      const newDeck = new Deck();
      this.deck = newDeck.getDeckAsArray();
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
    const player = this.findPlayer(playerId);
    if (!player || player.isDealer) return false;
    
    return this.state === GameState.BETTING && 
           player.state === 'ACTIVE';
  }

  // Określa zwycięzców rundy
  public determineWinners(): void {
    const dealer = this.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Brak dealera w grze');
    
    const dealerHand = dealer.hands[0];
    const dealerValue = new Hand(dealerHand.cards).calculateValue();
    const dealerHasBlackjack = new Hand(dealerHand.cards).isBlackjack();
    const dealerBusted = dealerValue > 21;

    for (const player of this.players) {
      if (player.isDealer) continue;

      // Sprawdzamy każdą rękę gracza
      player.hands.forEach(hand => {
        const handInstance = new Hand(hand.cards);
        const playerValue = handInstance.calculateValue();
        const playerHasBlackjack = handInstance.isBlackjack();
        const playerBusted = playerValue > 21;

        if (playerBusted) {
          // Gracz przebił - przegrywa
          hand.result = HandResult.BUST;
          return;
        }

        if (playerHasBlackjack) {
          if (dealerHasBlackjack) {
            // Obaj mają blackjacka - remis
            hand.result = HandResult.PUSH;
            player.balance += hand.bet;
          } else {
            // Tylko gracz ma blackjacka - wypłata 3:2
            hand.result = HandResult.BLACKJACK;
            const blackjackPayout = hand.bet * 2.5; // Wypłata 3:2 (1.5 * bet + oryginalny bet)
            player.balance += blackjackPayout;
          }
        } else if (dealerBusted) {
          // Dealer przebił - normalna wygrana 1:1
          hand.result = HandResult.WIN;
          player.balance += hand.bet * 2;
        } else if (playerValue > dealerValue) {
          // Gracz ma więcej niż dealer - normalna wygrana 1:1
          hand.result = HandResult.WIN;
          player.balance += hand.bet * 2;
        } else if (playerValue === dealerValue) {
          // Remis - zwrot zakładu
          hand.result = HandResult.PUSH;
          player.balance += hand.bet;
        } else {
          // Przegrana - nie dostaje nic
          hand.result = HandResult.LOSE;
        }
      });
    }
  }

  // Sprawdza czy ktoś ma Blackjacka po rozdaniu kart
  public checkForBlackjack(): boolean {
    const dealer = this.players.find(p => p.isDealer);
    if (!dealer) return false;

    // Sprawdzamy tylko widoczne karty dealera (bez zakrytej)
    const visibleDealerCards = dealer.hands[0].cards.filter(card => card.isFaceUp);
    const dealerHasBlackjack = new Hand(visibleDealerCards).isBlackjack();
    let someoneHasBlackjack = dealerHasBlackjack;

    // Sprawdzamy aktywnych graczy
    for (const player of this.players) {
      if (!player.isDealer && player.state === 'ACTIVE') {
        if (new Hand(player.hands[0].cards).isBlackjack()) {
          someoneHasBlackjack = true;
        }
      }
    }

    return someoneHasBlackjack;
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
      this.state = GameState.DEALER_TURN;
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
    this.state = GameState.BETTING;
    const newDeck = new Deck(); // 6 talii (312 kart)
    this.deck = newDeck.getDeckAsArray();
    this.currentPlayerIndex = 0;
    
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
