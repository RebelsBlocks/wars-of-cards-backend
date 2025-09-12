import { Router } from 'express';
import { GameState } from '../types/game';
import { GameService } from '../services/GameService';

export function createGameRouter(gameService: GameService) {
  const router = Router();

  // Health check endpoint for Railway
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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
      
      console.log('💰 Received bet request:', {
        gameId,
        playerId,
        amount,
        body: req.body
      });

      if (!playerId) {
        console.error('❌ Missing playerId in bet request');
        return res.status(400).json({ error: 'Brak ID gracza' });
      }

      if (!amount || amount <= 0) {
        console.error('❌ Invalid bet amount:', amount);
        return res.status(400).json({ error: 'Nieprawidłowa kwota zakładu' });
      }

      // 🚫 LEGACY: placeBet - nie używane w pokerze
      return res.status(400).json({ error: 'Betting phase not used in poker' });
    } catch (error) {
      console.error('❌ Error in bet endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 🆕 POKER ACTION ROUTES

  // Fold hand
  router.post('/games/:gameId/fold', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId } = req.body;
      
      console.log('🃏 Received fold request:', { gameId, playerId });
      
      if (!playerId) {
        return res.status(400).json({ error: 'Brak ID gracza' });
      }
      
      const result = gameService.processFold(gameId, playerId);
      res.status(200).json(result);
    } catch (error) {
      console.error('❌ Error folding:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się spasować' });
      }
    }
  });

  // Check (pass when no bet required)
  router.post('/games/:gameId/check', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId } = req.body;
      
      console.log('✅ Received check request:', { gameId, playerId });
      
      if (!playerId) {
        return res.status(400).json({ error: 'Brak ID gracza' });
      }
      
      const result = gameService.processCheck(gameId, playerId);
      res.status(200).json(result);
    } catch (error) {
      console.error('❌ Error checking:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się sprawdzić' });
      }
    }
  });

  // Call (match current bet)
  router.post('/games/:gameId/call', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId } = req.body;
      
      console.log('📞 Received call request:', { gameId, playerId });
      
      if (!playerId) {
        return res.status(400).json({ error: 'Brak ID gracza' });
      }
      
      const result = gameService.processCall(gameId, playerId);
      res.status(200).json(result);
    } catch (error) {
      console.error('❌ Error calling:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się dorównać' });
      }
    }
  });

  // Raise (increase bet by amount)
  router.post('/games/:gameId/raise', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId, amount } = req.body;
      
      console.log('📈 Received raise request:', { gameId, playerId, amount });
      
      if (!playerId) {
        return res.status(400).json({ error: 'Brak ID gracza' });
      }
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Nieprawidłowa kwota podniesienia' });
      }
      
      const result = gameService.processRaise(gameId, playerId, amount);
      res.status(200).json(result);
    } catch (error) {
      console.error('❌ Error raising:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Nie udało się podnieść stawki' });
      }
    }
  });

  // 🚫 LEGACY: Wykonanie ruchu (hit, stand, double, split) - nie używane w pokerze
  /*
  router.post('/games/:gameId/move', (req, res) => {
    try {
      const { gameId } = req.params;
      const { playerId, move } = req.body;
      
      let game;
      switch (move) {
        case 'CHECK':
          game = gameService.processCheck(gameId, playerId);
          break;
        case 'CALL':
          game = gameService.processCall(gameId, playerId);
          break;
        case 'FOLD':
          game = gameService.processFold(gameId, playerId);
          break;
        case 'RAISE':
          const raiseAmount = req.body.amount;
          if (!raiseAmount || raiseAmount <= 0) {
            return res.status(400).json({ error: 'Nieprawidłowa kwota podbicia' });
          }
          game = gameService.processRaise(gameId, playerId, raiseAmount);
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
  */

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
