/**
 * CardManager - Handles deck management, dealing, and cut card logic
 * Responsible for managing the 6-deck shoe (312 cards) and card dealing
 */

import { GameSession, Card, Player } from '../../types/game';
import { Deck } from '../../models/Deck';
import { Hand } from '../../models/Hand';

export class CardManager {
  private readonly CUT_CARD_THRESHOLD = 78; // 25% of 312 cards
  private readonly DECKS_COUNT = 6; // 6 decks = 312 cards

  /**
   * Initializes a new deck for the game
   */
  public initializeDeck(game: GameSession): void {
    const newDeck = new Deck();
    game.deck = newDeck.getDeckAsArray();
    console.log(`🃏 Initialized new deck with ${game.deck.length} cards`);
  }

  /**
   * Draws a card from the game deck
   */
  public drawCard(game: GameSession): Card {
    console.log(`🃏 Drawing from deck with ${game.deck.length} cards`);
    
    // Check if deck needs reshuffling
    if (game.deck.length === 0) {
      console.log('🔄 Deck empty, creating new shuffled deck');
      this.initializeDeck(game);
    }
    
    // Cut card logic - shuffle when less than 25% cards remain
    if (game.deck.length < this.CUT_CARD_THRESHOLD) {
      console.log(`🃏 Cut card reached! ${game.deck.length} cards remaining, shuffling new deck...`);
      this.initializeDeck(game);
    }
    
    const card = game.deck.pop();
    if (!card) throw new Error('No cards in deck');
    
    card.isFaceUp = true;
    
    console.log(`🃏 Drew: ${this.formatCard(card)} (remaining: ${game.deck.length})`);
    return card;
  }

  /**
   * Deals initial cards to all players and dealer
   */
  public dealInitialCards(game: GameSession): void {
    console.log(`🃏 === DEALING INITIAL CARDS FOR GAME ${game.id} ===`);
    
    // Get active players (including dealer)
    const activePlayers = game.players.filter(p => 
      p.isDealer || p.state === 'ACTIVE'
    );
    
    // Sort players by seat number (1, 2, 3) + dealer at end
    const sortedPlayers = activePlayers.sort((a, b) => {
      if (a.isDealer) return 1;
      if (b.isDealer) return -1;
      return (a.seatNumber || 0) - (b.seatNumber || 0);
    });
    
    // Ensure all hands are empty
    this.clearAllHands(sortedPlayers);
    
    // First round of dealing
    console.log(`📤 First round of dealing (in seat order):`);
    for (const player of sortedPlayers) {
      const card = this.drawCard(game);
      player.hands[0].cards.push(card);
      
      if (player.isDealer) {
        console.log(`🎩 Dealer gets: ${this.formatCard(card)} (face up)`);
      } else {
        console.log(`🪑 Player ${player.seatNumber} gets: ${this.formatCard(card)} (face up)`);
      }
    }

    // Second round of dealing
    console.log(`📤 Second round of dealing (in seat order):`);
    for (const player of sortedPlayers) {
      const card = this.drawCard(game);
      
      if (player.isDealer) {
        card.isFaceUp = false; // Dealer's second card is face down
        console.log(`🎩 Dealer gets: ${this.formatCard(card)} (FACE DOWN)`);
      } else {
        console.log(`🪑 Player ${player.seatNumber} gets: ${this.formatCard(card)} (face up)`);
      }
      player.hands[0].cards.push(card);
    }

    // Show final hands
    this.logFinalHands(sortedPlayers);
  }

  /**
   * Deals a card to a specific player's hand
   */
  public dealCardToPlayer(game: GameSession, player: Player, handIndex: number = 0): Card {
    const card = this.drawCard(game);
    player.hands[handIndex].cards.push(card);
    
    console.log(`🃏 Dealt ${this.formatCard(card)} to Player ${player.seatNumber} hand ${handIndex}`);
    return card;
  }

  /**
   * Deals a card to the dealer
   */
  public dealCardToDealer(game: GameSession, faceUp: boolean = true): Card {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('No dealer found');
    
    const card = this.drawCard(game);
    card.isFaceUp = faceUp;
    dealer.hands[0].cards.push(card);
    
    console.log(`🃏 Dealt ${this.formatCard(card)} to Dealer (${faceUp ? 'face up' : 'face down'})`);
    return card;
  }

