import { useMemo } from 'react';
import type { GameSession, GameInfo, Player } from '../types/game';
import { GameState, PlayerState } from '../types/game';
import { evaluatePokerHandWithCommunity } from '../utils/cardHelpers';
// Removed getHandValue import - no longer needed for poker

// 🆕 Poker mode flag (tymczasowo hardcoded)
const POKER_MODE = false; // będziemy to zmieniać ręcznie

/**
 * Centralny hook do przetwarzania stanu gry blackjack
 * Przekształca surowe dane z backend'u w czytelny interfejs dla UI
 */
export function useGame(gameData: GameSession | null, playerId: string | null): GameInfo {
  return useMemo(() => {
    // Usuń logowanie które powoduje spam w konsoli
    // console.log('🎮 useGame hook - Input data:', {
    //   gameData: gameData ? {
    //     state: gameData.state,
    //     currentPlayerIndex: gameData.currentPlayerIndex,
    //     playersCount: gameData.players.length,
    //     id: gameData.id
    //   } : null,
    //   playerId
    // });

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
          canFold: false,
          canCheck: false,
        },
        myPokerHand: '',
        potAmount: 0,
        currentBet: 0,
        timeRemaining: undefined,
        isTimeRunning: false,
      };
    }

    // 1. Identyfikacja graczy
    const currentPlayer = gameData.players.find(p => p.id === playerId && !p.isDealer) || null;
    const dealer = null; // Poker nie ma dealera
    const otherPlayers = gameData.players.filter(p => p.id !== playerId && !p.isDealer);

    // Usuń logowanie które powoduje spam w konsoli
    // console.log('👤 Player identification:', {
    //   playerId,
    //   totalPlayers: gameData.players.length,
    //   currentPlayerFound: !!currentPlayer,
    //   currentPlayerBalance: currentPlayer?.balance,
    //   currentPlayerSeat: currentPlayer?.seatNumber
    // });

    // 2. Sprawdzenie czy to kolej gracza
    const isMyTurn = 
      gameData.state === GameState.PLAYER_TURN &&
      gameData.players[gameData.currentPlayerIndex]?.id === playerId &&
      currentPlayer?.state === PlayerState.ACTIVE;

    // Usuń logowanie które powoduje spam w konsoli
    // console.log('👀 Turn check:', {
    //   state: gameData.state,
    //   currentPlayerIndex: gameData.currentPlayerIndex,
    //   currentPlayerId: gameData.players[gameData.currentPlayerIndex]?.id,
    //   myPlayerId: playerId,
    //   playerState: currentPlayer?.state,
    //   isMyTurn
    // });

    // 3. Get current hand
    const currentHandIndex = currentPlayer?.currentHandIndex || 0;
    const currentHand = currentPlayer?.hands[currentHandIndex];

    // 4. Poker-specific calculations
    const myPokerHand = currentHand && currentHand.cards.length > 0 
      ? evaluatePokerHandWithCommunity(currentHand.cards, gameData.communityCards || [])
      : '';
    const potAmount = gameData.pot || 0;
    const currentBet = gameData.currentBet || 0;

    // 5. Dostępne akcje poker
    const availableActions = {
      canFold: isMyTurn && !currentPlayer?.hasFolded,
      canCheck: isMyTurn && (gameData.currentBet === 0 || currentPlayer?.currentBet === gameData.currentBet),
      // Later: canCall, canRaise
    };

    // Usuń logowanie które powoduje spam w konsoli
    // console.log('🎯 Available actions:', {
    //   availableActions,
    //   conditions: {
    //     isMyTurn,
    //     playerBusted,
    //     playerBlackjack,
    //     hasCurrentHand: !!currentHand,
    //     handValue: currentHand ? getHandValue(currentHand) : null,
    //     balance: currentPlayer?.balance
    //   }
    // });

    // 6. Status gry
    const gameStatus = getGameStatus(gameData, currentPlayer, isMyTurn, POKER_MODE);

    // 7. Timer
    const timeRemaining = calculateTimeRemaining(gameData);
    const isTimeRunning = gameData.state === GameState.PLAYER_TURN; // 🚫 LEGACY: BETTING phase removed

    const result = {
      currentPlayer,
      dealer,
      otherPlayers,
      isMyTurn,
      gameStatus,
      availableActions,
      myPokerHand,
      potAmount,
      currentBet,
      timeRemaining,
      isTimeRunning,
    };
    
    return result;
  }, [gameData, playerId]);
}

/**
 * Generates game status description in English
 */
function getGameStatus(
  gameData: GameSession, 
  _currentPlayer: Player | null, 
  isMyTurn: boolean,
  POKER_MODE: boolean = false  // 🆕 dodaj parametr
): string {
  
  if (POKER_MODE) {
    // 🆕 POKER status messages
    switch (gameData.state) {
      case GameState.WAITING_FOR_PLAYERS:
        return 'Waiting for players...';
      // case GameState.BETTING: // 🚫 LEGACY: Betting phase - nie używane w pokerze
        return 'Betting round';  // zmienione z blackjack
      default:
        return 'Playing poker...';  // fallback
    }
  }
  
  // ✅ Existing blackjack logic unchanged
  switch (gameData.state) {
    case GameState.WAITING_FOR_PLAYERS:
      return 'Waiting for players...';
    
    // case GameState.BETTING: // 🚫 LEGACY: Betting phase - nie używane w pokerze
      return 'Place your bets';
    
    case GameState.DEALING_INITIAL_CARDS:
      return 'Dealing cards...';
    
    case GameState.PLAYER_TURN:
      if (isMyTurn) {
        return 'Your turn';
      }
      
      const currentTurnPlayer = gameData.players[gameData.currentPlayerIndex];
      const playerName = currentTurnPlayer?.seatNumber ? 
        `Player ${currentTurnPlayer.seatNumber}` : 'Other player';
      return `${playerName}'s turn`;
    
    case GameState.DEALER_TURN:
      return "Round ending..."; // ✅ POKER: Dealer nie gra
    
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
export function useCanPlayerAction(gameInfo: GameInfo, action: 'fold' | 'check'): boolean {
  switch (action) {
    case 'fold': return gameInfo.availableActions.canFold;
    case 'check': return gameInfo.availableActions.canCheck;
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
