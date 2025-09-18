/**
 * TimerManager - Handles all timeout logic and cleanup
 * Responsible for managing game timers, player timeouts, and cleanup
 */

import { GameSession, Player, GameState } from '../../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../../types/socket';

export class TimerManager {
  private readonly MOVE_TIMEOUT = 30000;  // 30 seconds for moves
  private readonly BET_TIMEOUT = 45000;   // 45 seconds for betting
  private readonly GAME_START_TIMEOUT = 20000; // 20 seconds for game start
  private readonly ROUND_BREAK_TIMEOUT = 5000; // 5 seconds break between rounds
  private readonly TIME_UPDATE_INTERVAL = 1000; // 1 second update interval
  private readonly PLAYER_TIMEOUT = 180000; // 3 minutes for inactive players
  private readonly BUY_IN_TIMEOUT = 30000; // 30 seconds for buy-in

  private gameStartTimers: Map<string, {
    timeout: NodeJS.Timeout;
    interval: NodeJS.Timeout;
  }> = new Map();

  private roundBreakTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {}

  /**
   * Starts game start countdown timer
   */
  public startGameCountdown(game: GameSession, onTimeout?: () => void): void {
    console.log(`🔍 DEBUG startGameCountdown called for game ${game.id}`);
    this.clearGameStartTimer(game.id);

    const startTime = Date.now();
    console.log(`🕐 GAME START COUNTDOWN: ${this.GAME_START_TIMEOUT/1000}s to wait for players`);

    // Update interval for countdown display
    const updateInterval = setInterval(() => {
      const remainingTime = this.GAME_START_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
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

    // Main timeout
    const gameStartTimer = setTimeout(() => {
      this.gameStartTimers.delete(game.id);
      
      const playerCount = game.players.filter(p => !p.isDealer).length;
      
      if (playerCount > 0) {
        console.log(`🕐 GAME START TIMEOUT EXPIRED - starting game with ${playerCount} players`);
        this.io.to(game.id).emit('notification', `Gra rozpoczyna się z ${playerCount} graczami!`);
        // Call the callback to start the game
        if (onTimeout) {
          onTimeout();
        }
      } else {
        console.log(`🕐 GAME START TIMEOUT EXPIRED - no players left`);
        game.state = GameState.WAITING_FOR_PLAYERS;
        this.io.to(game.id).emit('notification', 'Brak graczy przy stole.');
      }
    }, this.GAME_START_TIMEOUT);

    this.gameStartTimers.set(game.id, {
      timeout: gameStartTimer,
      interval: updateInterval
    });
  }

  /**
   * Starts global bet timeout for all players
   */
  public startGlobalBetTimeout(game: GameSession): void {
    this.clearGlobalBetTimers(game);

    const startTime = Date.now();
    game.globalBetStartTime = startTime;

    console.log(`⏰ Starting GLOBAL bet timeout for game ${game.id}: ${this.BET_TIMEOUT/1000}s total`);

    // Update interval
    game.globalBetIntervalId = setInterval(() => {
      const remainingTime = this.BET_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
        if (remainingTime % 10000 < 1000) {
          console.log(`💰 GLOBAL Betting time: ${Math.ceil(remainingTime/1000)}s remaining`);
        }
        this.io.to(game.id).emit('timeUpdate', {
          type: 'bet',
          remainingTime,
          totalTime: this.BET_TIMEOUT
        });
      } else {
        clearInterval(game.globalBetIntervalId);
        game.globalBetIntervalId = undefined;
      }
    }, this.TIME_UPDATE_INTERVAL);

    // Main timeout
    game.globalBetTimeoutId = setTimeout(() => {
      clearInterval(game.globalBetIntervalId);
      game.globalBetIntervalId = undefined;
      
      console.log(`⏰ GLOBAL BET TIMEOUT EXPIRED for game ${game.id}`);
      this.io.to(game.id).emit('notification', 'Czas na zakłady upłynął!');
      
      // The actual timeout handling should be done by the main service
    }, this.BET_TIMEOUT);
  }

  /**
   * Starts move timeout for a specific player
   */
  public startMoveTimeout(game: GameSession, player: Player): void {
    console.log(`⏰ Starting move timeout for player ${player.id} (seat ${player.seatNumber})`);

    this.clearPlayerMoveTimers(player);

    const startTime = Date.now();

    // Update interval
    const updateInterval = setInterval(() => {
      const remainingTime = this.MOVE_TIMEOUT - (Date.now() - startTime);
      if (remainingTime > 0) {
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
        if (player.moveIntervalId) {
          clearInterval(player.moveIntervalId);
          player.moveIntervalId = undefined;
        }
      }
    }, this.TIME_UPDATE_INTERVAL);

    player.moveIntervalId = updateInterval;

    // Main timeout
    player.moveTimeoutId = setTimeout(() => {
      clearInterval(updateInterval);
      if (player.moveIntervalId) {
        clearInterval(player.moveIntervalId);
        player.moveIntervalId = undefined;
      }

      if (game.state !== GameState.PLAYER_TURN) {
        console.log(`⏰ Move timeout expired but game state is ${game.state} - ignoring`);
        return;
      }

      if (game.players[game.currentPlayerIndex]?.id !== player.id) {
        console.log(`⏰ Move timeout expired but player ${player.id} is no longer current player - ignoring`);
        return;
      }

      const handIndex = player.currentHandIndex || 0;
      const currentHand = player.hands[handIndex];

      if (!currentHand || currentHand.isFinished) {
        console.log(`⏰ Move timeout expired but player ${player.id} hand is finished - ignoring`);
        return;
      }

      console.log(`⏰ Move timeout for player ${player.id} - auto STAND`);
      this.io.to(game.id).emit('notification', `Czas na ruch gracza ${player.seatNumber} upłynął. Automatycznie wykonano STAND.`);
      
      // The actual auto-stand logic should be handled by the main service
    }, this.MOVE_TIMEOUT);
  }

  /**
   * Starts buy-in timeout for a specific player
   */
  public startBuyInTimeout(game: GameSession, player: Player): void {
    this.clearPlayerBuyInTimer(player);

    console.log(`⏰ Starting buy-in timeout for player ${player.seatNumber}: ${this.BUY_IN_TIMEOUT/1000}s`);

    const buyInTimer = setTimeout(() => {
      if (player.state === 'AWAITING_BUY_IN' && player.balance === 0) {
        console.log(`💸 Player ${player.seatNumber} failed to buy-in in 30s - removing from game`);
        this.io.to(game.id).emit('notification', `Gracz z miejsca ${player.seatNumber} nie dokupił żetonów w 30 sekund. Opuścił stół.`);
        // The actual removal logic should be handled by the main service
      }
    }, this.BUY_IN_TIMEOUT);

    (player as any).buyInTimer = buyInTimer;
  }

  /**
   * Starts round break timer
   */
  public startRoundBreakTimer(game: GameSession, onTimeout?: () => void): void {
    this.clearRoundBreakTimer(game.id);

    console.log(`⏸️ ROUND BREAK: ${this.ROUND_BREAK_TIMEOUT/1000}s break before next round`);

    const roundBreakTimer = setTimeout(() => {
      console.log(`🔄 Round break finished - starting new round`);
      this.io.to(game.id).emit('notification', `Następna runda rozpocznie się za ${this.ROUND_BREAK_TIMEOUT / 1000} sekund...`);
      // Call the callback to start the new round
      if (onTimeout) {
        onTimeout();
      }
      
      this.roundBreakTimers.delete(game.id);
    }, this.ROUND_BREAK_TIMEOUT);

    this.roundBreakTimers.set(game.id, roundBreakTimer);
  }

  /**
   * Clears all timers for a game
   */
  public clearAllTimers(game: GameSession): void {
    console.log(`🧹 Clearing all timers for game ${game.id} (state: ${game.state})`);

    this.clearGameStartTimer(game.id);
    this.clearRoundBreakTimer(game.id);
    this.clearGlobalBetTimers(game);
    this.clearAllPlayerTimers(game);
  }

  /**
   * Clears game start timer
   */
  public clearGameStartTimer(gameId: string): void {
    const timers = this.gameStartTimers.get(gameId);
    if (timers) {
      clearTimeout(timers.timeout);
      clearInterval(timers.interval);
      this.gameStartTimers.delete(gameId);
      console.log(`🧹 CLEARED both gameStart timers for game ${gameId}`);
    }
  }

  /**
   * Clears round break timer
   */
  public clearRoundBreakTimer(gameId: string): void {
    const timer = this.roundBreakTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.roundBreakTimers.delete(gameId);
      console.log(`🧹 Cleared round break timer for game ${gameId}`);
    }
  }

