import React from 'react';
import './Controls.css';

// 🆕 Import poker mode (tymczasowo hardcoded)
const POKER_MODE = true; // zmienione na true dla pokera

interface ControlsProps {
  // Blackjack actions (legacy)
  onSplit?: () => void;
  onDouble?: () => void;
  
  // 🆕 Poker actions
  onCall?: () => void;
  onRaise?: (amount: number) => void;
  
  // 🆕 Process functions (as requested by user)
  processFold?: () => void;
  processCheck?: () => void;
  
  // 🆕 Game state for button logic
  currentBet?: number;
}

export const Controls: React.FC<ControlsProps> = ({
  onSplit,
  onDouble,
  onCall,
  onRaise,
  processFold,
  processCheck,
  currentBet = 0
}) => {
  return (
    <div className="control-buttons">
      {POKER_MODE ? (
        // 🆕 POKER buttons with proper logic
        <>
          <button 
            className="game-button fold" 
            onClick={processFold}
            disabled={!processFold}
          >
            FOLD
          </button>
          <button 
            className="game-button check" 
            onClick={processCheck}
            disabled={!processCheck || currentBet > 0}
          >
            CHECK
          </button>
          <button 
            className="game-button call" 
            onClick={onCall}
            disabled={!onCall || currentBet === 0}
          >
            CALL
          </button>
          <button 
            className="game-button raise" 
            onClick={() => {
              if (onRaise) {
                const amount = prompt('Enter raise amount:');
                if (amount && !isNaN(Number(amount)) && Number(amount) > 0) {
                  onRaise(Number(amount));
                }
              }
            }}
            disabled={!onRaise}
          >
            RAISE
          </button>
        </>
      ) : (
        // ✅ BLACKJACK buttons (existing code)
        <>
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
          <button 
            className="game-button fold" 
            onClick={processFold}
            disabled={!processFold}
          >
            FOLD
          </button>
          <button 
            className="game-button check" 
            onClick={processCheck}
            disabled={!processCheck}
          >
            CHECK
          </button>
        </>
      )}
    </div>
  );
};
