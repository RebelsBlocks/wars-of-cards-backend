import React from 'react';
import { Card } from './Card';
import { getHandResultText, getHandResultClass } from '../utils/cardHelpers';
import { HandResult, PlayerState } from '../types/game';
import type { Card as GameCard } from '../types/game';
import { Suit, Rank } from '../types/shared';
import './PlayerHand.css';

interface PlayerHandProps {
  cards: GameCard[];
  pokerHand?: string; // Poker hand type instead of hand value
  handResult?: HandResult;
  betAmount: number;
  isCurrentHand?: boolean;
  handIndex?: number; // Index of the hand (0, 1, 2, etc.)
  isSplit?: boolean; // Whether this is part of a split
  playerState?: PlayerState; // Stan gracza
}

export const PlayerHand: React.FC<PlayerHandProps> = ({
  cards,
  pokerHand,
  handResult,
  betAmount,
  isCurrentHand = false,
  handIndex,
  isSplit = false,
  playerState
}) => {
  // Debug log removed for cleaner console

  // Helper function to convert game cards to React components
  const renderCards = (): React.ReactNode[] => {
    const suitSymbols: Record<string, string> = {
      'HEARTS': '♥️',
      'DIAMONDS': '♦️',
      'CLUBS': '♣️',
      'SPADES': '♠️'
    };
    
    const rankDisplay: Record<string, string> = {
      'ACE': 'A',
      'JACK': 'J',
      'QUEEN': 'Q',
      'KING': 'K'
    };
    
    return cards.map((card, index) => {
      const suitSymbol = suitSymbols[card.suit];
      const rankSymbol = rankDisplay[card.rank] || card.rank;
      
      const cardForComponent = {
        rank: rankSymbol as Rank,
        suit: suitSymbol as Suit,
      };
      
      return (
        <Card 
          key={`${card.suit}-${card.rank}-${index}`} 
          card={cardForComponent} 
          isHidden={!card.isFaceUp}
        />
      );
    });
  };

  return (
    <div className={`player-hand ${isCurrentHand ? 'current-hand' : ''}`}>
      <div className="hand-cards">
        {renderCards()}
      </div>
      
      {/* Hand result display - nie pokazuj dla graczy OBSERVING */}
      {handResult && playerState !== PlayerState.OBSERVING && (
        <div className={`hand-result ${getHandResultClass(handResult)}`}>
          {getHandResultText(handResult)}
        </div>
      )}
      
      {/* Poker hand display */}
      {pokerHand && pokerHand !== '' && cards.length > 0 && (
        <div className="poker-hand-display">
          {pokerHand}
        </div>
      )}
      
      {/* Bet amount */}
      {betAmount > 0 && (
        <div className="bet-amount">
          {isSplit && handIndex !== undefined && (
            <span className="hand-number-circle">
              {handIndex + 1}
            </span>
          )}
          ${betAmount}
        </div>
      )}
    </div>
  );
}; 