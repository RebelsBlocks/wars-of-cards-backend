import React from 'react';
import { PlayerSpot } from './PlayerSpot';
import type { Player } from '../types/game';
import dealerImage from '../assets/vanessa.png';
import './Table.css';

interface TableProps {
  communityCards: React.ReactNode[];
  communityCardsData?: any[]; // Raw community cards data for poker evaluation
  potAmount?: number;
  currentBet?: number;
  dealerHandResult?: any;
  players: Player[];
  occupiedSeats: number[];
  currentPlayerId?: string;
  myPlayerId?: string; // ID aktualnego użytkownika aplikacji
  showBettingInterface?: boolean;
  onPlaceBet?: (amount: number) => void;
  currentBalance?: number;
}

export const Table: React.FC<TableProps> = ({ 
  communityCards, 
  communityCardsData = [],
  potAmount, 
  currentBet,
  dealerHandResult,
  players,
  occupiedSeats,
  currentPlayerId,
  myPlayerId,
  showBettingInterface = false,
  onPlaceBet,
  currentBalance
}) => {
  // Helper function to get player for specific seat
  const getPlayerForSeat = (seatNumber: number): Player | undefined => {
    return players.find(p => p.seatNumber === seatNumber);
  };

  return (
    <div className="table-container">
      <div className="table-frame">
        {/* Dealer image - przeniesiony poza dealer-area dla stałej pozycji */}
        <div className="dealer-image-container">
          <img 
            src={dealerImage} 
            alt="Dealer" 
            className="dealer-image"
          />
        </div>
        
        <div className="table-surface">
          {/* Community Cards area */}
          <div className="community-cards-section">
            <h3>Community Cards</h3>
            <div className="community-cards">
              {communityCards}
              {/* Hand result display */}
              {dealerHandResult && (
                <div className={`hand-result ${dealerHandResult.className || ''}`}>
                  {dealerHandResult.text || ''}
                </div>
              )}
              {/* Usuń wyświetlanie "hand value" - community cards nie mają wartości */}
            </div>
            
            {/* Poker Game Info */}
            <div className="poker-info">
              {potAmount !== undefined && potAmount > 0 && (
                <div className="pot-display">Pot: ${potAmount}</div>
              )}
              {currentBet !== undefined && currentBet > 0 && (
                <div className="current-bet-display">Current Bet: ${currentBet}</div>
              )}
            </div>
          </div>

          {/* Holographic Betting Interface */}
          {showBettingInterface && (
            <div className="holographic-betting-interface">
              <div className="hologram-container">
                <div className="hologram-content">
                  <h3 className="hologram-title">Place Your Bet</h3>
                  <div className="hologram-buttons">
                    <button 
                      className="hologram-button" 
                      onClick={() => onPlaceBet?.(10)}
                      disabled={currentBalance !== undefined && 10 > currentBalance}
                    >
                      $10
                    </button>
                    <button 
                      className="hologram-button" 
                      onClick={() => onPlaceBet?.(30)}
                      disabled={currentBalance !== undefined && 30 > currentBalance}
                    >
                      $30
                    </button>
                    <button 
                      className="hologram-button" 
                      onClick={() => onPlaceBet?.(50)}
                      disabled={currentBalance !== undefined && 50 > currentBalance}
                    >
                      $50
                    </button>
                    <button 
                      className="hologram-button" 
                      onClick={() => onPlaceBet?.(100)}
                      disabled={currentBalance !== undefined && 100 > currentBalance}
                    >
                      $100
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Table text */}
          <div className="table-text">
            <div className="blackjack-text">BLACKJACK</div>
            <div className="pays-text">PAYS 3 TO 2</div>
            <div className="dealer-must-text">DEALER MUST STAND ON ALL 17s</div>
          </div>

          {/* Player spots */}
          <div className="player-spots">
            {[3, 2, 1].map((seatNumber) => {
              const player = getPlayerForSeat(seatNumber);
              const isOccupied = occupiedSeats.includes(seatNumber);
              const isCurrentPlayer = player?.id === currentPlayerId;
              const isMySeat = player?.id === myPlayerId;
              
              // Debug log removed for cleaner console
              
              return (
                <PlayerSpot
                  key={seatNumber}
                  seatNumber={seatNumber}
                  player={player}
                  isOccupied={isOccupied}
                  isCurrentPlayer={isCurrentPlayer}
                  isMySeat={isMySeat}
                  communityCards={communityCardsData}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}; 