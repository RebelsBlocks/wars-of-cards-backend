import React from 'react';
import './GameStats.css';

interface GameStatsProps {
  balance: number;
  gameStatus: string;
  onExitGame: () => void;
}

export const GameStats: React.FC<GameStatsProps> = ({
  balance,
  gameStatus,
  onExitGame
}) => {
  return (
    <div className="game-stats">
      <div className="balance">
        Balance: ${balance}
      </div>
      <div className="game-status">
        {gameStatus}
      </div>
      <button className="exit-button" onClick={onExitGame}>
        EXIT
      </button>
    </div>
  );
};
