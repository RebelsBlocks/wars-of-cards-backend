import { Card } from './components/Card';
import { Table } from './components/Table';
import { Controls } from './components/Controls';
import { Suit, Rank } from '../../shared/types/api';
import './App.css';

function App() {
  const testCards = [
    { suit: Suit.HEARTS, rank: Rank.ACE },
    { suit: Suit.SPADES, rank: Rank.KING },
    { suit: Suit.DIAMONDS, rank: Rank.QUEEN },
    { suit: Suit.CLUBS, rank: Rank.JACK }
  ];

  // Tymczasowe funkcje obsługi zdarzeń
  const handleSplit = () => console.log('Split clicked');
  const handleDouble = () => console.log('Double clicked');
  const handleStay = () => console.log('Stay clicked');
  const handleHit = () => console.log('Hit clicked');

  const dealerCards = testCards.slice(0, 2).map((card, index) => (
    <Card key={index} card={card} isHidden={index === 1} />
  ));

  const playerCards = testCards.slice(2).map((card, index) => (
    <Card key={index} card={card} />
  ));

  return (
    <div className="app">
      <div className="game-container">
        <Table 
          dealerCards={dealerCards}
          playerCards={playerCards}
        />
        <div className="controls-container">
          <Controls
            onSplit={handleSplit}
            onDouble={handleDouble}
            onStay={handleStay}
            onHit={handleHit}
            betAmount={100}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
