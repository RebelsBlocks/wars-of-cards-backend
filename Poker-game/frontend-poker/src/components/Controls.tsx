import React, { useState } from 'react';
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
  potAmount?: number; // Dodajemy pot amount dla przycisków pot
  
  // 🆕 Available actions from useGame
  availableActions?: {
    canFold: boolean;
    canCheck: boolean;
    canCall: boolean;
    canRaise: boolean;
  };
}

export const Controls: React.FC<ControlsProps> = ({
  onSplit,
  onDouble,
  onCall,
  onRaise,
  processFold,
  processCheck,
  potAmount = 0,
  availableActions = { canFold: false, canCheck: false, canCall: false, canRaise: false }
}) => {
  const [showRaisePopup, setShowRaisePopup] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  return (
    <div className="control-buttons">
      {POKER_MODE ? (
        // 🆕 POKER buttons with proper logic
        <>
          <button 
            className="game-button fold" 
            onClick={processFold}
            disabled={!availableActions.canFold}
          >
            FOLD
          </button>
          <button 
            className="game-button check" 
            onClick={processCheck}
            disabled={!availableActions.canCheck}
          >
            CHECK
          </button>
          <button 
            className="game-button call" 
            onClick={onCall}
            disabled={!availableActions.canCall}
          >
            CALL
          </button>
          <div className="raise-button-container">
            <button 
              className="game-button raise" 
              onClick={() => {
                if (onRaise) {
                  setRaiseAmount(potAmount > 0 ? Math.floor(potAmount / 2) : 10);
                  setShowRaisePopup(true);
                }
              }}
              disabled={!availableActions.canRaise}
            >
              RAISE {raiseAmount > 0 ? `$${raiseAmount}` : ''}
            </button>
            
            {/* Minimalistyczny popup nad przyciskiem */}
            {showRaisePopup && (
              <div className="raise-popup">
                <div className="raise-options">
                  <button 
                    className="raise-option"
                    onClick={() => setRaiseAmount(Math.floor(potAmount / 2))}
                  >
                    ½ POT
                  </button>
                  <button 
                    className="raise-option"
                    onClick={() => setRaiseAmount(potAmount)}
                  >
                    POT
                  </button>
                  <button 
                    className="raise-option"
                    onClick={() => setRaiseAmount(potAmount * 2)}
                  >
                    2× POT
                  </button>
                </div>
                
                <div className="raise-slider-container">
                  <input
                    type="range"
                    min="1"
                    max={potAmount * 3}
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(Number(e.target.value))}
                    className="raise-slider"
                  />
                </div>
                
                <div className="raise-actions">
                  <button 
                    className="raise-confirm"
                    onClick={() => {
                      if (onRaise && raiseAmount > 0) {
                        onRaise(raiseAmount);
                        setShowRaisePopup(false);
                      }
                    }}
                    disabled={raiseAmount <= 0}
                  >
                    RAISE ${raiseAmount}
                  </button>
                  <button 
                    className="raise-cancel"
                    onClick={() => setShowRaisePopup(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
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
