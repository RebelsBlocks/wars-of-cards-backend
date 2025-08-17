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
  console.log('Nowe połączenie WebSocket');

  socket.on('joinGame', (gameId, playerId) => {
    socket.data.gameId = gameId;
    socket.data.playerId = playerId;
    socket.join(gameId);
    console.log(`Gracz ${playerId} dołączył do gry ${gameId}`);
  });

  socket.on('leaveGame', (gameId, playerId) => {
    socket.leave(gameId);
    socket.data.gameId = undefined;
    socket.data.playerId = undefined;
    console.log(`Gracz ${playerId} opuścił grę ${gameId}`);
  });

  socket.on('disconnect', () => {
    const { gameId, playerId } = socket.data;
    if (gameId && playerId) {
      console.log(`Gracz ${playerId} rozłączył się z gry ${gameId}`);
      // TODO: Obsługa rozłączenia gracza
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
