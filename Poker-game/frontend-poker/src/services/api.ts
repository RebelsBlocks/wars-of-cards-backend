import { PlayerMove } from '../types/game';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export class ApiService {
  /**
   * Make a player move (HIT, STAND, DOUBLE, SPLIT)
   */
  static async makeMove(gameId: string, playerId: string, move: PlayerMove): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId,
          move
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to make move');
      }

      await response.json();
    } catch (error) {
      console.error(`❌ Failed to make move ${move}:`, error);
      throw error;
    }
  }

  /**
   * Place a bet
   */
  static async placeBet(gameId: string, playerId: string, amount: number): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/bet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId,
          amount
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to place bet');
      }

      await response.json();
    } catch (error) {
      console.error(`❌ Failed to place bet of $${amount}:`, error);
      throw error;
    }
  }

  /**
   * Get current game state
   */
  static async getGameState(gameId: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        // ✅ Nie loguj - po prostu rzuć błąd
        throw new Error(errorData.error || 'Failed to get game state');
      }

      return await response.json();
    } catch (error) {
      // ✅ Usuń console.error - niech App.tsx obsługuje w ciszy
      throw error;
    }
  }

  /**
   * Join existing game or create new one
   */
  static async joinOrCreateGame(seatNumber: number, initialBalance: number): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/join-or-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seatNumber,
          initialBalance
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to join game');
      }

      return await response.json();
    } catch (error) {
      console.error('❌ Failed to join/create game:', error);
      throw error;
    }
  }

  /**
   * Leave current game
   */
  static async leaveGame(gameId: string, playerId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to leave game');
      }

      console.log('✅ Successfully left game');
    } catch (error) {
      console.error('❌ Failed to leave game:', error);
      throw error;
    }
  }

  /**
   * Split hand (creates additional endpoint for split-specific logic)
   */
  static async splitHand(gameId: string, playerId: string, handIndex: number = 0): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/split`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId,
          handIndex
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to split hand');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to split hand:', error);
      throw error;
    }
  }

  /**
   * Double down on current hand
   */
  static async doubleDown(gameId: string, playerId: string, handIndex: number = 0): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/double`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId,
          handIndex
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to double down');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to double down:', error);
      throw error;
    }
  }

  // 🆕 POKER ENDPOINTS

  /**
   * Fold hand (give up)
   */
  static async fold(gameId: string, playerId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/fold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fold');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to fold:', error);
      throw error;
    }
  }

  /**
   * Check (pass when no bet required)
   */
  static async check(gameId: string, playerId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to check');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to check:', error);
      throw error;
    }
  }

  /**
   * Call (match current bet)
   */
  static async call(gameId: string, playerId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to call');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to call:', error);
      throw error;
    }
  }

  /**
   * Raise (increase bet by amount)
   */
  static async raise(gameId: string, playerId: string, amount: number): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/games/${gameId}/raise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId,
          amount
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to raise');
      }

      await response.json();
    } catch (error) {
      console.error('❌ Failed to raise:', error);
      throw error;
    }
  }
}

// Export convenience functions for easier use
export const api = {
  // Core game functions
  placeBet: ApiService.placeBet,
  getGameState: ApiService.getGameState,
  joinOrCreateGame: ApiService.joinOrCreateGame,
  leaveGame: ApiService.leaveGame,

  // 🆕 POKER ENDPOINTS - uproszczone
  fold: (gameId: string, playerId: string) => 
    fetch(`${API_BASE_URL}/games/${gameId}/fold`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }) 
    }),
    
  check: (gameId: string, playerId: string) => 
    fetch(`${API_BASE_URL}/games/${gameId}/check`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }) 
    }),
    
  call: (gameId: string, playerId: string) => 
    fetch(`${API_BASE_URL}/games/${gameId}/call`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }) 
    }),
    
  raise: (gameId: string, playerId: string, amount: number) => 
    fetch(`${API_BASE_URL}/games/${gameId}/raise`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, amount }) 
    }),
};
