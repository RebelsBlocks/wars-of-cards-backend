import React from 'react';
import { useGame, useCanPlayerAction, usePlayerStatusText } from '../hooks/useGame';
import type { GameSession } from '../types/game';
import { formatHandValue } from '../utils/cardHelpers';

interface GameProps {
  gameData: GameSession | null;
  playerId: string | null;
  onPlayerAction: (action: 'hit' | 'stand' | 'double' | 'split') => void;
  onPlaceBet: (amount: number) => void;
}

export const Game: React.FC<GameProps> = ({ 
  gameData, 
  playerId, 
  onPlayerAction, 
  onPlaceBet 
}) => {
  // Używamy naszego centralnego hook'a
  const gameInfo = useGame(gameData, playerId);
  
  // Hook'i pomocnicze
  const canHit = useCanPlayerAction(gameInfo, 'hit');
  const canStand = useCanPlayerAction(gameInfo, 'stand');
  const canDouble = useCanPlayerAction(gameInfo, 'double');
  const canSplit = useCanPlayerAction(gameInfo, 'split');
  
  const playerStatusText = usePlayerStatusText(gameInfo.currentPlayer);

  // Renderowanie UI na podstawie obliczonego stanu
  return (
    <div className="game-container">
      {/* Status gry */}
      <div className="game-status">
        <h2>{gameInfo.gameStatus}</h2>
        {gameInfo.isTimeRunning && gameInfo.timeRemaining !== undefined && (
          <div className="timer">
            Pozostały czas: {gameInfo.timeRemaining}s
          </div>
        )}
      </div>

      {/* Dealer */}
      <div className="dealer-section">
        <h3>Krupier</h3>
        {gameInfo.dealer && gameInfo.dealer.hands[0] && (
          <div className="hand-info">
            <div>Karty: {gameInfo.dealer.hands[0].cards.length}</div>
            <div>Wartość: {formatHandValue(gameInfo.dealer.hands[0])}</div>
          </div>
        )}
      </div>

      {/* Aktualny gracz */}
      {gameInfo.currentPlayer && (
        <div className="player-section">
          <h3>Twoje karty</h3>
          <div className="player-info">
            <div>Status: {playerStatusText}</div>
            <div>Saldo: {gameInfo.currentPlayer.balance}</div>
            {gameInfo.currentPlayer.hands.map((hand, index) => (
              <div key={index} className="hand-info">
                <div>Ręka {index + 1}:</div>
                <div>Karty: {hand.cards.length}</div>
                <div>Wartość: {formatHandValue(hand)}</div>
                <div>Stawka: {hand.bet}</div>
                {gameInfo.isBlackjack && <div className="special">BLACKJACK!</div>}
                {gameInfo.isBusted && <div className="special">BUST!</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inni gracze */}
      {gameInfo.otherPlayers.length > 0 && (
        <div className="other-players">
          <h3>Inni gracze</h3>
          {gameInfo.otherPlayers.map(player => (
            <div key={player.id} className="other-player">
              <div>Gracz {player.seatNumber || '?'}</div>
              <div>Status: {usePlayerStatusText(player)}</div>
              {player.hands.map((hand, index) => (
                <div key={index}>
                  Ręka {index + 1}: {hand.cards.length} kart, stawka: {hand.bet}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Kontrolki */}
      <div className="game-controls">
        {gameInfo.isMyTurn && (
          <div className="action-buttons">
            <button 
              onClick={() => onPlayerAction('hit')} 
              disabled={!canHit}
              className="action-btn hit-btn"
            >
              Dobierz
            </button>
            <button 
              onClick={() => onPlayerAction('stand')} 
              disabled={!canStand}
              className="action-btn stand-btn"
            >
              Pas
            </button>
            <button 
              onClick={() => onPlayerAction('double')} 
              disabled={!canDouble}
              className="action-btn double-btn"
            >
              Podwój
            </button>
            <button 
              onClick={() => onPlayerAction('split')} 
              disabled={!canSplit}
              className="action-btn split-btn"
            >
              Split
            </button>
          </div>
        )}

        {/* Przykład obstawiania */}
        {gameData?.state === 'BETTING' && (
          <div className="betting-section">
            <h3>Obstaw:</h3>
            <div className="bet-buttons">
              <button onClick={() => onPlaceBet(10)}>10</button>
              <button onClick={() => onPlaceBet(25)}>25</button>
              <button onClick={() => onPlaceBet(50)}>50</button>
              <button onClick={() => onPlaceBet(100)}>100</button>
            </div>
          </div>
        )}
      </div>

      {/* Debug info (można usunąć w produkcji) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-info">
          <h4>Debug Info:</h4>
          <pre>{JSON.stringify(gameInfo, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
