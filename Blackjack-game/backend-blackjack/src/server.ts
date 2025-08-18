import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createGameRouter } from './routes/game';
import { GameService } from './services/GameService';
import { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from './types/socket';

const app = express();
const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Tworzenie instancji GameService z dostępem do io
const gameService = new GameService(io);

// Routes
app.use('/api', createGameRouter(gameService));

// WebSocket handlers
io.on('connection', (socket) => {
  console.log('Nowe połączenie WebSocket:', socket.id);

  socket.on('joinGame', (gameId, playerId) => {
    socket.data.gameId = gameId;
    socket.data.playerId = playerId;
    socket.join(gameId);
    console.log(`Gracz ${playerId} dołączył do gry ${gameId} (socket: ${socket.id})`);
    
    // Wyślij aktualny stan gry do nowego gracza
    const gameState = gameService.getGameState(gameId);
    if (gameState) {
      socket.emit('gameState', {
        ...gameState,
        occupiedSeats: Array.from(gameState.occupiedSeats)
      } as any);
    }
  });

  socket.on('leaveGame', (gameId, playerId) => {
    try {
      gameService.leaveGame(gameId, playerId);
    } catch (error) {
      console.error('Error leaving game:', error);
    }
    
    socket.leave(gameId);
    socket.data.gameId = undefined;
    socket.data.playerId = undefined;
    console.log(`Gracz ${playerId} opuścił grę ${gameId}`);
  });

  socket.on('disconnect', (reason) => {
    console.log('Player disconnected:', reason, 'Socket data:', socket.data);
    const { gameId, playerId } = socket.data;
    if (gameId && playerId) {
      try {
        // Sprawdź czy gra nadal istnieje
        const game = gameService.getGameState(gameId);
        if (game) {
          console.log(`Removing player ${playerId} from game ${gameId} due to disconnect`);
          gameService.leaveGame(gameId, playerId);
        } else {
          console.warn(`Game ${gameId} not found during disconnect cleanup`);
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
        // Nie crashuj serwera - tylko zaloguj błąd
      }
    }
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Wystąpił błąd serwera' });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
