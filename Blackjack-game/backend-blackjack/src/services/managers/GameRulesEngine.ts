/**
 * GameRulesEngine - Implements blackjack rules and move validation
 * Responsible for validating moves and implementing game logic
 */

import { GameSession, Player, PlayerMove, HandResult, GameState, PlayerState } from '../../types/game';
import { Hand } from '../../models/Hand';

export class GameRulesEngine {
  /**
   * Validates if a player can place a bet
   */
  public canPlaceBet(game: GameSession, player: Player, amount: number): { valid: boolean; reason?: string } {
    if (game.state !== GameState.BETTING) {
      return { valid: false, reason: 'Betting is not allowed at this time' };
    }

    if (player.state !== PlayerState.ACTIVE && player.state !== PlayerState.OBSERVING) {
      if (player.state === PlayerState.AWAITING_BUY_IN) {
        return { valid: false, reason: 'Player must buy chips before placing a bet' };
      }
      return { valid: false, reason: 'Player is not active in this round' };
    }

    if (player.balance < amount) {
      return { valid: false, reason: 'Insufficient funds' };
    }

    return { valid: true };
  }

  /**
   * Validates if a player can hit
   */
  public canHit(game: GameSession, player: Player, handIndex: number = 0): { valid: boolean; reason?: string } {
    if (game.state !== GameState.PLAYER_TURN) {
      return { valid: false, reason: 'Move not allowed at this time' };
    }

    if (player.state !== PlayerState.ACTIVE) {
      return { valid: false, reason: 'Player is not active in this round' };
    }

    const hand = player.hands[handIndex];
    if (!hand) {
      return { valid: false, reason: 'Hand does not exist' };
    }

    if (hand.isFinished) {
      return { valid: false, reason: 'Hand is already finished' };
    }

    const handValue = this.getHandValue(hand.cards);
    if (handValue >= 21) {
      return { valid: false, reason: 'Cannot hit on 21 or bust' };
    }

    return { valid: true };
  }

  /**
   * Validates if a player can stand
   */
  public canStand(game: GameSession, player: Player, handIndex: number = 0): { valid: boolean; reason?: string } {
    if (game.state !== GameState.PLAYER_TURN) {
      return { valid: false, reason: 'Move not allowed at this time' };
    }

    if (player.state !== PlayerState.ACTIVE) {
      return { valid: false, reason: 'Player is not active in this round' };
    }

    const hand = player.hands[handIndex];
    if (!hand) {
      return { valid: false, reason: 'Hand does not exist' };
    }

    if (hand.isFinished) {
      return { valid: false, reason: 'Hand is already finished' };
    }

    return { valid: true };
  }

  /**
   * Validates if a player can double down
   */
  public canDouble(game: GameSession, player: Player, handIndex: number = 0): { valid: boolean; reason?: string } {
    if (game.state !== GameState.PLAYER_TURN) {
      return { valid: false, reason: 'Move not allowed at this time' };
    }

    if (player.state !== PlayerState.ACTIVE) {
      return { valid: false, reason: 'Player is not active in this round' };
    }

    const hand = player.hands[handIndex];
    if (!hand) {
      return { valid: false, reason: 'Hand does not exist' };
    }

    if (hand.cards.length !== 2) {
      return { valid: false, reason: 'Double is only possible with the first two cards' };
    }

    if (hand.hasDoubled) {
      return { valid: false, reason: 'Hand has already been doubled' };
    }

    if (player.balance < hand.bet) {
      return { valid: false, reason: 'Insufficient funds for double' };
    }

    return { valid: true };
  }

  /**
   * Validates if a player can split
   */
  public canSplit(game: GameSession, player: Player, handIndex: number = 0): { valid: boolean; reason?: string } {
    if (game.state !== GameState.PLAYER_TURN) {
      return { valid: false, reason: 'Move not allowed at this time' };
    }

    if (player.state !== PlayerState.ACTIVE) {
      return { valid: false, reason: 'Player is not active in this round' };
    }

    const hand = player.hands[handIndex];
    if (!hand) {
      return { valid: false, reason: 'Hand does not exist' };
    }

    if (hand.cards.length !== 2) {
      return { valid: false, reason: 'Split is only possible with the first two cards' };
    }

    const firstCard = hand.cards[0];
    const secondCard = hand.cards[1];
    
    if (firstCard.rank !== secondCard.rank) {
      return { valid: false, reason: 'Split is only possible with cards of the same value' };
    }

    if (player.balance < hand.bet) {
      return { valid: false, reason: 'Insufficient funds for split' };
    }

    if (player.hasPerformedSplit) {
      return { valid: false, reason: 'Split can only be performed once per round' };
    }

    return { valid: true };
  }

  /**
   * Processes a hit move
   */
  public processHit(game: GameSession, player: Player, handIndex: number = 0): {
    success: boolean;
    newHandValue: number;
    isBust: boolean;
    reason?: string;
  } {
    const validation = this.canHit(game, player, handIndex);
    if (!validation.valid) {
      return { success: false, newHandValue: 0, isBust: false, reason: validation.reason };
    }

    // The actual card dealing is handled by CardManager
    // This method just validates and calculates the result
    const hand = player.hands[handIndex];
    const newHandValue = this.getHandValue(hand.cards);
    const isBust = newHandValue > 21;

    if (isBust) {
      hand.result = HandResult.BUST;
      hand.isFinished = true;
    }

    return { success: true, newHandValue, isBust };
  }

