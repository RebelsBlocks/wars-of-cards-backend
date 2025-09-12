import React from 'react';
import './GameTimer.css';

interface GameTimerProps {
  remainingTime: number;
  totalTime: number;
  type: 'gameStart' | 'bet' | 'move';
  isVisible: boolean;
  playerId?: string; // ID gracza którego dotyczy timer
  isMyTurn?: boolean; // czy to moja kolej
}

export const GameTimer: React.FC<GameTimerProps> = ({
  remainingTime,
  totalTime,
  type,
  isVisible,
  isMyTurn
}) => {
  // Timer typu 'move' powinien być widoczny tylko gdy isMyTurn === true
  if (type === 'move' && !isMyTurn) {
    return null;
  }

  if (!isVisible || remainingTime <= 0) {
    return null;
  }

  const seconds = Math.ceil(remainingTime / 1000);
  const progress = (remainingTime / totalTime) * 100;
  const isWarning = seconds <= 5; // Czerwony kolor od 5 sekund w dół

  return (
    <div className="game-timer">
      <div className="timer-display">
        <span className={`timer-seconds ${isWarning ? 'timer-warning' : ''}`}>
          {seconds}
        </span>
        <span className="timer-unit">s</span>
      </div>
      <div className="timer-progress">
        <div 
          className="timer-progress-bar" 
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
