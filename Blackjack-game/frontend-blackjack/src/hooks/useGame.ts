import { useMemo } from 'react';
import type { GameSession, GameInfo, Player } from '../types/game';
import { GameState, PlayerState } from '../types/game';
import { 
  getHandValue, 
  isBlackjack, 
  isBusted, 
  canSplit, 
  canDouble 
} from '../utils/cardHelpers';

/**
 * Centralny hook do przetwarzania stanu gry blackjack
 * Przekształca surowe dane z backend'u w czytelny interfejs dla UI
 */
export function useGame(gameData: GameSession | null, playerId: string | null): GameInfo {
  return useMemo(() => {
    console.log('🎮 useGame hook - Input data:', {
      gameData: gameData ? {
        state: gameData.state,
        currentPlayerIndex: gameData.currentPlayerIndex,
        playersCount: gameData.players.length,
        id: gameData.id
      } : null,
      playerId
    });

    // Wartości domyślne gdy brak danych
    if (!gameData || !playerId) {
      console.log('⚠️ useGame hook - Missing data, returning default state');
      return {
        currentPlayer: null,
        dealer: null,
        otherPlayers: [],
        isMyTurn: false,
        gameStatus: 'Waiting for connection...',
        availableActions: {
          canHit: false,
          canStand: false,
          canDouble: false,
          canSplit: false,
        },
        myHandValue: 0,
        dealerHandValue: 0,
        isBlackjack: false,
        isBusted: false,
        timeRemaining: undefined,
        isTimeRunning: false,
      };
    }

    // 1. Identyfikacja graczy
    const currentPlayer = gameData.players.find(p => p.id === playerId && !p.isDealer) || null;
    const dealer = gameData.players.find(p => p.isDealer) || null;
    const otherPlayers = gameData.players.filter(p => p.id !== playerId && !p.isDealer);

    // 2. Sprawdzenie czy to kolej gracza
    const isMyTurn = 
      gameData.state === GameState.PLAYER_TURN &&
      gameData.players[gameData.currentPlayerIndex]?.id === playerId &&
      currentPlayer?.state === PlayerState.ACTIVE;

    console.log('👀 Turn check:', {
      state: gameData.state,
      currentPlayerIndex: gameData.currentPlayerIndex,
      currentPlayerId: gameData.players[gameData.currentPlayerIndex]?.id,
      myPlayerId: playerId,
      playerState: currentPlayer?.state,
      isMyTurn
    });

    // 3. Obliczenie wartości rąk
    const currentHandIndex = currentPlayer?.currentHandIndex || 0;
    const currentHand = currentPlayer?.hands[currentHandIndex];
    const dealerHand = dealer?.hands[0];

    const myHandValue = currentHand ? getHandValue(currentHand) : 0;
    const dealerHandValue = dealerHand ? getHandValue(dealerHand) : 0;

    // 4. Sprawdzenie specjalnych stanów
    const playerBlackjack = currentHand ? isBlackjack(currentHand) : false;
    const playerBusted = currentHand ? isBusted(currentHand) : false;

    // 5. Dostępne akcje
    const availableActions = {
      canHit: isMyTurn && !playerBusted && !playerBlackjack && !!currentHand,
      canStand: isMyTurn && !playerBusted && !!currentHand,
      canDouble: isMyTurn && currentHand ? canDouble(currentHand, currentPlayer?.balance || 0, currentHand.bet) : false,
      canSplit: isMyTurn && currentHand ? canSplit(currentHand) && (currentPlayer?.balance || 0) >= currentHand.bet : false,
    };

    console.log('🎯 Available actions:', {
      availableActions,
      conditions: {
        isMyTurn,
        playerBusted,
        playerBlackjack,
        hasCurrentHand: !!currentHand,
        handValue: currentHand ? getHandValue(currentHand) : null,
        balance: currentPlayer?.balance
      }
    });

    // 6. Status gry
    const gameStatus = getGameStatus(gameData, currentPlayer, isMyTurn, playerBlackjack, playerBusted);

    // 7. Timer
    const timeRemaining = calculateTimeRemaining(gameData);
    const isTimeRunning = gameData.state === GameState.PLAYER_TURN || gameData.state === GameState.BETTING;

    return {
      currentPlayer,
      dealer,
      otherPlayers,
      isMyTurn,
      gameStatus,
      availableActions,
      myHandValue,
      dealerHandValue,
      isBlackjack: playerBlackjack,
      isBusted: playerBusted,
      timeRemaining,
      isTimeRunning,
    };
  }, [gameData, playerId]);
}

/**
 * Generates game status description in English
 */
function getGameStatus(
  gameData: GameSession, 
  _currentPlayer: Player | null, 
  isMyTurn: boolean,
  isBlackjack: boolean,
  isBusted: boolean
): string {
  switch (gameData.state) {
    case GameState.WAITING_FOR_PLAYERS:
      return 'Waiting for players...';
    
    case GameState.BETTING:
      return 'Place your bets';
    
    case GameState.DEALING_INITIAL_CARDS:
      return 'Dealing cards...';
    
    case GameState.PLAYER_TURN:
      if (isMyTurn) {
        if (isBlackjack) return 'Blackjack! Wait for other players';
        if (isBusted) return 'Busted - you went over 21';
        return 'Your turn';
      }
      
      const currentTurnPlayer = gameData.players[gameData.currentPlayerIndex];
      const playerName = currentTurnPlayer?.seatNumber ? 
        `Player ${currentTurnPlayer.seatNumber}` : 'Other player';
      return `${playerName}'s turn`;
    
    case GameState.DEALER_TURN:
      return "Dealer's turn";
    
    case GameState.ROUND_ENDED:
      return 'Round ended - check results';
    
    default:
      return 'Unknown game state';
  }
}

/**
 * Oblicza pozostały czas tury w sekundach
 */
function calculateTimeRemaining(gameData: GameSession): number | undefined {
  if (!gameData.currentTurnStartTime) return undefined;
  
  const TURN_TIME_LIMIT = 30; // 30 sekund na turę
  const elapsed = Math.floor((Date.now() - gameData.currentTurnStartTime) / 1000);
  const remaining = Math.max(0, TURN_TIME_LIMIT - elapsed);
  
  return remaining;
}

/**
 * Hook pomocniczy do sprawdzania czy gracz może wykonać konkretną akcję
 */
export function useCanPlayerAction(gameInfo: GameInfo, action: 'hit' | 'stand' | 'double' | 'split'): boolean {
  switch (action) {
    case 'hit': return gameInfo.availableActions.canHit;
    case 'stand': return gameInfo.availableActions.canStand;
    case 'double': return gameInfo.availableActions.canDouble;
    case 'split': return gameInfo.availableActions.canSplit;
    default: return false;
  }
}

/**
 * Helper hook for formatting player status
 */
export function usePlayerStatusText(player: Player | null): string {
  if (!player) return 'No player';
  
  switch (player.state) {
    case PlayerState.ACTIVE: return 'Active';
    case PlayerState.SITTING_OUT: return 'Sitting out';
    case PlayerState.WAITING_FOR_NEXT_ROUND: return 'Waiting for round';
    default: return 'Unknown status';
  }
}
