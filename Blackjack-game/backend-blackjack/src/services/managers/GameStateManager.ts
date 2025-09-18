/**
 * GameStateManager - Handles game state transitions and validation
 * Responsible for managing the flow between different game phases
 */

import { GameState, GameSession, PlayerState } from '../../types/game';

export class GameStateManager {
  private readonly MAX_PLAYERS = 3;

  /**
   * Validates if a state transition is allowed
   */
  public canTransitionTo(currentState: GameState, newState: GameState): boolean {
    const validTransitions: Record<GameState, GameState[]> = {
      [GameState.WAITING_FOR_PLAYERS]: [GameState.BETTING],
      [GameState.BETTING]: [GameState.DEALING_INITIAL_CARDS, GameState.ROUND_ENDED],
      [GameState.DEALING_INITIAL_CARDS]: [GameState.PLAYER_TURN, GameState.ROUND_ENDED],
      [GameState.PLAYER_TURN]: [GameState.DEALER_TURN, GameState.ROUND_ENDED],
      [GameState.DEALER_TURN]: [GameState.ROUND_ENDED],
      [GameState.ROUND_ENDED]: [GameState.BETTING, GameState.WAITING_FOR_PLAYERS]
    };

    return validTransitions[currentState]?.includes(newState) || false;
  }

  /**
   * Transitions game to a new state with validation
   */
  public transitionTo(game: GameSession, newState: GameState): boolean {
    if (!this.canTransitionTo(game.state, newState)) {
      console.warn(`Invalid state transition: ${game.state} -> ${newState}`);
      return false;
    }

    const oldState = game.state;
    game.state = newState;
    
    console.log(`🔄 Game state transition: ${oldState} -> ${newState}`);
    return true;
  }

  /**
   * Checks if the game can start (has enough players)
   */
  public canStartGame(game: GameSession): boolean {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state !== PlayerState.SITTING_OUT && 
      p.state !== PlayerState.AWAITING_BUY_IN
    );
    
    return activePlayers.length > 0;
  }

  /**
   * Checks if the game should start immediately (table is full)
   */
  public shouldStartImmediately(game: GameSession): boolean {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state !== PlayerState.SITTING_OUT && 
      p.state !== PlayerState.AWAITING_BUY_IN
    );
    
    return activePlayers.length >= this.MAX_PLAYERS;
  }

  /**
   * Checks if all players have finished betting
   */
  public allPlayersFinishedBetting(game: GameSession): boolean {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE
    );
    
    return activePlayers.length > 0 && activePlayers.every(p => 
      p.hands.every(hand => hand.bet > 0)
    );
  }

  /**
   * Checks if all players are sitting out
   */
  public allPlayersSittingOut(game: GameSession): boolean {
    const activePlayers = game.players.filter(p => 
      !p.isDealer && 
      p.state === PlayerState.ACTIVE
    );
    
    return activePlayers.length === 0;
  }

  /**
   * Checks if there are players awaiting buy-in
   */
  public hasPlayersAwaitingBuyIn(game: GameSession): boolean {
    return game.players.some(p => 
      !p.isDealer && 
      p.state === PlayerState.AWAITING_BUY_IN
    );
  }

  /**
   * Checks if the game should end (no players left)
   */
  public shouldEndGame(game: GameSession): boolean {
    const totalPlayers = game.players.filter(p => !p.isDealer).length;
    return totalPlayers === 0;
  }

  /**
   * Gets the current game phase description
   */
  public getGamePhaseDescription(game: GameSession): string {
    switch (game.state) {
      case GameState.WAITING_FOR_PLAYERS:
        return "Players can join/leave seats freely";
      case GameState.BETTING:
        return "Players can place bets (burns tokens)";
      case GameState.DEALING_INITIAL_CARDS:
        return "Backend is dealing initial cards";
      case GameState.PLAYER_TURN:
        return `It's Seat ${game.currentPlayerIndex + 1}'s turn to make moves`;
      case GameState.DEALER_TURN:
        return "Dealer's turn to play";
      case GameState.ROUND_ENDED:
        return "Round completed, determining winners";
      default:
        return "Unknown game state";
    }
  }

  /**
   * Resets game state for a new round
   */
  public resetForNewRound(game: GameSession): void {
    game.currentPlayerIndex = -1;
    game.currentTurnStartTime = undefined;
    game.lastMoveTime = undefined;
    
    // Clear all player hands
    game.players.forEach(player => {
      player.hands = [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false,
        result: undefined
      }];
      
      if (!player.isDealer) {
        player.currentHandIndex = 0;
        player.hasPerformedSplit = false;
      }
    });
    
    console.log('🔄 Game state reset for new round');
  }

  /**
   * Gets the next state based on current game conditions
   */
  public getNextState(game: GameSession): GameState | null {
    switch (game.state) {
      case GameState.WAITING_FOR_PLAYERS:
        return this.canStartGame(game) ? GameState.BETTING : null;
        
      case GameState.BETTING:
        if (this.allPlayersSittingOut(game)) {
          return GameState.ROUND_ENDED;
        }
        if (this.allPlayersFinishedBetting(game) && !this.hasPlayersAwaitingBuyIn(game)) {
          return GameState.DEALING_INITIAL_CARDS;
        }
        return null;
        
      case GameState.DEALING_INITIAL_CARDS:
        return GameState.PLAYER_TURN;
        
      case GameState.PLAYER_TURN:
        // Check if all players have finished their turns
        const activePlayers = game.players.filter(p => 
          !p.isDealer && 
          p.state === PlayerState.ACTIVE && 
          p.hands.some(hand => hand.bet > 0)
        );
        
        const allFinished = activePlayers.every(player => 
          player.hands.every(hand => hand.isFinished)
        );
        
        return allFinished ? GameState.DEALER_TURN : null;
        
      case GameState.DEALER_TURN:
        return GameState.ROUND_ENDED;
        
      case GameState.ROUND_ENDED:
        return this.shouldEndGame(game) ? GameState.WAITING_FOR_PLAYERS : GameState.BETTING;
        
      default:
        return null;
    }
  }
}
