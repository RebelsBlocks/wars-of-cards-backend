import React from 'react';
import './Controls.css';

interface ControlsProps {
  onSplit?: () => void;
  onDouble?: () => void;
  onStay?: () => void;
  onHit?: () => void;
  betAmount?: number;
}

export const Controls: React.FC<ControlsProps> = ({
  onSplit,
  onDouble,
  onStay,
  onHit,
  betAmount = 0
}) => {
  // Formatowanie kwoty zakładu do wyświetlenia (2 miejsca po przecinku)
  const formattedBet = betAmount.toFixed(2);

  return (
    <div className="control-buttons">
      <button 
        className="game-button split" 
        onClick={onSplit}
        disabled={!onSplit}
      >
        SPLIT
      </button>
      <button 
        className="game-button double" 
        onClick={onDouble}
        disabled={!onDouble}
      >
        DOUBLE
      </button>
      <div className="bet-display">{formattedBet}</div>
      <button 
        className="game-button stay" 
        onClick={onStay}
        disabled={!onStay}
      >
        STAY
      </button>
      <button 
        className="game-button hit" 
        onClick={onHit}
        disabled={!onHit}
      >
        HIT
      </button>
    </div>
  );
};
