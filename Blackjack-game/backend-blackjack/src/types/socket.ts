import { GameSession } from './game';

export interface ServerToClientEvents {
  // Aktualizacja stanu gry
  'gameState': (gameState: GameSession) => void;
  
  // Informacja o pozostałym czasie
  'timeUpdate': (data: {
    type: 'bet' | 'move';
    playerId: string;
    remainingTime: number;
    totalTime: number;
  }) => void;
  
  // Powiadomienia dla gracza
  'notification': (message: string) => void;
  
  // Błędy
  'error': (error: string) => void;
}

export interface ClientToServerEvents {
  // Dołączanie do pokoju gry
  'joinGame': (gameId: string, playerId: string) => void;
  
  // Opuszczanie pokoju gry
  'leaveGame': (gameId: string, playerId: string) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  gameId?: string;
  playerId?: string;
} 
