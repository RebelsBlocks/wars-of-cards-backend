import { default as socketIO } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';
const GAME_ID_STORAGE_KEY = 'blackjack_game_id';
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
}

interface ClientToServerEvents {
  joinGame: (gameId: string, playerId: string) => void;
  leaveGame: (gameId: string, playerId: string) => void;
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
  private isInitializing = false; // 🔥 DODAJ TEN GUARD
  private isInitialized = false;  // 🔥 I TEN TEŻ
  private isIntentionalDisconnect = false; // 🔥 NOWA FLAGA dla celowego disconnect

  constructor() {
    const savedGameId = localStorage.getItem(GAME_ID_STORAGE_KEY);
    this.gameId = savedGameId || 'default-game';
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
      console.log('Connected to WebSocket server');
      this.reconnectAttempts = 0;
      this.isInitialized = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('Disconnected from WebSocket server:', reason);
      this.isInitialized = false;
      
      // Jeśli to celowy disconnect, nie próbuj reconnectować
      if (this.isIntentionalDisconnect) {
        console.log('Intentional disconnect, skipping reconnection');
        return;
      }
      
      // Nie reconnectuj jeśli disconnect jest przez server restart lub transport close
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        console.log('Server initiated disconnect, not attempting reconnection');
        return;
      }
      
      this.handleConnectionError();
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('Connection error:', error);
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
  }

  private handleConnectionError() {
    if (this.isInitializing || this.isIntentionalDisconnect) {
      return; // Nie rób nic jeśli już inicjalizujemy lub to celowy disconnect
    }

    if (this.reconnectAttempts >= RECONNECTION_ATTEMPTS) {
      console.log('Max reconnection attempts reached');
      // Wyczyść localStorage przy niemożności połączenia
      localStorage.removeItem(GAME_ID_STORAGE_KEY);
      this.gameId = 'default-game';
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
        // Jeśli kolejne próby też failują, wyczyść stan
        if (this.reconnectAttempts >= RECONNECTION_ATTEMPTS) {
          localStorage.removeItem(GAME_ID_STORAGE_KEY);
          this.gameId = 'default-game';
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
        
        // Zaktualizuj gameId
        this.gameId = result.game.id;
        localStorage.setItem(GAME_ID_STORAGE_KEY, this.gameId);
        
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
