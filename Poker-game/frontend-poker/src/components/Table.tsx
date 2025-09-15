import React from 'react';
import { PlayerHand } from './PlayerHand';
import { evaluatePokerHandWithCommunity } from '../utils/cardHelpers';
import type { Player, GameSession } from '../types/game';
import { GameState } from '../types/game';
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
  gameData?: GameSession; // Dodajemy gameData dla dealer button
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
  currentBalance,
  gameData
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
          {/* Pot Display - Holographic */}
          {potAmount !== undefined && potAmount > 0 && (
            <div className="holographic-pot-display">
              <div className="hologram-container">
                <div className="hologram-content">
                  <div className="pot-amount">${potAmount}</div>
                </div>
              </div>
            </div>
          )}
          
          {/* Community Cards area */}
          <div className="community-cards-section">
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

          {/* Table text - removed for cleaner look */}

          {/* Player positions */}
          <div className="player-spots">
            {[3, 2, 1].map((seatNumber) => {
              const player = getPlayerForSeat(seatNumber);
              const isOccupied = occupiedSeats.includes(seatNumber);
              const isCurrentPlayer = player?.id === currentPlayerId;
              const isMySeat = player?.id === myPlayerId;
              
              return (
                <div 
                  key={seatNumber} 
                  className={`player-position ${isOccupied ? 'occupied' : 'vacant'} ${isCurrentPlayer ? 'current-player' : ''} ${isMySeat ? 'my-seat' : ''} ${player?.state === 'OBSERVING' ? 'observing' : ''}`}
                >
                  <div className="seat-number">SEAT {seatNumber}</div>
                  
                  {/* 🎯 Dealer Button */}
                  {isOccupied && player && gameData?.dealerButtonPosition === seatNumber && (
                    <div className="dealer-button">D</div>
                  )}
                  
                  {player?.state === 'OBSERVING' && (
                    <div className="observing-indicator">OBSERVING</div>
                  )}
                  
                  {isOccupied && player ? (
                    <>
                      <div className="player-hands-single">
                        <PlayerHand
                          cards={player.hands[0]?.cards?.map(card => ({
                            ...card,
                            isFaceUp: player.id === myPlayerId // UKRYJ karty innych graczy
                          })) || []}
                          pokerHand={player.id === myPlayerId && player.hands[0]?.cards && player.hands[0].cards.length > 0 ? 
                            evaluatePokerHandWithCommunity(player.hands[0].cards, communityCardsData).rank : ''}
                          handResult={player.hands[0]?.result}
                          betAmount={player.currentBet || 0}
                          isCurrentHand={isCurrentPlayer}
                          handIndex={0}
                          playerState={player.state}
                          showBetAmount={gameData?.state === GameState.PLAYER_TURN}
                        />
                      </div>
                      <div className="player-balance">
                        ${player.balance}
                      </div>
                    </>
                  ) : (
                    <div className="vacant-seat">VACANT</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}; 
