import { Router } from 'express';
import { GameState, PlayerMove } from '../types/game';
import { GameService } from '../services/GameService';

export function createGameRouter(gameService: GameService) {
  const router = Router();

  // Utworzenie nowej gry
  router.post('/games', (req, res) => {
    try {
      const game = gameService.createGame();
      res.status(201).json(game);
    } catch (error) {
      res.status(500).json({ error: 'Nie udało się utworzyć gry' });
    }
  });

  // Dołączenie do gry
  router.post('/games/:gameId/join', (req, res) => {
    try {
      const { gameId } = req.params;
      const { initialBalance } = req.body;
      
      const player = gameService.joinGame(gameId, initialBalance);
      res.status(200).json(player);
    } catch (error) {
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
      
      const game = gameService.placeBet(gameId, playerId, amount);
      res.status(200).json(game);
    } catch (error) {
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

  // Pobranie stanu gry
  router.get('/games/:gameId', (req, res) => {
    try {
      const { gameId } = req.params;
      const game = gameService.getGameState(gameId);
      
      if (!game) {
        return res.status(404).json({ error: 'Gra nie została znaleziona' });
      }
      
      res.status(200).json(game);
    } catch (error) {
      res.status(500).json({ error: 'Nie udało się pobrać stanu gry' });
    }
  });

  return router;
}
