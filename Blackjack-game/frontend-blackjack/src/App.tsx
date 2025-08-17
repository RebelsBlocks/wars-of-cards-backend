import { Table } from './components/Table';
import { Controls } from './components/Controls';
import './App.css';

function App() {
  // Tymczasowe funkcje obsługi zdarzeń
  const handleSplit = () => console.log('Split clicked');
  const handleDouble = () => console.log('Double clicked');
  const handleStay = () => console.log('Stay clicked');
  const handleHit = () => console.log('Hit clicked');

  return (
    <div className="app">
      <div className="game-container">
        <Table 
          dealerCards={[]}
          playerCards={[]}
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
