import React, { useState, useEffect } from 'react';
import './BuyInDialog.css';

interface BuyInDialogProps {
  isOpen: boolean;
  message: string;
  timeout: number;
  minBuyIn: number;
  onBuyIn: (amount: number) => void;
  onDecline: () => void;
}

export const BuyInDialog: React.FC<BuyInDialogProps> = ({
  isOpen,
  message,
  timeout,
  minBuyIn,
  onBuyIn,
  onDecline
}) => {
  const [buyInAmount, setBuyInAmount] = useState(minBuyIn);
  const [timeRemaining, setTimeRemaining] = useState(timeout / 1000);

  // Initialize buy-in amount when dialog opens
  useEffect(() => {
    if (isOpen) {
      setBuyInAmount(minBuyIn);
    }
  }, [isOpen, minBuyIn]);

  // Handle timer
  useEffect(() => {
    if (!isOpen) return;

    setTimeRemaining(timeout / 1000);

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onDecline(); // Automatically leave game after timeout
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, timeout, onDecline]);

  if (!isOpen) return null;

  const handleBuyIn = () => {
    if (buyInAmount >= minBuyIn) {
      onBuyIn(buyInAmount);
    }
  };

  const handleDecline = () => {
    onDecline();
  };

  return (
    <div className="buy-in-overlay">
      <div className="buy-in-dialog">
        <div className="buy-in-header">
          <h2>💰 Buy Chips</h2>
          <div className="buy-in-timer">
            Time remaining: {timeRemaining}s
          </div>
        </div>
        
        <div className="buy-in-content">
          <p className="buy-in-message">{message}</p>
          
          <div className="buy-in-form">
            <label htmlFor="buyInAmount">Buy-in amount:</label>
            <input
              id="buyInAmount"
              type="number"
              min={minBuyIn}
              value={buyInAmount}
              onChange={(e) => setBuyInAmount(Number(e.target.value))}
              placeholder={`Minimum $${minBuyIn}`}
            />
            <small>Minimum buy-in: ${minBuyIn}</small>
          </div>
        </div>
        
        <div className="buy-in-actions">
          <button
            className="buy-in-btn confirm"
            onClick={handleBuyIn}
            disabled={buyInAmount < minBuyIn}
          >
            Buy Chips (${buyInAmount})
          </button>
          <button
            className="buy-in-btn decline"
            onClick={handleDecline}
          >
            Leave Table
          </button>
        </div>
      </div>
    </div>
  );
};
