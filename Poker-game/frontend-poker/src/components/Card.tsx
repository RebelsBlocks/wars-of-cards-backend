import type { Card as CardType } from '../types/shared';
import './Card.css';

interface CardProps {
  card: CardType;
  isHidden?: boolean;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ card, isHidden = false, className = '' }) => {
  return (
    <div 
      className={`card ${isHidden ? 'flipped' : ''} ${className}`}
      style={{ cursor: 'default' }}
    >
      <div className="card-inner">
        <div 
          className="card-front" 
          data-suit={card.suit}
          data-rank={card.rank}
        >
          <div className="card-corner top-left">
            <div className="card-rank">{card.rank}</div>
            <div className="card-suit">{card.suit}</div>
          </div>
          <div className="card-center">{card.suit}</div>
          <div className="card-corner bottom-right">
            <div className="card-rank">{card.rank}</div>
            <div className="card-suit">{card.suit}</div>
          </div>
        </div>
        <div className="card-back">
          <div className="card-pattern"></div>
        </div>
      </div>
    </div>
  );
};
