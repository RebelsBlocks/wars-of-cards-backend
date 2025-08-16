import { useState } from 'react';
import type { Card as CardType } from '../../../shared/types/api';
import './Card.css';

interface CardProps {
  card: CardType;
  isHidden?: boolean;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ card, isHidden = false, className = '' }) => {
  const [isFlipped, setIsFlipped] = useState(isHidden);

  const getColor = () => {
    return card.suit === '♥️' || card.suit === '♦️' ? 'red' : 'black';
  };

  return (
    <div 
      className={`card ${isFlipped ? 'flipped' : ''} ${className}`}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div className="card-inner">
        <div className="card-front" style={{ color: getColor() }}>
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
