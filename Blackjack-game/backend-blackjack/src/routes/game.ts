import { Router } from 'express';
import { GameState, PlayerMove } from '../types/game';
import { GameServiceRefactored } from '../services/GameServiceRefactored';

export function createGameRouter(gameService: GameServiceRefactored) {
  const router = Router();

  // Utworzenie nowej gry
  router.post('/games', (req, res) => {
    try {
      console.log('Creating new game...');
      const game = gameService.createGame();
      console.log('Game created successfully:', game.id);
      res.status(201).json(game);
    } catch (error) {
      console.error('Error creating game:', error);
      res.status(500).json({ error: 'Nie udało się utworzyć gry' });
    }
  });

  // Znajdź dostępną grę z wolnymi miejscami
  router.get('/games/available', (req, res) => {
    try {
      console.log('Looking for available game...');
      const availableGame = gameService.findAvailableGame();
      if (availableGame) {
        console.log('Found available game:', availableGame.id);
        res.status(200).json(availableGame);
      } else {
        console.log('No available games found');
        res.status(404).json({ error: 'Brak dostępnych gier' });
      }
    } catch (error) {
      console.error('Error finding available game:', error);
      res.status(500).json({ error: 'Nie udało się znaleźć dostępnej gry' });
    }
  });

  // Atomowy endpoint: znajdź/utwórz grę i od razu dołącz
  router.post('/games/join-or-create', (req, res) => {
    try {
      const { seatNumber, initialBalance } = req.body;
      const MAIN_TABLE_ID = 'main-blackjack-table'; // ✅ STAŁY ID
      
      console.log('Join-or-create request received:', { 
        seatNumber, 
        initialBalance,
        body: req.body 
      });
      
      if (!seatNumber || seatNumber < 1 || seatNumber > 3) {
        console.error('Invalid seat number:', seatNumber);
        return res.status(400).json({ error: 'Nieprawidłowy numer miejsca (1-3)' });
      }
      
      // 1. Sprawdź czy główny stół istnieje  
      let game = gameService.getGameState(MAIN_TABLE_ID);
      
      // 2. Jeśli nie - stwórz z konkretnym ID
      if (!game) {
        console.log('Creating main blackjack table...');
        game = gameService.createGame(MAIN_TABLE_ID); // ✅ Przekaż stały ID
      } else {
        console.log('Found existing main table:', game.id);
      }
      
      // 3. Od razu dołącz gracza (atomowo)
      const player = gameService.joinGame(game.id, seatNumber, initialBalance);
      
      console.log('Player joined successfully:', player.id, 'to game:', game.id);
      res.status(200).json({ 
        game: gameService.cleanGameStateForClient(game),
        player: player 
      });
    } catch (error) {
      console.error('Join-or-create error:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się dołączyć do gry' });
      }
    }
  });

  // Dołączenie do gry
  router.post('/games/:gameId/join', (req, res) => {
    try {
      const { gameId } = req.params;
      const { seatNumber, initialBalance } = req.body;
      
      console.log('Join request received:', { 
        gameId, 
        seatNumber, 
        initialBalance,
        body: req.body 
      });
      
      if (!seatNumber || seatNumber < 1 || seatNumber > 3) {
        console.error('Invalid seat number:', seatNumber);
        return res.status(400).json({ error: 'Nieprawidłowy numer miejsca (1-3)' });
      }
      
      const player = gameService.joinGame(gameId, seatNumber, initialBalance);
      console.log('Player joined successfully:', player.id);
      res.status(200).json(player);
    } catch (error) {
      console.error('Join error:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się dołączyć do gry' });
      }
    }
  });

  // Rozpoczęcie nowej rundy
  router.post('/games/:gameId/start', (req, res) => {
    try {
      const { gameId } = req.params;
      const game = gameService.startRound(gameId);
      res.status(200).json(game);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się rozpocząć rundy' });
      }
    }
  });

  // Postawienie zakładu
  router.post('/games/:gameId/bet', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId, amount } = req.body;
      
      // Basic validation
      if (!gameId || typeof gameId !== 'string') {
        return res.status(400).json({ error: 'Invalid game ID' });
      }
      
      console.log('💰 Received bet request:', {
        gameId,
        playerId,
        amount,
        body: req.body
      });

      if (!playerId || typeof playerId !== 'string') {
        console.error('❌ Missing or invalid playerId in bet request');
        return res.status(400).json({ error: 'Brak ID gracza' });
      }

      if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 10000) {
        console.error('❌ Invalid bet amount:', amount);
        return res.status(400).json({ error: 'Nieprawidłowa kwota zakładu (1-10000)' });
      }

      const game = gameService.placeBet(gameId, playerId, amount);
      console.log('✅ Bet placed successfully:', {
        gameId,
        playerId,
        amount,
        gameState: game.state
      });
      
      res.status(200).json(game);
    } catch (error) {
      console.error('❌ Error placing bet:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się postawić zakładu' });
      }
    }
  });

  // Wykonanie ruchu (hit, stand, double, split)
  router.post('/games/:gameId/move', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId, move } = req.body;
      
      let game;
      switch (move) {
        case PlayerMove.HIT:
          game = gameService.processHit(gameId, playerId);
          break;
        case PlayerMove.STAND:
          game = gameService.processStand(gameId, playerId);
          break;
        case PlayerMove.DOUBLE:
          game = gameService.processDouble(gameId, playerId);
          break;
        case PlayerMove.SPLIT:
          game = gameService.processSplit(gameId, playerId);
          break;
        default:
          return res.status(400).json({ error: 'Nieprawidłowy ruch' });
      }
      
      res.status(200).json(game);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się wykonać ruchu' });
      }
    }
  });

  // Nowy endpoint do opuszczenia gry
  router.post('/games/:gameId/leave', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId } = req.body;
      
      gameService.leaveGame(gameId, playerId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się opuścić gry' });
      }
    }
  });

  // Pobranie stanu gry (z automatycznym tworzeniem jeśli nie istnieje)
  router.get('/games/:gameId', (req, res) => {
    try {
      const { gameId } = req.params;
      let game = gameService.getGameState(gameId);
      
      // Jeśli gra nie istnieje i to główny stół - utwórz ją
      if (!game && gameId === 'main-blackjack-table') {
        console.log('Creating main blackjack table on demand...');
        game = gameService.createGame(gameId);
      } else if (!game) {
        return res.status(404).json({ error: 'Gra nie została znaleziona' });
      }
      
      res.status(200).json(game);
    } catch (error) {
      res.status(500).json({ error: 'Nie udało się pobrać stanu gry' });
    }
  });

  return router;
}
