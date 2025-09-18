/**
 * PlayerManager - Handles player joining/leaving, seat assignment, and player states
 * Responsible for managing player lifecycle and seat management
 */

import { GameSession, Player, PlayerState, GameState } from '../../types/game';
import { v4 as uuidv4 } from 'uuid';

export class PlayerManager {
  private readonly MAX_PLAYERS = 3;

  /**
   * Creates a new player and adds them to the game
   */
  public joinGame(
    game: GameSession, 
    seatNumber: number, 
    initialBalance: number = 1000
  ): Player {
    this.validateSeatAvailability(game, seatNumber);
    this.validatePlayerCount(game);

    const playerState = this.determinePlayerState(game);
    
    const player: Player = {
      id: uuidv4(),
      hands: [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false,
        result: undefined
      }],
      balance: initialBalance,
      isDealer: false,
      seatNumber: seatNumber,
      currentHandIndex: 0,
      state: playerState,
      hasPerformedSplit: false
    };

    // Add activity tracking
    (player as any).lastActivity = Date.now();

    game.players.push(player);
    game.occupiedSeats.add(seatNumber);

    console.log(`👤 Player joined seat ${seatNumber} with state: ${playerState}`);
    return player;
  }

  /**
   * Removes a player from the game
   */
  public leaveGame(game: GameSession, playerId: string): Player | null {
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      console.warn('Player not found:', playerId);
      return null;
    }

    const player = game.players[playerIndex];
    const wasCurrentPlayer = game.currentPlayerIndex === playerIndex && 
                           game.state === GameState.PLAYER_TURN;

    // Remove player from list
    game.players.splice(playerIndex, 1);

    // Adjust currentPlayerIndex if needed
    if (game.currentPlayerIndex > playerIndex) {
      game.currentPlayerIndex--;
    }

    // Free up the seat
    if (player.seatNumber) {
      game.occupiedSeats.delete(player.seatNumber);
    }

    console.log(`👤 Player left seat ${player.seatNumber || 'unknown'}`);
    return player;
  }

  /**
   * Gets available seats (1, 2, 3)
   */
  public getAvailableSeats(game: GameSession): number[] {
    const availableSeats: number[] = [];
    for (let i = 1; i <= this.MAX_PLAYERS; i++) {
      if (!game.occupiedSeats.has(i)) {
        availableSeats.push(i);
      }
    }
    return availableSeats;
  }

  /**
   * Gets occupied seats
   */
  public getOccupiedSeats(game: GameSession): number[] {
    return Array.from(game.occupiedSeats);
  }

  /**
   * Gets all non-dealer players
   */
  public getPlayers(game: GameSession): Player[] {
    return game.players.filter(p => !p.isDealer);
  }

  /**
   * Gets active players (not sitting out or awaiting buy-in)
   */
  public getActivePlayers(game: GameSession): Player[] {
    return game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE
    );
  }

  /**
   * Gets players awaiting buy-in
   */
  public getPlayersAwaitingBuyIn(game: GameSession): Player[] {
    return game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.AWAITING_BUY_IN
    );
  }

  /**
   * Gets players sitting out
   */
  public getPlayersSittingOut(game: GameSession): Player[] {
    return game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.SITTING_OUT
    );
  }

  /**
   * Gets players observing
   */
  public getPlayersObserving(game: GameSession): Player[] {
    return game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.OBSERVING
    );
  }

  /**
   * Finds a player by ID
   */
  public findPlayer(game: GameSession, playerId: string): Player | undefined {
    return game.players.find(p => p.id === playerId);
  }

  /**
   * Finds a player by seat number
   */
  public findPlayerBySeat(game: GameSession, seatNumber: number): Player | undefined {
    return game.players.find(p => p.seatNumber === seatNumber);
  }

  /**
   * Updates player activity timestamp
   */
  public updatePlayerActivity(player: Player): void {
    (player as any).lastActivity = Date.now();
  }

  /**
   * Changes player state
   */
  public changePlayerState(player: Player, newState: PlayerState): void {
    const oldState = player.state;
    player.state = newState;
    console.log(`👤 Player ${player.seatNumber} state changed: ${oldState} -> ${newState}`);
  }

  /**
   * Activates players for new round (from waiting/sitting out/observing states)
   */
  public activatePlayersForNewRound(game: GameSession): void {
    game.players.forEach(player => {
      if (!player.isDealer && (
        player.state === PlayerState.WAITING_FOR_NEXT_ROUND || 
        player.state === PlayerState.SITTING_OUT ||
        player.state === PlayerState.OBSERVING
      )) {
        this.changePlayerState(player, PlayerState.ACTIVE);
      }
    });
  }

  /**
   * Gets player count by state
   */
  public getPlayerCountByState(game: GameSession): Record<PlayerState, number> {
    const counts: Record<PlayerState, number> = {
      [PlayerState.ACTIVE]: 0,
      [PlayerState.SITTING_OUT]: 0,
      [PlayerState.OBSERVING]: 0,
      [PlayerState.WAITING_FOR_NEXT_ROUND]: 0,
      [PlayerState.AWAITING_BUY_IN]: 0
    };

    game.players.forEach(player => {
      if (!player.isDealer && player.state) {
        counts[player.state]++;
      }
    });

    return counts;
  }

  /**
   * Checks if a player can perform an action based on their state
   */
  public canPlayerAct(player: Player, gameState: GameState): boolean {
    if (player.isDealer) return false;
    
    switch (gameState) {
      case GameState.BETTING:
        return player.state === PlayerState.ACTIVE || 
               player.state === PlayerState.OBSERVING;
      case GameState.PLAYER_TURN:
        return player.state === PlayerState.ACTIVE;
      default:
        return false;
    }
  }

  /**
   * Gets the next player in turn order (seat 1, 2, 3)
   */
  public getNextPlayerInTurn(game: GameSession): Player | null {
    const activePlayers = this.getActivePlayers(game)
      .filter(p => p.hands.some(hand => hand.bet > 0))
      .sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));

    return activePlayers.length > 0 ? activePlayers[0] : null;
  }

  /**
   * Gets players with unfinished hands
   */
  public getPlayersWithUnfinishedHands(game: GameSession): Player[] {
    return this.getActivePlayers(game).filter(player => 
      player.hands.some(hand => !hand.isFinished && hand.bet > 0)
    );
  }

  /**
   * Validates seat availability
   */
  private validateSeatAvailability(game: GameSession, seatNumber: number): void {
    if (game.occupiedSeats.has(seatNumber)) {
      throw new Error(`Seat ${seatNumber} is already occupied`);
    }

    if (seatNumber < 1 || seatNumber > this.MAX_PLAYERS) {
      throw new Error(`Invalid seat number. Allowed: 1-${this.MAX_PLAYERS}`);
    }
  }

  /**
   * Validates player count
   */
  private validatePlayerCount(game: GameSession): void {
    const playerCount = game.players.filter(p => 
      !p.isDealer && p.state !== PlayerState.SITTING_OUT
    ).length;

    if (playerCount >= this.MAX_PLAYERS) {
      throw new Error(`Table is full. Maximum number of players: ${this.MAX_PLAYERS}`);
    }
  }

  /**
   * Determines initial player state based on current game state
   */
  private determinePlayerState(game: GameSession): PlayerState {
    if (game.state === GameState.PLAYER_TURN || 
        game.state === GameState.DEALER_TURN || 
        game.state === GameState.ROUND_ENDED ||
        game.state === GameState.DEALING_INITIAL_CARDS) {
      return PlayerState.OBSERVING;
    } else if (game.state === GameState.BETTING) {
      return PlayerState.ACTIVE;
    } else {
      return PlayerState.ACTIVE;
    }
  }
}
