import React from 'react';
import { PlayerHand } from './PlayerHand';
import { evaluatePokerHandWithCommunity } from '../utils/cardHelpers';
import type { Player } from '../types/game';
import './PlayerSpot.css';

interface PlayerSpotProps {
  seatNumber: number;
  player?: Player;
  isOccupied: boolean;
  isCurrentPlayer?: boolean;
  isMySeat?: boolean; // Czy to jest miejsce aktualnego użytkownika
  communityCards?: any[]; // Karty wspólne w pokerze
}

export const PlayerSpot: React.FC<PlayerSpotProps> = ({
  seatNumber,
  player,
  isOccupied,
  isCurrentPlayer = false,
  isMySeat = false,
  communityCards = []
}) => {
  // Debug log removed for cleaner console
  
  if (!isOccupied || !player) {
    return (
      <div className="player-spot vacant">
        <div className="spot-number">SEAT {seatNumber}</div>
        <div className="vacant-label">VACANT</div>
      </div>
    );
  }



  return (
    <div className={`player-spot occupied ${isCurrentPlayer ? 'current-player' : ''} ${isMySeat ? 'my-seat' : ''} ${player.state === 'OBSERVING' ? 'observing' : ''}`}>
      <div className="spot-number">SEAT {seatNumber}</div>
      {player.state === 'OBSERVING' && (
        <div className="observing-indicator">OBSERVING</div>
      )}
      
      {player.hands.length === 1 ? (
        // Single hand container
        <div className="player-hands-single">
          <PlayerHand
            cards={player.hands[0].cards || []}
            pokerHand={player.hands[0].cards && player.hands[0].cards.length > 0 ? 
              evaluatePokerHandWithCommunity(player.hands[0].cards, communityCards) : ''}
            handResult={player.hands[0].result}
            betAmount={player.hands[0].bet || 0}
            isCurrentHand={isCurrentPlayer}
            handIndex={0}
            isSplit={false}
            playerState={player.state}
          />
        </div>
      ) : (
        // Split hands container
        <div className="player-hands-split">
          {player.hands.map((hand, handIndex) => {
            const pokerHand = hand.cards && hand.cards.length > 0 ? 
              evaluatePokerHandWithCommunity(hand.cards, communityCards) : '';
            
            // Sprawdź czy to jest aktualna ręka gracza (dla split hands)
            const isCurrentHand = isCurrentPlayer && handIndex === (player.currentHandIndex || 0);
            
            // Debug log removed for cleaner console
            
            return (
              <PlayerHand
                key={handIndex}
                cards={hand.cards || []}
                pokerHand={pokerHand}
                handResult={hand.result}
                betAmount={hand.bet || 0}
                isCurrentHand={isCurrentHand}
                handIndex={handIndex}
                isSplit={true}
                playerState={player.state}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}; 