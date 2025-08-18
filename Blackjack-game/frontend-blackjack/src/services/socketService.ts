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
        this.socket.disconnect();
        this.socket = null;
      }

      // Sprawdź czy już nie ma timera reconnection
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Reset reconnection attempts
      this.reconnectAttempts = 0;

      await this.ensureGameExists();

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
    if (this.isInitializing) {
      return; // Nie rób nic jeśli już inicjalizujemy
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

  private async ensureGameExists() {
    try {
      // KROK 1: Sprawdź czy mamy już konkretną grę w localStorage
      if (this.gameId !== 'default-game') {
        console.log('Checking if stored game exists:', this.gameId);
        const response = await fetch(`${SOCKET_URL}/api/games/${this.gameId}`);
        if (response.ok) {
          const game = await response.json();
          const playerCount = game.players.filter((p: any) => !p.isDealer).length;
          if (playerCount < 3) { // Sprawdź czy są wolne miejsca
            console.log('Using existing stored game with free spots:', this.gameId);
            return;
          } else {
            console.log('Stored game is full, looking for other available games');
            // Gra pełna - wyczyść z localStorage i szukaj innej
            localStorage.removeItem(GAME_ID_STORAGE_KEY);
            this.gameId = 'default-game';
          }
        } else {
          // Gra nie istnieje - wyczyść localStorage
          console.log('Stored game not found, clearing localStorage');
          localStorage.removeItem(GAME_ID_STORAGE_KEY);
          this.gameId = 'default-game';
        }
      }

      // KROK 2: Szukaj JAKIEJKOLWIEK dostępnej gry z wolnymi miejscami
      console.log('Looking for any available game...');
      const availableResponse = await fetch(`${SOCKET_URL}/api/games/available`);
      if (availableResponse.ok) {
        const availableGame = await availableResponse.json();
        if (availableGame) {
          this.gameId = availableGame.id;
          localStorage.setItem(GAME_ID_STORAGE_KEY, this.gameId);
          console.log('Found and joined available game:', this.gameId);
          return; // Używamy istniejącej gry
        }
      }

      // KROK 3: Jeśli brak dostępnych gier - DOPIERO WTEDY twórz nową
      console.log('No available games found, creating new game...');
      const createResponse = await fetch(`${SOCKET_URL}/api/games`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (createResponse.ok) {
        const gameData = await createResponse.json();
        this.gameId = gameData.id;
        localStorage.setItem(GAME_ID_STORAGE_KEY, this.gameId);
        console.log('Created new game with ID:', this.gameId);
      } else {
        throw new Error('Failed to create game');
      }
    } catch (error) {
      console.error('Error ensuring game exists:', error);
      // Wyczyść localStorage przy błędzie i reset do default
      localStorage.removeItem(GAME_ID_STORAGE_KEY);
      this.gameId = 'default-game';
      throw error;
    }
  }

  private emit<K extends keyof EmitEvents>(
    event: K,
    ...args: Parameters<EmitEvents[K]>
  ) {
    if (!this.socket?.connected) {
      console.warn('Socket not connected, attempting to reconnect...');
      this.initialize().catch(console.error);
      return;
    }
    this.socket.emit(event, ...args);
  }

  joinGame(playerId: string) {
    this.emit('joinGame', this.gameId, playerId);
  }

  leaveGame(playerId: string) {
    this.emit('leaveGame', this.gameId, playerId);
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  async joinGameWithSeat(seatNumber: number, initialBalance: number): Promise<any> {
    // Zatrzymaj reconnection gdy user próbuje join
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      const response = await fetch(`${SOCKET_URL}/api/games/${this.gameId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seatNumber,
          initialBalance
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to join game');
      }

      const player = await response.json();
      return player;
    } catch (error) {
      console.error('Error joining game:', error);
      throw error;
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
      this.socket.disconnect();
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.isInitializing = false;
    this.isInitialized = false;
  }

  getGameId(): string {
    return this.gameId;
  }
}

export const socketService = new SocketService();