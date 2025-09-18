/**
 * BuyInManager - Handles zero balance players and buy-in flow
 * Responsible for managing players who need to buy chips
 */

import { GameSession, Player, PlayerState, GameState } from '../../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../../types/socket';
import { RemoteSocket } from 'socket.io';

export class BuyInManager {
  private readonly MIN_BUY_IN = 100;

  constructor(private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {}

  /**
   * Checks players for buy-in needs at round start
   */
  public checkPlayersForBuyIn(game: GameSession): void {
    const playersWithoutMoney = game.players.filter(p => 
      !p.isDealer && 
      p.balance === 0 && 
      p.state !== PlayerState.AWAITING_BUY_IN
    );

    console.log(`💰 Checking players for buy-in at round start: ${playersWithoutMoney.length} players with zero balance`);

    playersWithoutMoney.forEach(player => {
      console.log(`💰 Player ${player.seatNumber} needs buy-in (balance: $${player.balance})`);
      this.requestBuyIn(game, player);
    });
  }

  /**
   * Requests buy-in from a specific player
   */
  public requestBuyIn(game: GameSession, player: Player): void {
    player.state = PlayerState.AWAITING_BUY_IN;
    
    this.sendBuyInRequestToPlayer(game, player);
    
    this.io.to(game.id).emit('notification', 
      `Player in seat ${player.seatNumber} needs to buy chips.`
    );
  }

  /**
   * Handles buy-in request from a player
   */
  public handleBuyInRequest(game: GameSession, player: Player, amount: number): {
    success: boolean;
    reason?: string;
  } {
    if (player.state !== PlayerState.AWAITING_BUY_IN) {
      return { success: false, reason: 'Player is not awaiting buy-in' };
    }

    if (amount < this.MIN_BUY_IN) {
      return { success: false, reason: `Minimum buy-in is $${this.MIN_BUY_IN}` };
    }

    // Add funds to player balance
    player.balance += amount;
    player.state = PlayerState.ACTIVE;

    console.log(`💰 Player ${player.seatNumber} bought in $${amount} (new balance: $${player.balance})`);

    // Send confirmation to player
    this.sendBuyInConfirmationToPlayer(game, player, amount);

    this.io.to(game.id).emit('notification', 
      `Player in seat ${player.seatNumber} bought chips for $${amount}.`
    );

    return { success: true };
  }

  /**
   * Handles buy-in decline (player leaves)
   */
  public handleBuyInDecline(game: GameSession, player: Player): void {
    console.log(`🚪 Player ${player.seatNumber} declined buy-in - leaving game`);
    
    this.io.to(game.id).emit('notification', 
      `Player in seat ${player.seatNumber} left the table.`
    );
  }

  /**
   * Checks if a player needs buy-in
   */
  public playerNeedsBuyIn(player: Player): boolean {
    return player.balance === 0 && player.state !== PlayerState.AWAITING_BUY_IN;
  }

  /**
   * Gets all players awaiting buy-in
   */
  public getPlayersAwaitingBuyIn(game: GameSession): Player[] {
    return game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.AWAITING_BUY_IN
    );
  }

  /**
   * Checks if there are any players awaiting buy-in
   */
  public hasPlayersAwaitingBuyIn(game: GameSession): boolean {
    return this.getPlayersAwaitingBuyIn(game).length > 0;
  }

  /**
   * Determines if a player should be activated or observe after buy-in
   */
  public determinePlayerStateAfterBuyIn(game: GameSession, player: Player): PlayerState {
    if (game.state === GameState.BETTING) {
      return PlayerState.ACTIVE;
    } else if (game.state === GameState.ROUND_ENDED || game.state === GameState.WAITING_FOR_PLAYERS) {
      return PlayerState.ACTIVE;
    } else {
      // Game is in progress (cards dealt, player turn, dealer turn)
      return PlayerState.OBSERVING;
    }
  }

  /**
   * Sends buy-in request to a specific player
   */
  private async sendBuyInRequestToPlayer(game: GameSession, player: Player): Promise<void> {
    try {
      const sockets = await this.io.in(game.id).fetchSockets();
      const playerSocket = sockets.find((s: RemoteSocket<ServerToClientEvents, SocketData>) => s.data.playerId === player.id);
      
      if (playerSocket) {
        console.log(`💰 Sending buy-in request to player ${player.seatNumber} (socket: ${playerSocket.id})`);
        playerSocket.emit('buyInRequired', {
          message: 'Your balance is 0. Buy chips or leave the table.',
          timeout: 30000, // 30 seconds
          minBuyIn: this.MIN_BUY_IN,
          gameId: game.id
        });
      } else {
        console.log(`⚠️ Socket not found for player ${player.seatNumber} - cannot send buy-in request`);
      }
    } catch (error) {
      console.error(`❌ Error sending buy-in to player ${player.seatNumber}:`, error);
    }
  }

  /**
   * Sends buy-in confirmation to a specific player
   */
  private async sendBuyInConfirmationToPlayer(game: GameSession, player: Player, amount: number): Promise<void> {
    try {
      const sockets = await this.io.in(game.id).fetchSockets();
      const playerSocket = sockets.find((s: RemoteSocket<ServerToClientEvents, SocketData>) => s.data.playerId === player.id);
      
      if (playerSocket) {
        console.log(`✅ Sending buy-in confirmation to player ${player.seatNumber} (socket: ${playerSocket.id})`);
        playerSocket.emit('buyInConfirmed', {
          newBalance: player.balance,
          buyInAmount: amount
        });
      } else {
        console.log(`⚠️ Socket not found for player ${player.seatNumber} - cannot send buy-in confirmation`);
      }
    } catch (error) {
      console.error(`❌ Error sending buy-in confirmation to player ${player.seatNumber}:`, error);
    }
  }

  /**
   * Gets minimum buy-in amount
   */
  public getMinBuyIn(): number {
    return this.MIN_BUY_IN;
  }

  /**
   * Validates buy-in amount
   */
  public validateBuyInAmount(amount: number): { valid: boolean; reason?: string } {
    if (amount < this.MIN_BUY_IN) {
      return { valid: false, reason: `Minimum buy-in is $${this.MIN_BUY_IN}` };
    }

    if (amount <= 0) {
      return { valid: false, reason: 'Buy-in amount must be positive' };
    }

    return { valid: true };
  }

  /**
   * Checks if a player can afford a bet after buy-in
   */
  public canAffordBetAfterBuyIn(player: Player, betAmount: number): boolean {
    return player.balance >= betAmount;
  }

  /**
   * Gets buy-in statistics for the game
   */
  public getBuyInStats(game: GameSession): {
    playersNeedingBuyIn: number;
    playersAwaitingBuyIn: number;
    totalPlayersWithZeroBalance: number;
  } {
    const playersNeedingBuyIn = game.players.filter(p => 
      !p.isDealer && this.playerNeedsBuyIn(p)
    ).length;

    const playersAwaitingBuyIn = this.getPlayersAwaitingBuyIn(game).length;

    const totalPlayersWithZeroBalance = game.players.filter(p => 
      !p.isDealer && p.balance === 0
    ).length;

    return {
      playersNeedingBuyIn,
      playersAwaitingBuyIn,
      totalPlayersWithZeroBalance
    };
  }
}
