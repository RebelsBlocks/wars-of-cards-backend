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
import { getHandValue } from './utils/cardHelpers';

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
    balance: 1000,
    occupiedSeats: [],
  });
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  // Timer state usunięty - sprawdzamy backend w logach

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

        // Wyłączone - sprawdzamy backend timery w logach
        socketService.onTimeUpdate((data) => {
          // Nie wyświetlamy timera w UI - tylko logi backend
          console.log(`⏰ Backend timer: ${data.type} - ${Math.ceil(data.remainingTime / 1000)}s remaining`);
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

  // Funkcja do liczenia wartości tylko odsłoniętych kart dealera
  const getDealerVisibleHandValue = () => {
    if (!gameInfo.dealer?.hands[0]?.cards) return undefined;
    
    const visibleCards = gameInfo.dealer.hands[0].cards.filter(card => card.isFaceUp);
    if (visibleCards.length === 0) return undefined;
    
    // Użyj tej samej logiki co getHandValue, ale tylko dla odsłoniętych kart
    const mockHand = { 
      cards: visibleCards,
      bet: 0,
      isFinished: false,
      hasDoubled: false,
      hasSplit: false
    };
    return getHandValue(mockHand);
  };

  // Real game action handlers
  const handleHit = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('🎯 Attempting HIT action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      await api.hit(gameState.gameData.id, gameState.playerId);
      console.log('✅ HIT action successful');
    } catch (error) {
      console.error('❌ Failed to hit:', error);
      alert('Failed to hit. Please try again.');
    }
  };

  const handleStay = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('🛑 Attempting STAND action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      await api.stand(gameState.gameData.id, gameState.playerId);
      console.log('✅ STAND action successful');
    } catch (error) {
      console.error('❌ Failed to stand:', error);
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
    console.log('💰 Attempting to place bet:', {
      amount,
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      currentBalance: gameInfo.currentPlayer?.balance
    });
    try {
      await api.placeBet(gameState.gameData.id, gameState.playerId, amount);
      console.log('✅ Bet placed successfully');
    } catch (error) {
      console.error('❌ Failed to place bet:', error);
      alert('Failed to place bet. Please try again.');
    }
  };

  // Dodaj logowanie dla zmian stanu gry
  useEffect(() => {
    if (gameState.gameData) {
      console.log('🔄 Game state updated:', {
        state: gameState.gameData.state,
        playersCount: gameState.gameData.players.length,
        currentPlayerIndex: gameState.gameData.currentPlayerIndex,
        myPlayerId: gameState.playerId,
        isMyTurn: gameInfo.isMyTurn,
        availableActions: gameInfo.availableActions
      });

      // Logi stanów gry - timer wyłączony
      console.log(`🎮 Game state: ${gameState.gameData.state}`);
    }
  }, [gameState.gameData, gameInfo]);

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
          {/* Timer wyłączony - sprawdzamy backend w logach */}
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
          dealerHandValue={getDealerVisibleHandValue()}
          playerSpots={[1, 2, 3].map(seatNumber => {
            const player = getPlayerForSeat(seatNumber);
            const hand = player?.hands[0];
            return {
              id: seatNumber,
              cards: renderCards(hand?.cards || [], player?.id),
              isOccupied: gameState.occupiedSeats.includes(seatNumber),
              betAmount: hand?.bet || 0,
              handValue: hand?.cards && hand.cards.length > 0 ? 
                getHandValue(hand) : undefined
            };
          })}
        />

        {/* Usunięto player-info-section z wartością ręki - teraz jest w kółeczku */}

        <div className="controls-container">
          <Controls
            onSplit={gameInfo.availableActions.canSplit ? handleSplit : undefined}
            onDouble={gameInfo.availableActions.canDouble ? handleDouble : undefined}
            onStay={gameInfo.availableActions.canStand ? handleStay : undefined}
            onHit={gameInfo.availableActions.canHit ? handleHit : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
