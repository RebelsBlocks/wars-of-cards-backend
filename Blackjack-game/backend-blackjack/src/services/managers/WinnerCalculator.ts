/**
 * WinnerCalculator - Handles win/loss/push calculations and payouts
 * Responsible for determining game results and calculating payouts
 */

import { GameSession, Player, HandResult, PlayerState } from '../../types/game';
import { Hand } from '../../models/Hand';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../../types/socket';

export interface GameResult {
  playerId: string;
  seatNumber: number;
  handIndex: number;
  betAmount: number;
  result: HandResult;
  payout: number;
  handValue: number;
  dealerValue: number;
}

export interface RoundSummary {
  dealerValue: number;
  dealerHasBlackjack: boolean;
  dealerBusted: boolean;
  results: GameResult[];
  totalPayouts: number;
  totalBets: number;
}

export class WinnerCalculator {
  constructor(private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {}

  /**
   * Determines winners for the entire round
   */
  public determineWinners(game: GameSession): RoundSummary {
    console.log(`🏁 === DETERMINING WINNERS FOR GAME ${game.id} ===`);

    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) {
      throw new Error('No dealer found in game');
    }

    const dealerHand = dealer.hands[0];
    const dealerHandInstance = new Hand(dealerHand.cards);
    const dealerValue = dealerHandInstance.calculateValue();
    const dealerHasBlackjack = dealerHandInstance.isBlackjack();
    const dealerBusted = dealerValue > 21;

    console.log(`🎩 Dealer final hand: [${this.formatHand(dealerHand.cards)}] = ${dealerValue}`);
    console.log(`🎩 Dealer blackjack: ${dealerHasBlackjack}, busted: ${dealerBusted}`);

    const results: GameResult[] = [];
    let totalPayouts = 0;
    let totalBets = 0;

    // Process each player
    for (const player of game.players) {
      if (player.isDealer || player.state === PlayerState.SITTING_OUT) continue;

      // Process each hand of the player
      player.hands.forEach((hand, handIndex) => {
        if (hand.bet === 0) return; // Skip hands with no bet

        const result = this.calculateHandResult(
          hand, 
          dealerValue, 
          dealerHasBlackjack, 
          dealerBusted
        );

        const payout = this.calculatePayout(hand.bet, result.result);
        
        // Update player balance
        player.balance += payout;

        // Store result
        const gameResult: GameResult = {
          playerId: player.id,
          seatNumber: player.seatNumber || 0,
          handIndex,
          betAmount: hand.bet,
          result: result.result,
          payout,
          handValue: result.handValue,
          dealerValue
        };

        results.push(gameResult);
        totalPayouts += payout;
        totalBets += hand.bet;

        // Send notification
        this.sendResultNotification(player, result, payout, dealerValue);

        console.log(`🎯 Player ${player.seatNumber} hand ${handIndex}: ${result.result} (${result.handValue} vs ${dealerValue}) - Payout: $${payout}`);
      });
    }

    const roundSummary: RoundSummary = {
      dealerValue,
      dealerHasBlackjack,
      dealerBusted,
      results,
      totalPayouts,
      totalBets
    };

    console.log(`🏁 Round summary: ${results.length} hands processed, $${totalPayouts} total payouts, $${totalBets} total bets`);
    return roundSummary;
  }

  /**
   * Calculates the result of a single hand vs dealer
   */
  private calculateHandResult(
    hand: any, 
    dealerValue: number, 
    dealerHasBlackjack: boolean, 
    dealerBusted: boolean
  ): { result: HandResult; handValue: number; handHasBlackjack: boolean } {
    const handInstance = new Hand(hand.cards);
    const handValue = handInstance.calculateValue();
    const handHasBlackjack = handInstance.isBlackjack();
    const handBusted = handValue > 21;

    // If hand already has a result (e.g., blackjack detected during dealing), use it
    if (hand.result) {
      return {
        result: hand.result,
        handValue,
        handHasBlackjack
      };
    }

    let result: HandResult;

    if (handBusted) {
      result = HandResult.BUST;
    } else if (handHasBlackjack && dealerHasBlackjack) {
      result = HandResult.PUSH;
    } else if (handHasBlackjack && !dealerHasBlackjack) {
      result = HandResult.BLACKJACK;
    } else if (dealerBusted) {
      result = HandResult.WIN;
    } else if (handValue > dealerValue) {
      result = HandResult.WIN;
    } else if (handValue === dealerValue) {
      result = HandResult.PUSH;
    } else {
      result = HandResult.LOSE;
    }

    // Update the hand result
    hand.result = result;

    return { result, handValue, handHasBlackjack };
  }

