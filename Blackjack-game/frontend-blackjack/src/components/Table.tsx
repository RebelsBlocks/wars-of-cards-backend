import React from 'react';
import './Table.css';

interface TableProps {
  dealerCards: React.ReactNode[];
  playerCards: React.ReactNode[];
}

export const Table: React.FC<TableProps> = ({ dealerCards, playerCards }) => {
  return (
    <div className="table-container">
      {/* Drewniana obramówka */}
      <div className="table-frame">
        
        {/* Zielony filc stołu */}
        <div className="table-surface">
          
          {/* Obszar krupiera */}
          <div className="dealer-area">
            <div className="dealer-label">DEALER</div>
            <div className="dealer-cards">
              {dealerCards}
            </div>
          </div>

          {/* Napisy na stole */}
          <div className="table-text">
            <div className="blackjack-text">BLACKJACK</div>
            <div className="pays-text">PAYS 3 TO 2</div>
            <div className="dealer-must-text">DEALER MUST STAND ON ALL 17s</div>
            <div className="insurance-text">INSURANCE PAYS 2 TO 1</div>
          </div>

          {/* Obszar gracza */}
          <div className="player-area">
            <div className="player-cards">
              {playerCards}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}; 