import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createGameRouter } from './routes/game';
import { GameServiceRefactored } from './services/GameServiceRefactored';
import { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from './types/socket';
import { Socket } from 'socket.io';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'https://*.vercel.app', // Allow Vercel preview deployments
      'https://blajakcprivfrontend.vercel.app' // Your production domain
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false // Allow embedding for socket.io
}));

// Rate limiting for demo protection
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://*.vercel.app',
    'https://blajakcprivfrontend.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Apply rate limiting and other middleware
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Tworzenie instancji GameServiceRefactored z dostępem do io
const gameService = new GameServiceRefactored(io);

// Health check endpoint for Railway
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Blackjack Backend Server is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api', createGameRouter(gameService));

// WebSocket handlers
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
  console.log('Nowe połączenie WebSocket:', socket.id);

  socket.on('joinGame', (gameId: string, playerId: string) => {
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

  socket.on('leaveGame', (gameId: string, playerId: string) => {
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

  socket.on('requestBuyIn', (gameId: string, playerId: string, amount: number) => {
    try {
      console.log(`💰 Buy-in request from player ${playerId}: $${amount}`);
      gameService.handleBuyInRequest(gameId, playerId, amount);
    } catch (error) {
      console.error('Error handling buy-in request:', error);
      socket.emit('error', error instanceof Error ? error.message : 'Błąd podczas buy-in');
    }
  });

  socket.on('declineBuyIn', (gameId: string, playerId: string) => {
    try {
      console.log(`🚪 Buy-in declined by player ${playerId}`);
      gameService.handleBuyInDecline(gameId, playerId);
    } catch (error) {
      console.error('Error handling buy-in decline:', error);
      socket.emit('error', error instanceof Error ? error.message : 'Błąd podczas odmowy buy-in');
    }
  });

  socket.on('disconnect', (reason: string) => {
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
