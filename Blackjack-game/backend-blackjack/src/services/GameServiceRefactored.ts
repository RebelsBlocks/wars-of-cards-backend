/**
 * GameServiceRefactored - Orchestrates all game managers
 * This is the main service that coordinates between all the specialized managers
 */

import { GameState, PlayerMove, GameSession, Player, Card, HandData, PlayerState, HandResult } from '../types/game';
import { Server } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '../types/socket';
import { v4 as uuidv4 } from 'uuid';
import { Hand } from '../models/Hand';
import { Game } from '../models/Game';
import { Deck } from '../models/Deck';

// Import all managers
import { GameStateManager } from './managers/GameStateManager';
import { PlayerManager } from './managers/PlayerManager';
import { CardManager } from './managers/CardManager';
import { GameRulesEngine } from './managers/GameRulesEngine';
import { TimerManager } from './managers/TimerManager';
import { BuyInManager } from './managers/BuyInManager';
import { WinnerCalculator } from './managers/WinnerCalculator';

// Typ dla stanu gry wysyłanego do klienta (z occupiedSeats jako array)
type GameStateForClient = Omit<GameSession, 'occupiedSeats'> & {
  occupiedSeats: number[];
};

export class GameServiceRefactored {
  private games: Map<string, GameSession> = new Map();
  
  // Initialize all managers
  private gameStateManager: GameStateManager;
  private playerManager: PlayerManager;
  private cardManager: CardManager;
  private gameRulesEngine: GameRulesEngine;
  private timerManager: TimerManager;
  private buyInManager: BuyInManager;
  private winnerCalculator: WinnerCalculator;

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    // Initialize all managers
    this.gameStateManager = new GameStateManager();
    this.playerManager = new PlayerManager();
    this.cardManager = new CardManager();
    this.gameRulesEngine = new GameRulesEngine();
    this.timerManager = new TimerManager(this.io);
    this.buyInManager = new BuyInManager(this.io);
    this.winnerCalculator = new WinnerCalculator(this.io);

