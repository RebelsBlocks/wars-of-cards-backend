import { default as socketIO } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
const RECONNECTION_ATTEMPTS = 5;
const RECONNECTION_DELAY = 5000;

type GameState = any; // TODO: Define proper game state type

interface ServerToClientEvents {
  gameState: (state: GameState) => void;
  notification: (message: string) => void;
  timeUpdate: (data: {
    type: 'bet' | 'move' | 'gameStart';
    playerId?: string;
    remainingTime: number;
    totalTime: number;
  }) => void;
  kicked_for_inactivity: (data: {
    reason: string;
    canRejoin: boolean;
    gameId: string;
  }) => void;
  gameEnded: (data: {
    reason: string;
    shouldReturnToLobby: boolean;
    clearSeats?: boolean;
  }) => void;
  buyInRequired: (data: {
    message: string;
    timeout: number;
    minBuyIn: number;
    gameId: string;
  }) => void;
  buyInConfirmed: (data: {
    newBalance: number;
    buyInAmount: number;
  }) => void;
}

interface ClientToServerEvents {
  joinGame: (gameId: string, playerId: string) => void;
  leaveGame: (gameId: string, playerId: string) => void;
  requestBuyIn: (gameId: string, playerId: string, amount: number) => void;
  declineBuyIn: (gameId: string, playerId: string) => void;
}

type EmitEvents = {
  [K in keyof ClientToServerEvents]: (...args: Parameters<ClientToServerEvents[K]>) => void;
};

class SocketService {
  private socket: ReturnType<typeof socketIO> | null = null;
  private gameId: string;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private gameStateCallback: ((state: GameState) => void) | null = null;
  private notificationCallback: ((message: string) => void) | null = null;
  private timeUpdateCallback: ServerToClientEvents['timeUpdate'] | null = null;
  private kickedForInactivityCallback: ServerToClientEvents['kicked_for_inactivity'] | null = null;
  private gameEndedCallback: ServerToClientEvents['gameEnded'] | null = null;
  private buyInRequiredCallback: ServerToClientEvents['buyInRequired'] | null = null;
  private buyInConfirmedCallback: ServerToClientEvents['buyInConfirmed'] | null = null;
  private isInitializing = false; // 🔥 DODAJ TEN GUARD
  private isInitialized = false;  // 🔥 I TEN TEŻ
  private isIntentionalDisconnect = false; // 🔥 NOWA FLAGA dla celowego disconnect

  constructor() {
    // ✅ Zawsze ten sam stół - jeden wirtualny stół blackjacka
    this.gameId = 'main-blackjack-table';
  }

