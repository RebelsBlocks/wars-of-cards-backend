import React from 'react';
import { useGame, useCanPlayerAction, usePlayerStatusText } from '../hooks/useGame';
import type { GameSession } from '../types/game';

interface GameProps {
  gameData: GameSession | null;
  playerId: string | null;
  onPlayerAction: (action: 'fold' | 'check') => void;
}

export const Game: React.FC<GameProps> = ({ 
  gameData, 
  playerId, 
  onPlayerAction
}) => {
  // Używamy naszego centralnego hook'a
  const gameInfo = useGame(gameData, playerId);
  
  // Hook'i pomocnicze
  const canFold = useCanPlayerAction(gameInfo, 'fold');
  const canCheck = useCanPlayerAction(gameInfo, 'check');
  
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
        
        {/* 🆕 POKER: Pola licytacji (tymczasowo) */}
        <div className="poker-betting-info">
          <div>Pot: ${gameData?.pot || 0}</div>
          <div>Current Bet: ${gameData?.currentBet || 0}</div>
          <div>My Bet: ${gameInfo.currentPlayer?.currentBet || 0}</div>
        </div>
      </div>

      {/* Community Cards */}
      <div className="community-cards-section">
        <h3>Community Cards</h3>
        {gameInfo.dealer && gameInfo.dealer.hands[0] && (
          <div className="hand-info">
            <div>Karty: {gameInfo.dealer.hands[0].cards.length}</div>
            {/* Usuń wyświetlanie "hand value" - community cards nie mają wartości */}
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
                <div>Stawka: {hand.bet}</div>
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
              onClick={() => onPlayerAction('fold')} 
              disabled={!canFold}
              className="action-btn fold-btn"
            >
              Fold
            </button>
            <button 
              onClick={() => onPlayerAction('check')} 
              disabled={!canCheck}
              className="action-btn check-btn"
            >
              Check
            </button>
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