  /**
   * Processes a stand move
   */
  public processStand(game: GameSession, player: Player, handIndex: number = 0): {
    success: boolean;
    reason?: string;
  } {
    const validation = this.canStand(game, player, handIndex);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const hand = player.hands[handIndex];
    hand.isFinished = true;

    return { success: true };
  }

  /**
   * Processes a double down move
   */
  public processDouble(game: GameSession, player: Player, handIndex: number = 0): {
    success: boolean;
    newBetAmount: number;
    reason?: string;
  } {
    const validation = this.canDouble(game, player, handIndex);
    if (!validation.valid) {
      return { success: false, newBetAmount: 0, reason: validation.reason };
    }

    const hand = player.hands[handIndex];
    const additionalBet = hand.bet;
    
    player.balance -= additionalBet;
    hand.bet *= 2;
    hand.hasDoubled = true;
    hand.isFinished = true; // Double down automatically ends the hand

    return { success: true, newBetAmount: hand.bet };
  }

  /**
   * Processes a split move
   */
  public processSplit(game: GameSession, player: Player, handIndex: number = 0): {
    success: boolean;
    newHands: number;
    reason?: string;
  } {
    const validation = this.canSplit(game, player, handIndex);
    if (!validation.valid) {
      return { success: false, newHands: 0, reason: validation.reason };
    }

    const currentHand = player.hands[handIndex];
    const firstCard = currentHand.cards[0];
    const secondCard = currentHand.cards[1];

    // Create new hand with second card
    const newHand = {
      cards: [secondCard],
      bet: currentHand.bet,
      isFinished: false,
      hasDoubled: false,
      hasSplit: true,
      result: undefined
    };

    // Modify current hand to have only first card
    currentHand.cards = [firstCard];
    currentHand.hasSplit = true;
    currentHand.isFinished = false;

    // Add new hand
    player.hands.push(newHand);
    player.currentHandIndex = 0; // Reset to first hand

    // Deduct bet for new hand
    player.balance -= currentHand.bet;
    player.hasPerformedSplit = true;

    return { success: true, newHands: player.hands.length };
  }

  /**
   * Gets hand value using the Hand model
   */
  public getHandValue(cards: any[]): number {
    const hand = new Hand(cards);
    return hand.calculateValue();
  }

  /**
   * Checks if a hand is blackjack
   */
  public isBlackjack(cards: any[]): boolean {
    const hand = new Hand(cards);
    return hand.isBlackjack();
  }

  /**
   * Determines the result of a hand vs dealer
   */
  public determineHandResult(playerValue: number, dealerValue: number, playerHasBlackjack: boolean, dealerHasBlackjack: boolean): HandResult {
    if (playerValue > 21) {
      return HandResult.BUST;
    }

    if (playerHasBlackjack && dealerHasBlackjack) {
      return HandResult.PUSH;
    }

    if (playerHasBlackjack && !dealerHasBlackjack) {
      return HandResult.BLACKJACK;
    }

    if (dealerValue > 21) {
      return HandResult.WIN;
    }

    if (playerValue > dealerValue) {
      return HandResult.WIN;
    }

    if (playerValue === dealerValue) {
      return HandResult.PUSH;
    }

    return HandResult.LOSE;
  }

  /**
   * Calculates payout for a hand result
   */
  public calculatePayout(betAmount: number, result: HandResult): number {
    switch (result) {
      case HandResult.BLACKJACK:
        return betAmount * 2.5; // 3:2 payout (1.5 * bet + original bet)
      case HandResult.WIN:
        return betAmount * 2; // 1:1 payout (bet + winnings)
      case HandResult.PUSH:
        return betAmount; // Return original bet
      case HandResult.BUST:
      case HandResult.LOSE:
        return 0; // No payout
      default:
        return 0;
    }
  }

  /**
   * Gets available moves for a player
   */
  public getAvailableMoves(game: GameSession, player: Player, handIndex: number = 0): PlayerMove[] {
    const moves: PlayerMove[] = [];

    if (this.canHit(game, player, handIndex).valid) {
      moves.push(PlayerMove.HIT);
    }

    if (this.canStand(game, player, handIndex).valid) {
      moves.push(PlayerMove.STAND);
    }

    if (this.canDouble(game, player, handIndex).valid) {
      moves.push(PlayerMove.DOUBLE);
    }

    if (this.canSplit(game, player, handIndex).valid) {
      moves.push(PlayerMove.SPLIT);
    }

    return moves;
  }

  /**
   * Validates if it's a player's turn
   */
  public isPlayerTurn(game: GameSession, player: Player): boolean {
    if (game.state !== GameState.PLAYER_TURN) {
      return false;
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    return currentPlayer && currentPlayer.id === player.id;
  }

  /**
   * Gets the current player whose turn it is
   */
  public getCurrentPlayer(game: GameSession): Player | null {
    if (game.state !== GameState.PLAYER_TURN) {
      return null;
    }

    return game.players[game.currentPlayerIndex] || null;
  }
}