    // Start cleanup interval
    setInterval(() => {
      this.cleanupDisconnectedPlayers();
    }, 60000);
  }

  // =======================
  // GAME MANAGEMENT
  // =======================

  /**
   * Creates a new game
   */
  public createGame(gameId?: string): any {
    const finalGameId = gameId || uuidv4();
    
    const dealer: Player = {
      id: 'dealer',
      hands: [{
        cards: [],
        bet: 0,
        isFinished: false,
        hasDoubled: false,
        hasSplit: false,
        result: undefined
      }],
      balance: 0,
      isDealer: true,
      hasPerformedSplit: false
    };

    const newGame: GameSession = {
      id: finalGameId,
      state: GameState.WAITING_FOR_PLAYERS,
      players: [dealer],
      currentPlayerIndex: 0,
      deck: new Deck().getDeckAsArray(),
      insuranceAvailable: false,
      insurancePhase: false,
      occupiedSeats: new Set()
    };

    this.games.set(finalGameId, newGame);
    this.broadcastGameState(newGame);
    return this.cleanGameStateForClient(newGame);
  }

  /**
   * Gets game state
   */
  public getGameState(gameId: string): any {
    const game = this.getGame(gameId);
    return game ? this.cleanGameStateForClient(game) : null;
  }

  /**
   * Finds available game
   */
  public findAvailableGame(): any {
    console.log(`Searching for available games among ${this.games.size} total games`);
    
    for (const game of this.games.values()) {
      const playerCount = this.playerManager.getPlayers(game).length;
      console.log(`Game ${game.id}: state=${game.state}, players=${playerCount}/3`);
      
      if (playerCount < 3) {
        console.log(`Found available game: ${game.id} with ${playerCount} players`);
        return this.cleanGameStateForClient(game);
      }
    }
    
    console.log('No available games found');
    return null;
  }

  /**
   * Gets player count
   */
  public getPlayerCount(gameId: string): { current: number; maximum: number } {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');

    const currentPlayers = this.playerManager.getPlayers(game).length;
    return {
      current: currentPlayers,
      maximum: 3
    };
  }

  // =======================
  // PLAYER MANAGEMENT
  // =======================

  /**
   * Joins a player to the game
   */
  public joinGame(gameId: string, seatNumber: number, initialBalance: number = 1000): Player {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');

    // Clear timers if needed (except during waiting/betting/player turn)
    if (game.state !== GameState.WAITING_FOR_PLAYERS && 
        game.state !== GameState.BETTING && 
        game.state !== GameState.PLAYER_TURN) {
      this.timerManager.clearAllTimers(game);
    }

    const player = this.playerManager.joinGame(game, seatNumber, initialBalance);
    
    // Handle game start logic
    this.handlePlayerJoinLogic(game, player);
    
    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz dołączył do miejsca ${seatNumber}.`);
    
    return player;
  }

  /**
   * Leaves a player from the game
   */
  public leaveGame(gameId: string, playerId: string): void {
    const game = this.getGame(gameId);
    if (!game) return;

    const player = this.playerManager.findPlayer(game, playerId);
    const wasCurrentPlayer = player && game.currentPlayerIndex === game.players.findIndex(p => p.id === player.id) && 
                           game.state === GameState.PLAYER_TURN;

    const removedPlayer = this.playerManager.leaveGame(game, playerId);
    if (!removedPlayer) return;

    // Handle current player leaving
    if (wasCurrentPlayer) {
      this.handleCurrentPlayerLeaving(game);
    }

    // Check if game should end
    if (this.gameStateManager.shouldEndGame(game)) {
      this.handleGameEnd(game);
    }

    this.broadcastGameState(game);
    this.io.to(gameId).emit('notification', `Gracz opuścił miejsce ${removedPlayer.seatNumber || 'nieznane'}.`);
  }

  // =======================
  // GAME FLOW
  // =======================

  /**
   * Starts a new round
   */
  public startRound(gameId: string): any {
    console.log(`🔍 DEBUG startRound called for game ${gameId}`);
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    // Reset game state
    this.gameStateManager.resetForNewRound(game);
    this.timerManager.clearAllTimers(game);
    
    // Transition to betting state
    this.gameStateManager.transitionTo(game, GameState.BETTING);
    
    // Initialize new deck
    this.cardManager.initializeDeck(game);
    
    // Activate players for new round
    this.playerManager.activatePlayersForNewRound(game);
    
    // Check for buy-in needs
    this.buyInManager.checkPlayersForBuyIn(game);
    
    this.broadcastGameState(game);
    
    // Start betting timers
    this.timerManager.startGlobalBetTimeout(game);
    
    return this.cleanGameStateForClient(game);
  }

  /**
   * Places a bet
   */
  public placeBet(gameId: string, playerId: string, amount: number): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    // Update player activity
    this.timerManager.updatePlayerActivity(player);

    // Validate bet
    const validation = this.gameRulesEngine.canPlaceBet(game, player, amount);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // Handle insufficient funds
    if (player.balance < amount) {
      if (player.balance === 0) {
        this.buyInManager.requestBuyIn(game, player);
        throw new Error('Player must buy chips before placing a bet');
      }
      throw new Error('Insufficient funds');
    }

    // Place the bet
    player.hands[0].bet = amount;
    player.balance -= amount;

    // Switch from observing to active if needed
    if (player.state === PlayerState.OBSERVING) {
      this.playerManager.changePlayerState(player, PlayerState.ACTIVE);
    }

    console.log(`💰 BET: Player ${player.seatNumber} bets $${amount} (balance: $${player.balance})`);

    // Check if all players finished betting
    this.checkAllPlayersFinishedBetting(game);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // =======================
  // GAME ACTIONS
  // =======================

  /**
   * Processes a hit move
   */
  public processHit(gameId: string, playerId: string): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    this.timerManager.updatePlayerActivity(player);

    // Validate move
    const validation = this.gameRulesEngine.canHit(game, player);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // Deal card
    const card = this.cardManager.dealCardToPlayer(game, player);
    const handIndex = player.currentHandIndex || 0;

    console.log(`🎯 HIT: Player ${player.seatNumber} draws ${this.formatCard(card)}`);

    // Check result
    const result = this.gameRulesEngine.processHit(game, player, handIndex);
    
    if (result.isBust) {
      console.log(`💥 BUST! Player ${player.seatNumber} went over 21 with ${result.newHandValue}`);
      this.nextPlayer(game);
    } else {
      console.log(`✅ Player ${player.seatNumber} is safe with ${result.newHandValue}`);
      // Restart timer for continued play
      this.timerManager.startMoveTimeout(game, player);
    }

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  /**
   * Processes a stand move
   */
  public processStand(gameId: string, playerId: string): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    this.timerManager.updatePlayerActivity(player);

    // Validate move
    const validation = this.gameRulesEngine.canStand(game, player);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // Process stand
    const result = this.gameRulesEngine.processStand(game, player);
    if (!result.success) {
      throw new Error(result.reason);
    }

    const handIndex = player.currentHandIndex || 0;
    const handValue = this.gameRulesEngine.getHandValue(player.hands[handIndex].cards);
    
    console.log(`🛑 STAND: Player ${player.seatNumber} stands with ${handValue}`);

    this.nextPlayer(game);
    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  /**
   * Processes a double down move
   */
  public processDouble(gameId: string, playerId: string): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    this.timerManager.updatePlayerActivity(player);

    // Validate move
    const validation = this.gameRulesEngine.canDouble(game, player);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // Process double
    const result = this.gameRulesEngine.processDouble(game, player);
    if (!result.success) {
      throw new Error(result.reason);
    }

    // Deal one card
    const card = this.cardManager.dealCardToPlayer(game, player);
    const handIndex = player.currentHandIndex || 0;
    const handValue = this.gameRulesEngine.getHandValue(player.hands[handIndex].cards);
    
    console.log(`💰 DOUBLE: Player ${player.seatNumber} doubles to $${result.newBetAmount}`);
    console.log(`   Draws: ${this.formatCard(card)}`);
    console.log(`   Final hand: [${this.formatHand(player.hands[handIndex].cards)}] = ${handValue}`);

    this.nextPlayer(game);
    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  /**
   * Processes a split move
   */
  public processSplit(gameId: string, playerId: string): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    this.timerManager.updatePlayerActivity(player);

    // Validate move
    const validation = this.gameRulesEngine.canSplit(game, player);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    // Process split
    const result = this.gameRulesEngine.processSplit(game, player);
    if (!result.success) {
      throw new Error(result.reason);
    }

    // Deal cards to both hands
    const handIndex = player.currentHandIndex || 0;
    this.cardManager.dealCardToPlayer(game, player, 0); // First hand
    this.cardManager.dealCardToPlayer(game, player, 1); // Second hand

    console.log(`✂️ SPLIT: Player ${player.seatNumber} splits into ${result.newHands} hands`);

    // Restart timer for split hands
    this.timerManager.startMoveTimeout(game, player);

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  // =======================
  // BUY-IN MANAGEMENT
  // =======================

  /**
   * Handles buy-in request
   */
  public handleBuyInRequest(gameId: string, playerId: string, amount: number): any {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game does not exist');
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) throw new Error('Player does not exist');

    const result = this.buyInManager.handleBuyInRequest(game, player, amount);
    if (!result.success) {
      throw new Error(result.reason);
    }

    // Determine player state after buy-in
    const newState = this.buyInManager.determinePlayerStateAfterBuyIn(game, player);
    this.playerManager.changePlayerState(player, newState);

    // Check if betting can continue
    if (game.state === GameState.BETTING) {
      this.checkAllPlayersFinishedBetting(game);
    }

    this.broadcastGameState(game);
    return this.cleanGameStateForClient(game);
  }

  /**
   * Handles buy-in decline
   */
  public handleBuyInDecline(gameId: string, playerId: string): void {
    const game = this.getGame(gameId);
    if (!game) return;
    
    const player = this.playerManager.findPlayer(game, playerId);
    if (!player) return;

    this.buyInManager.handleBuyInDecline(game, player);
    this.leaveGame(gameId, playerId);
  }

  // =======================
  // PRIVATE HELPER METHODS
  // =======================

  private getGame(gameId: string): GameSession | undefined {
    return this.games.get(gameId);
  }

  private handlePlayerJoinLogic(game: GameSession, player: Player): void {
    const playerCount = this.playerManager.getPlayers(game).length;
    
    if (this.gameStateManager.shouldStartImmediately(game)) {
      console.log(`🔍 DEBUG joinGame: Table will be full (${playerCount}/3 players) - starting game immediately`);
      this.startRound(game.id);
      this.io.to(game.id).emit('notification', `Stół pełny! Gra rozpoczyna się z ${playerCount} graczami!`);
    } else if (playerCount === 1 && game.state === GameState.WAITING_FOR_PLAYERS) {
      console.log(`🔍 DEBUG joinGame: Starting game countdown for first player`);
      this.timerManager.startGameCountdown(game, () => this.startRound(game.id));
    } else if (playerCount > 1 && game.state === GameState.WAITING_FOR_PLAYERS) {
      console.log(`🔍 DEBUG joinGame: Restarting game countdown for additional player (${playerCount} total)`);
      this.timerManager.startGameCountdown(game, () => this.startRound(game.id));
    }
  }

  private handleCurrentPlayerLeaving(game: GameSession): void {
    console.log(`🔄 Current player leaving, advancing to next player`);
    try {
      this.nextPlayer(game);
    } catch (e) {
      console.warn('nextPlayer threw during leaveGame, continuing cleanup', e);
    }
  }

  private handleGameEnd(game: GameSession): void {
    this.timerManager.clearAllTimers(game);
    this.gameStateManager.transitionTo(game, GameState.WAITING_FOR_PLAYERS);
    
    // Reset game state
    game.currentPlayerIndex = 0;
    game.currentTurnStartTime = undefined;
    game.lastMoveTime = undefined;
    
    // Clear all hands
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
      }
    });
    
    // New deck
    this.cardManager.initializeDeck(game);
    
    this.io.to(game.id).emit('notification', 'Wszyscy gracze opuścili stół. Gra zresetowana.');
  }

  private checkAllPlayersFinishedBetting(game: GameSession): void {
    if (this.buyInManager.hasPlayersAwaitingBuyIn(game)) {
      console.log(`⏳ Waiting for players to buy-in before starting round`);
      return;
    }

    if (this.gameStateManager.allPlayersFinishedBetting(game)) {
      console.log(`🎲 All active players placed bets! Starting card dealing...`);
      this.timerManager.clearGlobalBetTimers(game);
      this.startDealingCards(game);
    } else if (this.gameStateManager.allPlayersSittingOut(game)) {
      console.log(`🎲 All players are sitting out - ending round immediately`);
      this.timerManager.clearGlobalBetTimers(game);
      this.endRound(game);
    }
  }

  private startDealingCards(game: GameSession): void {
    this.timerManager.clearAllTimers(game);
    this.gameStateManager.transitionTo(game, GameState.DEALING_INITIAL_CARDS);
    this.broadcastGameState(game);
    
    setTimeout(() => {
      this.cardManager.dealInitialCards(game);
      this.timerManager.clearAllTimers(game);
      this.gameStateManager.transitionTo(game, GameState.PLAYER_TURN);
      game.currentTurnStartTime = Date.now();
      
      const firstPlayer = this.playerManager.getNextPlayerInTurn(game);
      if (firstPlayer) {
        const playerIndex = game.players.findIndex(p => p.id === firstPlayer.id);
        game.currentPlayerIndex = playerIndex;
        this.timerManager.startMoveTimeout(game, firstPlayer);
      }
      
      this.broadcastGameState(game);
    }, 2000);
  }

  private nextPlayer(game: GameSession): void {
    const currentPlayer = game.players[game.currentPlayerIndex];
    
    // Clear current player timers
    if (currentPlayer && !currentPlayer.isDealer) {
      this.timerManager.clearPlayerMoveTimers(currentPlayer);
    }

    // Check if player has more hands to play
    if (currentPlayer && !currentPlayer.isDealer) {
      const nextHandIndex = (currentPlayer.currentHandIndex || 0) + 1;
      if (currentPlayer.hands.length > nextHandIndex && !currentPlayer.hands[nextHandIndex]?.isFinished) {
        currentPlayer.currentHandIndex = nextHandIndex;
        
        // Deal card to new hand if it came from split
        if (currentPlayer.hands[nextHandIndex].cards.length === 1) {
          this.cardManager.dealCardToPlayer(game, currentPlayer, nextHandIndex);
          
          // Check if bust
          const handValue = this.gameRulesEngine.getHandValue(currentPlayer.hands[nextHandIndex].cards);
          if (handValue > 21) {
            console.log(`💥 BUST! Player ${currentPlayer.seatNumber} second hand busted with ${handValue}`);
            currentPlayer.hands[nextHandIndex].result = HandResult.BUST;
            currentPlayer.hands[nextHandIndex].isFinished = true;
            this.nextPlayer(game);
            return;
          }
        }
        
        game.currentTurnStartTime = Date.now();
        this.timerManager.startMoveTimeout(game, currentPlayer);
        return;
      }
    }

    // Find next player with unfinished hands
    const playersWithUnfinishedHands = this.playerManager.getPlayersWithUnfinishedHands(game);
    
    if (playersWithUnfinishedHands.length === 0) {
      // All players finished - dealer's turn
      this.startDealerTurn(game);
    } else {
      // Next player's turn
      const nextPlayer = playersWithUnfinishedHands[0];
      game.currentPlayerIndex = game.players.findIndex(p => p.id === nextPlayer.id);
      nextPlayer.currentHandIndex = 0;
      game.currentTurnStartTime = Date.now();
      this.timerManager.startMoveTimeout(game, nextPlayer);
    }
  }

  private startDealerTurn(game: GameSession): void {
    console.log(`🎩 === DEALER'S TURN ===`);
    
    game.currentPlayerIndex = -1;
    this.timerManager.clearAllTimers(game);
    this.gameStateManager.transitionTo(game, GameState.DEALER_TURN);
    
    const dealer = game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('No dealer found');

    // Reveal dealer cards
    this.cardManager.revealDealerCards(game);
    
    const dealerValue = this.cardManager.getDealerHandValue(game);
    console.log(`🎩 Dealer reveals hand: [${this.formatHand(dealer.hands[0].cards)}] = ${dealerValue}`);

    // Dealer draws until 17 or bust
    while (dealerValue < 17) {
      this.cardManager.dealCardToDealer(game);
      const newValue = this.cardManager.getDealerHandValue(game);
      
      if (newValue > 21) {
        console.log(`💥 Dealer busted with ${newValue}!`);
        break;
      }
    }

    const finalValue = this.cardManager.getDealerHandValue(game);
    if (finalValue > 21) {
      console.log(`💥 Dealer BUSTS with ${finalValue}!`);
    } else {
      console.log(`✅ Dealer stands with ${finalValue}`);
    }

    this.endRound(game);
  }

  private endRound(game: GameSession): void {
    console.log(`🏁 === ROUND ENDED ===`);
    
    game.currentPlayerIndex = -1;
    this.timerManager.clearAllTimers(game);
    
    // Determine winners
    const roundSummary = this.winnerCalculator.determineWinners(game);
    
    this.gameStateManager.transitionTo(game, GameState.ROUND_ENDED);
    this.broadcastGameState(game);
    
    // Start round break timer
    this.timerManager.startRoundBreakTimer(game, () => this.startRound(game.id));
  }

  private cleanupDisconnectedPlayers(): void {
    const now = Date.now();
    
    this.games.forEach((game, gameId) => {
      const playersToRemove: string[] = [];
      
      game.players.forEach(player => {
        if (!player.isDealer && this.timerManager.isPlayerInactive(player)) {
          console.log(`🚨 Removing inactive player ${player.id} (seat ${player.seatNumber}) from game ${gameId}`);
          playersToRemove.push(player.id);
        }
      });

      playersToRemove.forEach(playerId => {
        this.leaveGame(gameId, playerId);
      });

      // Remove empty games (except main table)
      const activePlayers = this.playerManager.getPlayers(game);
      if (activePlayers.length === 0 && game.state === GameState.WAITING_FOR_PLAYERS && gameId !== 'main-blackjack-table') {
        console.log(`Removing empty game ${gameId}`);
        this.games.delete(gameId);
      }
    });
  }

  private broadcastGameState(game: GameSession): void {
    if (!this.io) return;
    
    const cleanGame = this.cleanGameStateForClient(game);
    this.io.to(game.id).emit('gameState', cleanGame);
  }

  public cleanGameStateForClient(game: GameSession): any {
    const cleanGame = { ...game };
    
    // Remove timer fields
    cleanGame.players = game.players.map(player => ({
      ...player,
      betTimeoutId: undefined,
      moveTimeoutId: undefined,
      betIntervalId: undefined,
      moveIntervalId: undefined,
      lastActivity: undefined
    }));
    
    cleanGame.globalBetTimeoutId = undefined;
    cleanGame.globalBetIntervalId = undefined;
    cleanGame.globalBetStartTime = undefined;

    return cleanGame;
  }

  private formatCard(card: Card): string {
    const hand = new Hand([card]);
    return hand.formatHand();
  }

  private formatHand(cards: Card[]): string {
    const hand = new Hand(cards);
    return hand.formatHand();
  }
}
