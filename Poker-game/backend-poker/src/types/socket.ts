import { GameSession } from './game';

export interface ServerToClientEvents {
  // Aktualizacja stanu gry
  'gameState': (gameState: GameSession) => void;
  
  // Informacja o pozostałym czasie
  'timeUpdate': (data: {
    type: 'bet' | 'move' | 'gameStart';
    playerId?: string;
    remainingTime: number;
    totalTime: number;
  }) => void;
  
  // Powiadomienia dla gracza
  'notification': (message: string) => void;
  
  // Błędy
  'error': (error: string) => void;
  
  // Event dla nieaktywnych graczy
  'kicked_for_inactivity': (data: {
    reason: string;
    canRejoin: boolean;
    gameId: string;
  }) => void;
  
  // Event gdy gra się kończy
  'gameEnded': (data: {
    reason: string;
    shouldReturnToLobby: boolean;
    clearSeats?: boolean;
  }) => void;
  
  // Event wymagający buy-in
  'buyInRequired': (data: {
    message: string;
    timeout: number;
    minBuyIn: number;
    gameId: string;
  }) => void;
  
  // Event potwierdzający buy-in
  'buyInConfirmed': (data: {
    newBalance: number;
    buyInAmount: number;
  }) => void;
}

export interface ClientToServerEvents {
  // Dołączanie do pokoju gry
  'joinGame': (gameId: string, playerId: string) => void;
  
  // Opuszczanie pokoju gry
  'leaveGame': (gameId: string, playerId: string) => void;
  
  // Buy-in request
  'requestBuyIn': (gameId: string, playerId: string, amount: number) => void;
  
  // Decline buy-in (leave game)
  'declineBuyIn': (gameId: string, playerId: string) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  gameId?: string;
  playerId?: string;
} 