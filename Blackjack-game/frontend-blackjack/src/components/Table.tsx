import React from 'react';
import './Table.css';

interface PlayerSpot {
  id: number;
  cards: React.ReactNode[];
  isOccupied: boolean;
  betAmount?: number;
  handValue?: number;
}

interface TableProps {
  dealerCards: React.ReactNode[];
  dealerHandValue?: number;
  playerSpots: PlayerSpot[];
}

export const Table: React.FC<TableProps> = ({ dealerCards, dealerHandValue, playerSpots }) => {
  return (
    <div className="table-container">
      <div className="table-frame">
        <div className="table-surface">
          {/* Dealer area */}
          <div className="dealer-area">
            <div className="dealer-label">DEALER</div>
            <div className="dealer-cards">
              {dealerCards}
              {/* Kółeczko z wartością kart dealera */}
              {dealerHandValue !== undefined && dealerCards.length > 0 && (
                <div className="dealer-hand-value-circle">
                  {dealerHandValue}
                </div>
              )}
            </div>
          </div>

          {/* Table text */}
          <div className="table-text">
            <div className="blackjack-text">BLACKJACK</div>
            <div className="pays-text">PAYS 3 TO 2</div>
            <div className="dealer-must-text">DEALER MUST STAND ON ALL 17s</div>
            <div className="insurance-text">INSURANCE PAYS 2 TO 1</div>
          </div>

          {/* Player spots */}
          <div className="player-spots">
            {playerSpots.map((spot) => (
              <div key={spot.id} className={`player-spot ${spot.isOccupied ? 'occupied' : 'vacant'}`}>
                <div className="spot-number">SEAT {spot.id}</div>
                <div className="player-cards">
                  {spot.cards}
                  {/* Kółeczko z wartością ręki */}
                  {spot.isOccupied && spot.handValue !== undefined && spot.cards.length > 0 && (
                    <div className="hand-value-circle">
                      {spot.handValue}
                    </div>
                  )}
                </div>
                {spot.betAmount && (
                  <div className="bet-amount">${spot.betAmount}</div>
                )}
                {!spot.isOccupied && (
                  <div className="vacant-label">VACANT</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}; 