  /**
   * Calculates payout for a hand result
   */
  private calculatePayout(betAmount: number, result: HandResult): number {
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
   * Sends result notification to all players
   */
  private sendResultNotification(
    player: Player, 
    result: { result: HandResult; handValue: number; handHasBlackjack: boolean }, 
    payout: number, 
    dealerValue: number
  ): void {
    const { result: handResult, handValue } = result;
    const seatNumber = player.seatNumber || 0;

    switch (handResult) {
      case HandResult.BLACKJACK:
        this.io.to(player.id).emit('notification', 
          `Blackjack! Player ${seatNumber} wins $${payout}!`
        );
        break;
      case HandResult.WIN:
        this.io.to(player.id).emit('notification', 
          `Player ${seatNumber} wins with ${handValue} vs ${dealerValue}! Payout: $${payout}`
        );
        break;
      case HandResult.PUSH:
        this.io.to(player.id).emit('notification', 
          `Push! Player ${seatNumber} ties with ${handValue}. Bet returned: $${payout}`
        );
        break;
      case HandResult.BUST:
        this.io.to(player.id).emit('notification', 
          `Player ${seatNumber} busted with ${handValue}!`
        );
        break;
      case HandResult.LOSE:
        this.io.to(player.id).emit('notification', 
          `Player ${seatNumber} loses with ${handValue} vs ${dealerValue}.`
        );
        break;
    }
  }

  /**
   * Gets player statistics for the round
   */
  public getPlayerRoundStats(game: GameSession): Record<string, {
    totalBets: number;
    totalPayouts: number;
    netResult: number;
    handsPlayed: number;
    wins: number;
    losses: number;
    pushes: number;
    blackjacks: number;
    busts: number;
  }> {
    const stats: Record<string, any> = {};

    game.players.forEach(player => {
      if (player.isDealer) return;

      const playerStats = {
        totalBets: 0,
        totalPayouts: 0,
        netResult: 0,
        handsPlayed: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        blackjacks: 0,
        busts: 0
      };

      player.hands.forEach(hand => {
        if (hand.bet === 0) return;

        playerStats.totalBets += hand.bet;
        playerStats.handsPlayed++;

        if (hand.result) {
          const payout = this.calculatePayout(hand.bet, hand.result);
          playerStats.totalPayouts += payout;

          switch (hand.result) {
            case HandResult.WIN:
              playerStats.wins++;
              break;
            case HandResult.LOSE:
              playerStats.losses++;
              break;
            case HandResult.PUSH:
              playerStats.pushes++;
              break;
            case HandResult.BLACKJACK:
              playerStats.blackjacks++;
              break;
            case HandResult.BUST:
              playerStats.busts++;
              break;
          }
        }
      });

      playerStats.netResult = playerStats.totalPayouts - playerStats.totalBets;
      stats[player.id] = playerStats;
    });

    return stats;
  }

  /**
   * Gets game statistics
   */
  public getGameStats(game: GameSession): {
    totalPlayers: number;
    activePlayers: number;
    totalBets: number;
    totalPayouts: number;
    houseEdge: number;
  } {
    const totalPlayers = game.players.filter(p => !p.isDealer).length;
    const activePlayers = game.players.filter(p => 
      !p.isDealer && p.state === PlayerState.ACTIVE
    ).length;

    let totalBets = 0;
    let totalPayouts = 0;

    game.players.forEach(player => {
      if (player.isDealer) return;

      player.hands.forEach(hand => {
        if (hand.bet > 0) {
          totalBets += hand.bet;
          if (hand.result) {
            totalPayouts += this.calculatePayout(hand.bet, hand.result);
          }
        }
      });
    });

    const houseEdge = totalBets > 0 ? ((totalBets - totalPayouts) / totalBets) * 100 : 0;

    return {
      totalPlayers,
      activePlayers,
      totalBets,
      totalPayouts,
      houseEdge: Math.round(houseEdge * 100) / 100
    };
  }

  /**
   * Formats a hand for logging
   */
  private formatHand(cards: any[]): string {
    const hand = new Hand(cards);
    return hand.formatHand();
  }

  /**
   * Validates if a round can be completed
   */
  public canCompleteRound(game: GameSession): boolean {
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) return false;

    // Check if dealer has played
    const dealerHand = dealer.hands[0];
    if (!dealerHand || dealerHand.cards.length < 2) return false;

    // Check if all active players have finished their hands
    const activePlayers = game.players.filter(p => 
      !p.isDealer && p.state === PlayerState.ACTIVE
    );

    return activePlayers.every(player => 
      player.hands.every(hand => hand.isFinished || hand.result !== undefined)
    );
  }
}