  async initialize() {
    // 🔥 GUARD - zapobiega wielokrotnym inicjalizacjom
    if (this.isInitializing) {
      console.log('Already initializing, skipping...');
      return;
    }

    if (this.isInitialized && this.socket?.connected) {
      console.log('Already initialized and connected');
      return;
    }

    this.isInitializing = true;

    try {
      // Wyczyść istniejące połączenie jeśli istnieje
      if (this.socket) {
        console.log('Disconnecting existing socket connection');
        // Usuń wszystkie listenery przed disconnect
        this.socket.removeAllListeners();
        // Oznacz jako celowy disconnect
        this.isIntentionalDisconnect = true;
        this.socket.disconnect();
        this.socket = null;
        // Reset flagi po krótkiej chwili
        setTimeout(() => {
          this.isIntentionalDisconnect = false;
        }, 100);
      }

      // Sprawdź czy już nie ma timera reconnection
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Reset reconnection attempts
      this.reconnectAttempts = 0;

      // ❌ Usuń ensureGameExists - gra będzie tworzona dopiero przy join
      // await this.ensureGameExists();

      this.socket = socketIO(SOCKET_URL, {
        reconnection: true,
        reconnectionAttempts: RECONNECTION_ATTEMPTS,
        reconnectionDelay: RECONNECTION_DELAY,
        timeout: 20000,
        forceNew: true, // 🔥 WYMUŚ NOWE POŁĄCZENIE
      });

      this.setupSocketListeners();

      return new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          this.isInitializing = false;
          reject(new Error('Socket not initialized'));
          return;
        }

        const connectTimeout = setTimeout(() => {
          this.isInitializing = false;
          reject(new Error('Connection timeout'));
        }, 10000);

        this.socket.on('connect', () => {
          clearTimeout(connectTimeout);
          console.log('Socket connected successfully');
          this.reconnectAttempts = 0;
          this.isInitializing = false;
          this.isInitialized = true;
          resolve();
        });

        this.socket.on('connect_error', (error: Error) => {
          clearTimeout(connectTimeout);
          console.error('Socket connection error:', error);
          this.isInitializing = false;
          this.handleConnectionError();
          reject(error);
        });
      });
    } catch (error) {
      this.isInitializing = false;
      console.error('Initialize error:', error);
      throw error;
    }
  }

  private setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('🔌 Socket connected successfully', {
        socketId: this.socket?.id,
        gameId: this.gameId,
        isInitialized: this.isInitialized
      });
      this.reconnectAttempts = 0;
      this.isInitialized = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('🔌 Socket disconnected:', {
        reason,
        socketId: this.socket?.id,
        gameId: this.gameId,
        isIntentionalDisconnect: this.isIntentionalDisconnect,
        reconnectAttempts: this.reconnectAttempts
      });
      this.isInitialized = false;
      
      // Jeśli to celowy disconnect, nie próbuj reconnectować
      if (this.isIntentionalDisconnect) {
        console.log('🚫 Intentional disconnect, skipping reconnection');
        return;
      }
      
      // Nie reconnectuj jeśli disconnect jest przez server restart lub transport close
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        console.log('⚠️ Server initiated disconnect, not attempting reconnection');
        return;
      }
      
      this.handleConnectionError();
    });

    // Dodaj logowanie dla gameState
    this.socket.on('gameState', (state: GameState) => {
      console.log('🎮 Received game state:', {
        state: state.state,
        playersCount: state.players?.length,
        currentPlayerIndex: state.currentPlayerIndex,
        // 🆕 POKER: Dodaj pola licytacji do logów
        pot: state.pot,
        currentBet: state.currentBet,
        players: state.players?.map((p: any) => ({
          id: p.id,
          seatNumber: p.seatNumber,
          currentBet: p.currentBet,
          totalBet: p.totalBet,
          balance: p.balance
        })),
        timestamp: new Date().toISOString()
      });
      if (this.gameStateCallback) {
        this.gameStateCallback(state);
      }
    });

    // Dodaj logowanie dla notification
    this.socket.on('notification', (message: string) => {
      console.log('📢 Game notification:', {
        message,
        timestamp: new Date().toISOString()
      });
      if (this.notificationCallback) {
        this.notificationCallback(message);
      }
    });

    // Dodaj obsługę kicked_for_inactivity
    this.socket.on('kicked_for_inactivity', (data: {
      reason: string;
      canRejoin: boolean;
      gameId: string;
    }) => {
      console.log('🚨 Kicked for inactivity:', {
        reason: data.reason,
        canRejoin: data.canRejoin,
        gameId: data.gameId,
        timestamp: new Date().toISOString()
      });
      if (this.kickedForInactivityCallback) {
        this.kickedForInactivityCallback(data);
      }
    });

    // Dodaj obsługę gameEnded
    this.socket.on('gameEnded', (data: {
      reason: string;
      shouldReturnToLobby: boolean;
    }) => {
      console.log('🏁 Game ended:', {
        reason: data.reason,
        shouldReturnToLobby: data.shouldReturnToLobby,
        timestamp: new Date().toISOString()
      });
      if (this.gameEndedCallback) {
        this.gameEndedCallback(data);
      }
    });

    // Dodaj obsługę buyInRequired
    this.socket.on('buyInRequired', (data: {
      message: string;
      timeout: number;
      minBuyIn: number;
      gameId: string;
    }) => {
      console.log('💰 Buy-in required:', {
        message: data.message,
        timeout: data.timeout,
        minBuyIn: data.minBuyIn,
        gameId: data.gameId,
        timestamp: new Date().toISOString()
      });
      if (this.buyInRequiredCallback) {
        this.buyInRequiredCallback(data);
      }
    });

    // Dodaj obsługę buyInConfirmed
    this.socket.on('buyInConfirmed', (data: {
      newBalance: number;
      buyInAmount: number;
    }) => {
      console.log('✅ Buy-in confirmed:', {
        newBalance: data.newBalance,
        buyInAmount: data.buyInAmount,
        timestamp: new Date().toISOString()
      });
      if (this.buyInConfirmedCallback) {
        this.buyInConfirmedCallback(data);
      }
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('❌ Connection error:', {
        error: error.message,
        socketId: this.socket?.id,
        gameId: this.gameId,
        reconnectAttempts: this.reconnectAttempts
      });
      this.isInitialized = false;
      this.handleConnectionError();
    });

    // Reattach callbacks if they exist
    if (this.gameStateCallback) {
      this.socket.on('gameState', this.gameStateCallback);
    }
    if (this.notificationCallback) {
      this.socket.on('notification', this.notificationCallback);
    }
    if (this.timeUpdateCallback) {
      this.socket.on('timeUpdate', this.timeUpdateCallback);
    }
    if (this.kickedForInactivityCallback) {
      this.socket.on('kicked_for_inactivity', this.kickedForInactivityCallback);
    }
    if (this.gameEndedCallback) {
      this.socket.on('gameEnded', this.gameEndedCallback);
    }
    if (this.buyInRequiredCallback) {
      this.socket.on('buyInRequired', this.buyInRequiredCallback);
    }
    if (this.buyInConfirmedCallback) {
      this.socket.on('buyInConfirmed', this.buyInConfirmedCallback);
    }
  }

  private handleConnectionError() {
    if (this.isInitializing || this.isIntentionalDisconnect) {
      return; // Nie rób nic jeśli już inicjalizujemy lub to celowy disconnect
    }

          if (this.reconnectAttempts >= RECONNECTION_ATTEMPTS) {
        console.log('Max reconnection attempts reached');
        // ✅ Nie czyścimy localStorage ani nie zmieniamy gameId - zawsze ten sam stół
        this.isInitialized = false;
        return;
      }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${RECONNECTION_ATTEMPTS})`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        console.error('Reconnection failed:', error);
        // ✅ Nie czyścimy stanu - zawsze ten sam stół
        if (this.reconnectAttempts >= RECONNECTION_ATTEMPTS) {
          this.isInitialized = false;
        }
      }
    }, RECONNECTION_DELAY);
  }

  // ❌ Usunięto ensureGameExists - teraz gra jest tworzona atomowo przy join

  private emit<K extends keyof EmitEvents>(
    event: K,
    ...args: Parameters<EmitEvents[K]>
  ) {
    if (!this.socket?.connected) {
      console.warn('Socket not connected. Cannot emit event:', event);
      // ❌ Usuń automatyczny initialize() - to powodowało cascade
      // this.initialize().catch(console.error);
      return;
    }
    this.socket.emit(event, ...args);
  }

  joinGame(playerId: string) {
    console.log(`🔌 Attempting to join WebSocket room - gameId: ${this.gameId}, playerId: ${playerId}`);
    if (!this.socket?.connected) {
      console.warn(`❌ Cannot join room - socket not connected`);
      return;
    }
    this.emit('joinGame', this.gameId, playerId);
    console.log(`✅ WebSocket joinGame event sent`);
  }

  leaveGame(playerId: string) {
    this.emit('leaveGame', this.gameId, playerId);
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  async joinGameWithSeat(seatNumber: number, initialBalance: number, maxRetries: number = 3): Promise<any> {
    // Zatrzymaj reconnection gdy user próbuje join
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Join attempt ${attempt}/${maxRetries} for seat ${seatNumber}`);
        
        // Użyj nowego atomowego endpointu
        const response = await fetch(`${SOCKET_URL}/api/games/join-or-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seatNumber, initialBalance })
        });

        if (!response.ok) {
          const errorData = await response.json();
          
          // Jeśli "Gra nie istnieje" lub "miejsce zajęte" - retry
          if ((errorData.error.includes('nie istnieje') || 
               errorData.error.includes('zajęte') ||
               errorData.error.includes('full') ||
               errorData.error.includes('pełny')) && 
               attempt < maxRetries) {
            console.log(`Attempt ${attempt} failed: ${errorData.error}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
            continue;
          }
          
          throw new Error(errorData.error || 'Failed to join game');
        }

        const result = await response.json();
        
        // ✅ gameId jest już ustawiony na 'main-blackjack-table' - nie zmieniamy!
        // localStorage.setItem(GAME_ID_STORAGE_KEY, this.gameId); // ❌ Usuń - nie potrzebujemy
        
        // ✅ KLUCZOWE: Dołącz do WebSocket room PRZED return
        console.log(`Joining WebSocket room for player ${result.player.id} in game ${this.gameId}`);
        this.joinGame(result.player.id);
        
        // ✅ Daj więcej czasu na połączenie WebSocket i synchronizację
        console.log(`Waiting for WebSocket synchronization...`);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        console.log(`Successfully joined game ${this.gameId} as player ${result.player.id}`);
        return result.player;
        
      } catch (error) {
        console.log(`Join attempt ${attempt} failed:`, error);
        if (attempt === maxRetries) {
          console.error('All join attempts failed');
          throw error; // Ostatnia próba - rzuć błąd
        }
        
        // Delay przed następną próbą (tylko jeśli to nie ostatnia próba)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
    }
  }

  async leaveGameHTTP(playerId: string): Promise<void> {
    try {
      const response = await fetch(`${SOCKET_URL}/api/games/${this.gameId}/leave`, {
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
    } catch (error) {
      console.error('Error leaving game:', error);
      throw error;
    }
  }

  onGameState(callback: ServerToClientEvents['gameState']) {
    // Usuń stary callback jeśli istnieje
    if (this.gameStateCallback && this.socket) {
      this.socket.off('gameState', this.gameStateCallback);
    }
    
    this.gameStateCallback = callback;
    if (this.socket) {
      this.socket.on('gameState', callback);
    }
  }

  onNotification(callback: ServerToClientEvents['notification']) {
    // Usuń stary callback jeśli istnieje
    if (this.notificationCallback && this.socket) {
      this.socket.off('notification', this.notificationCallback);
    }
    
    this.notificationCallback = callback;
    if (this.socket) {
      this.socket.on('notification', callback);
    }
  }

  onTimeUpdate(callback: ServerToClientEvents['timeUpdate']) {
    // Usuń stary callback jeśli istnieje
    if (this.timeUpdateCallback && this.socket) {
      this.socket.off('timeUpdate', this.timeUpdateCallback);
    }
    
    this.timeUpdateCallback = callback;
    if (this.socket) {
      this.socket.on('timeUpdate', callback);
    }
  }

  onKickedForInactivity(callback: ServerToClientEvents['kicked_for_inactivity']) {
    // Usuń stary callback jeśli istnieje
    if (this.kickedForInactivityCallback && this.socket) {
      this.socket.off('kicked_for_inactivity', this.kickedForInactivityCallback);
    }
    
    this.kickedForInactivityCallback = callback;
    if (this.socket) {
      this.socket.on('kicked_for_inactivity', callback);
    }
  }

  onGameEnded(callback: ServerToClientEvents['gameEnded']) {
    // Usuń stary callback jeśli istnieje
    if (this.gameEndedCallback && this.socket) {
      this.socket.off('gameEnded', this.gameEndedCallback);
    }
    
    this.gameEndedCallback = callback;
    if (this.socket) {
      this.socket.on('gameEnded', callback);
    }
  }

  onBuyInRequired(callback: ServerToClientEvents['buyInRequired']) {
    // Usuń stary callback jeśli istnieje
    if (this.buyInRequiredCallback && this.socket) {
      this.socket.off('buyInRequired', this.buyInRequiredCallback);
    }
    
    this.buyInRequiredCallback = callback;
    if (this.socket) {
      this.socket.on('buyInRequired', callback);
    }
  }

  onBuyInConfirmed(callback: ServerToClientEvents['buyInConfirmed']) {
    // Usuń stary callback jeśli istnieje
    if (this.buyInConfirmedCallback && this.socket) {
      this.socket.off('buyInConfirmed', this.buyInConfirmedCallback);
    }
    
    this.buyInConfirmedCallback = callback;
    if (this.socket) {
      this.socket.on('buyInConfirmed', callback);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      // Usuń wszystkie listenery przed disconnect
      this.socket.removeAllListeners();
      // Oznacz jako celowy disconnect
      this.isIntentionalDisconnect = true;
      this.socket.disconnect();
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.isInitializing = false;
    this.isInitialized = false;
    // Reset flagi po disconnect
    setTimeout(() => {
      this.isIntentionalDisconnect = false;
    }, 100);
  }

  getGameId(): string {
    return this.gameId;
  }

  // Metody do obsługi buy-in
  requestBuyIn(playerId: string, amount: number) {
    console.log(`💰 Requesting buy-in: $${amount} for player ${playerId}`);
    this.emit('requestBuyIn', this.gameId, playerId, amount);
  }

  declineBuyIn(playerId: string) {
    console.log(`🚪 Declining buy-in for player ${playerId}`);
    this.emit('declineBuyIn', this.gameId, playerId);
  }

  // Publiczna metoda do bezpiecznego restartu połączenia
  async reconnect(): Promise<void> {
    console.log('Manual reconnection requested');
    
    // Zatrzymaj automatyczne reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reset licznika prób
    this.reconnectAttempts = 0;
    
    // Wykonaj ponowną inicjalizację
    try {
      await this.initialize();
      console.log('Manual reconnection successful');
    } catch (error) {
      console.error('Manual reconnection failed:', error);
      throw error;
    }
  }

  // Metoda sprawdzająca czy jest w trakcie reconnection
  isReconnecting(): boolean {
    return this.reconnectTimer !== null || this.isInitializing;
  }
}

export const socketService = new SocketService();