  /**
   * Clears global bet timers
   */
  public clearGlobalBetTimers(game: GameSession): void {
    if (game.globalBetTimeoutId) {
      clearTimeout(game.globalBetTimeoutId);
      game.globalBetTimeoutId = undefined;
      console.log(`🧹 Cleared global bet timeout for game ${game.id}`);
    }
    if (game.globalBetIntervalId) {
      clearInterval(game.globalBetIntervalId);
      game.globalBetIntervalId = undefined;
      console.log(`🧹 Cleared global bet interval for game ${game.id}`);
    }
  }

  /**
   * Clears all player timers
   */
  public clearAllPlayerTimers(game: GameSession): void {
    game.players.forEach(player => {
      this.clearPlayerTimers(player);
    });
  }

  /**
   * Clears all timers for a specific player
   */
  public clearPlayerTimers(player: Player): void {
    this.clearPlayerMoveTimers(player);
    this.clearPlayerBetTimers(player);
    this.clearPlayerBuyInTimer(player);
  }

  /**
   * Clears move timers for a player
   */
  public clearPlayerMoveTimers(player: Player): void {
    if (player.moveTimeoutId) {
      clearTimeout(player.moveTimeoutId);
      player.moveTimeoutId = undefined;
    }
    if (player.moveIntervalId) {
      clearInterval(player.moveIntervalId);
      player.moveIntervalId = undefined;
    }
  }

