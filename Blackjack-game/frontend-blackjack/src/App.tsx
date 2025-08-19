import { useState, useEffect, useCallback, useRef } from 'react';
import { Table } from './components/Table';
import { Controls } from './components/Controls';
import { GameLobby } from './components/GameLobby';
import { socketService } from './services/socketService';
import './App.css';

interface GameState {
  isPlaying: boolean;
  playerId: string | null;
  playerSeat: number | null;
  balance: number;
  occupiedSeats: number[];
  gameData?: any; // Pełny stan gry z serwera
}

function App() {
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    playerId: null,
    playerSeat: null,
    balance: 0,
    occupiedSeats: [],
    gameData: null
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const initializationRef = useRef(false); // 🔥 GUARD przeciwko wielokrotnym inicjalizacjom

  const updateGameState = useCallback((newState: any) => {
    console.log(`🔥 updateGameState: ${newState.state}, players: ${newState.players?.length}, game: ${newState.id}`);
    
    const occupiedSeats = newState.players
      .filter((p: any) => !p.isDealer)
      .map((p: any) => p.seatNumber)
      .filter((seat: number | undefined): seat is number => seat !== undefined);

    setGameState(prev => ({
      ...prev,
      occupiedSeats,
      // ✅ Zachowaj pełny stan gry dla dalszego użycia
      gameData: newState
    }));
  }, []);

  useEffect(() => {
    // 🔥 GUARD - zapobiega wielokrotnym inicjalizacjom
    if (initializationRef.current) {
      console.log('Socket service already initialized, skipping...');
      return;
    }

    initializationRef.current = true;
    let mounted = true;

    const initializeSocket = async () => {
      try {
        console.log('Initializing socket service...');
        await socketService.initialize();
        
        if (!mounted) return;

        socketService.onGameState(updateGameState);

        socketService.onNotification((message) => {
          console.log('📢 Game notification:', message);
          // TODO: Dodać wyświetlanie powiadomień
        });

        // Obsługa timeUpdate events (bez logowania - za dużo spamu)
        socketService.onTimeUpdate((data) => {
          // Loguj tylko kluczowe momenty (ostatnie 5 sekund)
          if (data.remainingTime <= 5000 && data.remainingTime % 1000 < 100) {
            console.log(`⏰ ${data.type} countdown: ${Math.ceil(data.remainingTime / 1000)}s`);
          }
          // TODO: Wyświetl timer w UI jeśli potrzebne
        });

        if (mounted) {
          setIsInitialized(true);
          setIsConnected(true);
        }
      } catch (error) {
        console.error('Failed to initialize socket:', error);
        if (mounted) {
          // Reset guard w przypadku błędu
          initializationRef.current = false;
          setIsConnected(false);
        }
      }
    };

    initializeSocket();

    return () => {
      mounted = false;
      // Nie używaj gameState.playerId w cleanup - może być stary
      // socketService.disconnect() automatycznie wyczyści wszystko
      socketService.disconnect();
      // Reset guard przy unmount
      initializationRef.current = false;
    };
  }, []); // 🔥 PUSTE DEPENDENCIES - useEffect tylko raz przy mount

  // Monitoruj stan połączenia w czasie rzeczywistym
  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(socketService.isConnected());
    };

    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinGame = async (buyIn: number, selectedSeat: number) => {
    try {
      console.log(`🎯 Starting join process for seat ${selectedSeat} with balance ${buyIn}`);
      
      // Sprawdź czy socket jest połączony PRZED join
      if (!socketService.isConnected()) {
        throw new Error('Połączenie z serwerem zostało utracone. Spróbuj odświeżyć stronę.');
      }
      
      const player = await socketService.joinGameWithSeat(selectedSeat, buyIn);
      console.log(`✅ Successfully joined as player:`, player);
      
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        playerId: player.id,
        playerSeat: selectedSeat,
        balance: buyIn,
        occupiedSeats: [...prev.occupiedSeats, selectedSeat]
      }));

      // ❌ USUNIĘTE: socketService.joinGame(player.id) - już wywołane w joinGameWithSeat
      console.log(`🎮 Game state updated, player should now see the game`);
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('Failed to join game');
      }
    }
  };

  const handleExitGame = async () => {
    if (gameState.playerId) {
      try {
        await socketService.leaveGameHTTP(gameState.playerId);
        socketService.leaveGame(gameState.playerId);

        setGameState(prev => ({
          isPlaying: false,
          playerId: null,
          playerSeat: null,
          balance: 0,
          occupiedSeats: prev.occupiedSeats.filter(seat => seat !== prev.playerSeat)
        }));
      } catch (error) {
        console.error('Error leaving game:', error);
        // Zawsze pozwól wyjść z gry nawet przy błędzie API
        setGameState(prev => ({
          isPlaying: false,
          playerId: null,
          playerSeat: null,
          balance: 0,
          occupiedSeats: prev.occupiedSeats.filter(seat => seat !== prev.playerSeat)
        }));
      }
    }
  };

  // Tymczasowe funkcje obsługi zdarzeń
  const handleSplit = () => console.log('Split clicked');
  const handleDouble = () => console.log('Double clicked');
  const handleStay = () => console.log('Stay clicked');
  const handleHit = () => console.log('Hit clicked');

  if (!isInitialized) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        color: 'white',
        fontSize: '18px'
      }}>
        Connecting to game server...
      </div>
    );
  }

  if (!gameState.isPlaying) {
    return (
      <GameLobby 
        onJoinGame={handleJoinGame}
        occupiedSeats={gameState.occupiedSeats}
        isConnected={isConnected}
      />
    );
  }

  return (
    <div className="app">
      <div className="game-container">
        <div className="game-header">
          <div className="balance">Balance: ${gameState.balance}</div>
          <button className="exit-button" onClick={handleExitGame}>
            EXIT
          </button>
        </div>
        <Table 
          dealerCards={[]}
          playerSpots={[
            { id: 1, cards: [], isOccupied: gameState.occupiedSeats.includes(1), betAmount: 0 },
            { id: 2, cards: [], isOccupied: gameState.occupiedSeats.includes(2), betAmount: 0 },
            { id: 3, cards: [], isOccupied: gameState.occupiedSeats.includes(3), betAmount: 0 }
          ]}
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