  /**
   * Reveals all dealer cards (flips face down cards)
   */
  public revealDealerCards(game: GameSession): void {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('No dealer found');
    
    dealer.hands.forEach(hand => {
      hand.cards.forEach(card => {
        card.isFaceUp = true;
      });
    });
    
    console.log(`🎩 Dealer cards revealed: ${this.formatHand(dealer.hands[0].cards)}`);
  }

  /**
   * Gets visible dealer cards (face up only)
   */
  public getVisibleDealerCards(game: GameSession): Card[] {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) return [];
    
    return dealer.hands[0].cards.filter(card => card.isFaceUp);
  }

  /**
   * Checks if dealer has blackjack (with visible cards only)
   */
  public dealerHasBlackjack(game: GameSession): boolean {
    const visibleCards = this.getVisibleDealerCards(game);
    if (visibleCards.length !== 2) return false;
    
    const hand = new Hand(visibleCards);
    return hand.isBlackjack();
  }

  /**
   * Checks if a player has blackjack
   */
  public playerHasBlackjack(player: Player, handIndex: number = 0): boolean {
    const hand = new Hand(player.hands[handIndex].cards);
    return hand.isBlackjack();
  }

  /**
   * Gets hand value for a player
   */
  public getHandValue(player: Player, handIndex: number = 0): number {
    const hand = new Hand(player.hands[handIndex].cards);
    return hand.calculateValue();
  }

  /**
   * Gets dealer hand value
   */
  public getDealerHandValue(game: GameSession): number {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) return 0;
    
    return this.getHandValue(dealer, 0);
  }

  /**
   * Checks if a hand is bust (over 21)
   */
  public isHandBust(player: Player, handIndex: number = 0): boolean {
    return this.getHandValue(player, handIndex) > 21;
  }

  /**
   * Gets remaining cards in deck
   */
  public getRemainingCards(game: GameSession): number {
    return game.deck.length;
  }

  /**
   * Checks if deck needs reshuffling
   */
  public needsReshuffle(game: GameSession): boolean {
    return game.deck.length < this.CUT_CARD_THRESHOLD;
  }

  /**
   * Gets deck statistics
   */
  public getDeckStats(game: GameSession): {
    remaining: number;
    total: number;
    percentageRemaining: number;
    needsReshuffle: boolean;
  } {
    const remaining = game.deck.length;
    const total = this.DECKS_COUNT * 52; // 312 cards
    const percentageRemaining = (remaining / total) * 100;
    
    return {
      remaining,
      total,
      percentageRemaining: Math.round(percentageRemaining * 100) / 100,
      needsReshuffle: this.needsReshuffle(game)
    };
  }

  /**
   * Clears all hands for given players
   */
  private clearAllHands(players: Player[]): void {
    players.forEach(player => {
      if (player.hands[0].cards.length > 0) {
        console.log(`⚠️ WARNING: Player ${player.isDealer ? 'Dealer' : player.seatNumber} had ${player.hands[0].cards.length} cards, clearing...`);
        player.hands[0].cards = [];
      }
    });
  }

  /**
   * Logs final hands after dealing
   */
  private logFinalHands(players: Player[]): void {
    console.log(`🃏 === FINAL INITIAL HANDS ===`);
    for (const player of players) {
      if (player.isDealer) {
        const visibleCards = player.hands[0].cards.filter(card => card.isFaceUp);
        console.log(`🎩 Dealer shows: ${this.formatHand(visibleCards)} + [HIDDEN]`);
      } else {
        const handValue = this.getHandValue(player);
        console.log(`🪑 Player ${player.seatNumber}: ${this.formatHand(player.hands[0].cards)} (value: ${handValue})`);
      }
    }
  }

  /**
   * Formats a single card for logging
   */
  private formatCard(card: Card): string {
    const hand = new Hand([card]);
    return hand.formatHand();
  }

  /**
   * Formats a hand for logging
   */
  private formatHand(cards: Card[]): string {
    const hand = new Hand(cards);
    return hand.formatHand();
  }
}