  /**
   * Clears bet timers for a player
   */
  public clearPlayerBetTimers(player: Player): void {
    if (player.betTimeoutId) {
      clearTimeout(player.betTimeoutId);
      player.betTimeoutId = undefined;
    }
    if (player.betIntervalId) {
      clearInterval(player.betIntervalId);
      player.betIntervalId = undefined;
    }
  }

  /**
   * Clears buy-in timer for a player
   */
  public clearPlayerBuyInTimer(player: Player): void {
    if ((player as any).buyInTimer) {
      clearTimeout((player as any).buyInTimer);
      (player as any).buyInTimer = undefined;
    }
  }

  /**
   * Gets timeout constants
   */
  public getTimeouts() {
    return {
      MOVE_TIMEOUT: this.MOVE_TIMEOUT,
      BET_TIMEOUT: this.BET_TIMEOUT,
      GAME_START_TIMEOUT: this.GAME_START_TIMEOUT,
      ROUND_BREAK_TIMEOUT: this.ROUND_BREAK_TIMEOUT,
      PLAYER_TIMEOUT: this.PLAYER_TIMEOUT,
      BUY_IN_TIMEOUT: this.BUY_IN_TIMEOUT
    };
  }

  /**
   * Checks if a player is inactive and should be removed
   */
  public isPlayerInactive(player: Player): boolean {
    const lastActivity = (player as any).lastActivity || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    return timeSinceActivity > this.PLAYER_TIMEOUT;
  }

  /**
   * Updates player activity timestamp
   */
  public updatePlayerActivity(player: Player): void {
    (player as any).lastActivity = Date.now();
  }
}
