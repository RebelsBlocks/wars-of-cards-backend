import { useState, useEffect, useCallback, useRef } from 'react';
import { Table } from './components/Table';
import { Controls } from './components/Controls';
import { GameLobby } from './components/GameLobby';
import { socketService } from './services/socketService';
import { useGame } from './hooks/useGame';
import { api } from './services/api';
import { GameState as GameStateEnum } from './types/game';
import { Card } from './components/Card';
import type { Card as GameCard } from './types/game';
import { Suit, Rank } from '../../shared/types/api';
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
  const [previousGameData, setPreviousGameData] = useState<any>(null);

  const updateGameState = useCallback((newState: any) => {
    console.log(`🔥 updateGameState: ${newState.state}, players: ${newState.players?.length}, game: ${newState.id}`);
    
    const occupiedSeats = newState.players
      .filter((p: any) => !p.isDealer)
      .map((p: any) => p.seatNumber)
      .filter((seat: number | undefined): seat is number => seat !== undefined);

    setGameState(prev => {
      setPreviousGameData(prev.gameData); // Zapisz poprzedni stan
      return {
        ...prev,
        occupiedSeats,
        // ✅ Zachowaj pełny stan gry dla dalszego użycia
        gameData: newState
      };
    });
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

  // Use the game hook to get processed game state
  const gameInfo = useGame(gameState.gameData, gameState.playerId);

  // Helper function to get player for specific seat (current or other player)
  const getPlayerForSeat = (seatNumber: number) => {
    if (gameInfo.currentPlayer?.seatNumber === seatNumber) {
      return gameInfo.currentPlayer;
    }
    return gameInfo.otherPlayers.find(p => p.seatNumber === seatNumber);
  };

  // Helper function to convert game cards to React components
  const renderCards = (cards: GameCard[], playerId?: string, isDealer?: boolean): React.ReactNode[] => {
    return cards.map((card, index) => {
      // Backend wysyła suit jako 'HEARTS', ale komponent Card oczekuje '♥️'
      const suitSymbols: Record<string, string> = {
        'HEARTS': '♥️',
        'DIAMONDS': '♦️',
        'CLUBS': '♣️',
        'SPADES': '♠️'
      };
      
      // Backend wysyła rank jako 'ACE', ale komponent Card oczekuje 'A'  
      const rankDisplay: Record<string, string> = {
        'ACE': 'A',
        'JACK': 'J',
        'QUEEN': 'Q',
        'KING': 'K'
      };
      
      // Konwersja z formatu backend'u na format komponentu
      const suitSymbol = suitSymbols[card.suit];
      const rankSymbol = rankDisplay[card.rank] || card.rank;
      
      const cardForComponent = {
        rank: rankSymbol as Rank,
        suit: suitSymbol as Suit,
      };
      
      // Sprawdź czy to nowa karta (porównaj z poprzednim stanem)
      let isNewCard = false;
      if (previousGameData) {
        const previousCards = isDealer 
          ? previousGameData.players?.find((p: any) => p.isDealer)?.hands[0]?.cards || []
          : previousGameData.players?.find((p: any) => p.id === playerId)?.hands[0]?.cards || [];
        
        isNewCard = index >= previousCards.length;
      }
      
      const className = isNewCard ? 'card-deal-animation' : '';
      
      return (
        <Card 
          key={`${card.suit}-${card.rank}-${index}-${Date.now()}`} 
          card={cardForComponent} 
          isHidden={!card.isFaceUp}
          className={className}
        />
      );
    });
  };

  // Real game action handlers
  const handleHit = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.hit(gameState.gameData.id, gameState.playerId);
    } catch (error) {
      console.error('Failed to hit:', error);
      alert('Failed to hit. Please try again.');
    }
  };

  const handleStay = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.stand(gameState.gameData.id, gameState.playerId);
    } catch (error) {
      console.error('Failed to stand:', error);
      alert('Failed to stand. Please try again.');
    }
  };

  const handleDouble = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.double(gameState.gameData.id, gameState.playerId);
    } catch (error) {
      console.error('Failed to double:', error);
      alert('Failed to double. Please try again.');
    }
  };

  const handleSplit = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.split(gameState.gameData.id, gameState.playerId);
    } catch (error) {
      console.error('Failed to split:', error);
      alert('Failed to split. Please try again.');
    }
  };

  const handlePlaceBet = async (amount: number) => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.placeBet(gameState.gameData.id, gameState.playerId, amount);
    } catch (error) {
      console.error('Failed to place bet:', error);
      alert('Failed to place bet. Please try again.');
    }
  };

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
          <div className="balance">
            Balance: ${gameInfo.currentPlayer?.balance || gameState.balance}
          </div>
          <div className="game-status">
            {gameInfo.gameStatus}
          </div>
          {gameInfo.timeRemaining !== undefined && gameInfo.isTimeRunning && (
            <div className="timer">
              Time: {gameInfo.timeRemaining}s
            </div>
          )}
          <button className="exit-button" onClick={handleExitGame}>
            EXIT
          </button>
        </div>

        {/* Show betting controls during betting phase */}
        {gameState.gameData?.state === GameStateEnum.BETTING && gameInfo.currentPlayer && (
          <div className="betting-section">
            <h3>Place Your Bet</h3>
            <div className="bet-buttons">
              <button onClick={() => handlePlaceBet(10)}>$10</button>
              <button onClick={() => handlePlaceBet(25)}>$25</button>
              <button onClick={() => handlePlaceBet(50)}>$50</button>
              <button onClick={() => handlePlaceBet(100)}>$100</button>
            </div>
          </div>
        )}

        <Table 
          dealerCards={renderCards(gameInfo.dealer?.hands[0]?.cards || [], 'dealer', true)}
          playerSpots={[1, 2, 3].map(seatNumber => {
            const player = getPlayerForSeat(seatNumber);
            return {
              id: seatNumber,
              cards: renderCards(player?.hands[0]?.cards || [], player?.id),
              isOccupied: gameState.occupiedSeats.includes(seatNumber),
              betAmount: player?.hands[0]?.bet || 0
            };
          })}
        />

        {/* Show player's hand info */}
        {gameInfo.currentPlayer && (
          <div className="player-info-section">
            <div className="hand-info">
              <span>Your Hand Value: {gameInfo.myHandValue}</span>
              <span>Your Bet: ${gameInfo.currentPlayer.hands[0]?.bet || 0}</span>
              {gameInfo.isBlackjack && <span className="special">BLACKJACK!</span>}
              {gameInfo.isBusted && <span className="special">BUSTED!</span>}
            </div>
          </div>
        )}

        <div className="controls-container">
          <Controls
            onSplit={gameInfo.availableActions.canSplit ? handleSplit : undefined}
            onDouble={gameInfo.availableActions.canDouble ? handleDouble : undefined}
            onStay={gameInfo.availableActions.canStand ? handleStay : undefined}
            onHit={gameInfo.availableActions.canHit ? handleHit : undefined}
            betAmount={gameInfo.currentPlayer?.hands[0]?.bet || 0}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
