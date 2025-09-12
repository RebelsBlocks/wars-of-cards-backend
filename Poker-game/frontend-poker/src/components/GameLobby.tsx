import React, { useState } from 'react';
import './GameLobby.css';

interface GameLobbyProps {
  onJoinGame: (buyIn: number, selectedSeat: number) => void;
  occupiedSeats: number[];
  isConnected: boolean;
}

export const GameLobby: React.FC<GameLobbyProps> = ({ onJoinGame, occupiedSeats, isConnected }) => {
  const [buyIn, setBuyIn] = useState<number>(1000);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const minBuyIn = 100;
  const maxBuyIn = 10000;
  const availableSeats = [3, 2, 1];

  const handleJoinGame = () => {
    if (!selectedSeat) {
      setError("Please select a seat at the table");
      return;
    }

    if (buyIn < minBuyIn || buyIn > maxBuyIn) {
      setError(`Buy-in amount must be between ${minBuyIn} and ${maxBuyIn}`);
      return;
    }

    if (occupiedSeats.includes(selectedSeat)) {
      setError("This seat is already taken. Please choose another one.");
      return;
    }

    onJoinGame(buyIn, selectedSeat);
  };

  return (
    <div className="game-lobby">
      <div className="lobby-container">
        <h1>Blackjack</h1>
        
        <div className="buy-in-section">
          <h2>Select Buy-in Amount:</h2>
          <div className="buy-in-input">
            <input
              type="number"
              value={buyIn}
              onChange={(e) => setBuyIn(Number(e.target.value))}
              min={minBuyIn}
              max={maxBuyIn}
            />
            <div className="quick-amounts">
              <button onClick={() => setBuyIn(1000)}>1000</button>
              <button onClick={() => setBuyIn(2000)}>2000</button>
              <button onClick={() => setBuyIn(5000)}>5000</button>
            </div>
          </div>
        </div>

        <div className="seat-selection">
          <h2>Select Your Seat:</h2>
          <div className="seats">
            {availableSeats.map(seat => (
              <button
                key={seat}
                className={`seat ${selectedSeat === seat ? 'selected' : ''} ${
                  occupiedSeats.includes(seat) ? 'occupied' : ''
                }`}
                onClick={() => !occupiedSeats.includes(seat) && setSelectedSeat(seat)}
                disabled={occupiedSeats.includes(seat)}
              >
                {occupiedSeats.includes(seat) ? 'Occupied' : `Seat ${seat}`}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        {!isConnected && (
          <div className="connection-status error-message">
            ⚠️ Connection to server has been lost. Please refresh the page.
          </div>
        )}

        <button 
          className="play-button"
          onClick={handleJoinGame}
          disabled={!selectedSeat || buyIn < minBuyIn || buyIn > maxBuyIn || !isConnected}
        >
          {!isConnected ? 'DISCONNECTED' : 'PLAY'}
        </button>
      </div>
    </div>
  );
}; 