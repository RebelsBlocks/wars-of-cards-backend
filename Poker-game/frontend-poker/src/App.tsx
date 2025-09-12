import { useState, useEffect, useCallback, useRef } from 'react';
import { Table } from './components/Table';
import { Controls } from './components/Controls';
import { GameLobby } from './components/GameLobby';
import { GameStats } from './components/GameStats';
import { GameTimer } from './components/GameTimer';
import { BuyInDialog } from './components/BuyInDialog';
import { socketService } from './services/socketService';
import { useGame } from './hooks/useGame';
import { api } from './services/api';
// import { GameState as GameStateEnum } from './types/game'; // 🚫 LEGACY: Nie używane po usunięciu betting phase
import { Card } from './components/Card';
import type { Card as GameCard } from './types/game';
import { Suit, Rank } from './types/shared';
import './App.css';
// Removed getHandValue import - not needed for poker

interface GameState {
  isPlaying: boolean;
  playerId: string | null;
  playerSeat: number | null;
  occupiedSeats: number[];
  gameData?: any; // Pełny stan gry z serwera
  isConnected?: boolean;
  notifications?: string[];
  buyInDialog?: {
    isOpen: boolean;
    message: string;
    timeout: number;
    minBuyIn: number;
  };
  timer?: {
    type: 'gameStart' | 'bet' | 'move';
    remainingTime: number;
    totalTime: number;
    isVisible: boolean;
    playerId?: string;
  };
}

function App() {
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    playerId: null,
    playerSeat: null,
    occupiedSeats: [],
    gameData: null,
    isConnected: false,
    notifications: [],
    buyInDialog: {
      isOpen: false,
      message: '',
      timeout: 30000,
      minBuyIn: 100
    },
    timer: {
      type: 'gameStart',
      remainingTime: 0,
      totalTime: 20000,
      isVisible: false
    }
  });

  // Test mode for split hands - set to true to see split visualization
  // const [TEST_SPLIT_MODE, setTestSplitMode] = useState(false);

  // Mock data for testing split hands
  // const getMockSplitData = () => {
  //   if (!false) return null;
  //   
  //   return {
  //     id: 'test-game',
  //     state: 'ROUND_ENDED',
  //     players: [
  //       // Dealer
  //       {
  //         id: 'dealer',
  //         hands: [{
  //           cards: [
  //             { suit: 'CLUBS', rank: 'JACK', isFaceUp: true },
  //             { suit: 'HEARTS', rank: '7', isFaceUp: true }
  //           ],
  //           bet: 0,
  //           isFinished: false,
  //           hasDoubled: false,
  //           hasSplit: false
  //         }],
  //         balance: 0,
  //         isDealer: true
  //       },
  //       // Player on seat 1 with split hands
  //       {
  //         id: gameState.playerId || 'test-player',
  //         hands: [
  //           {
  //             cards: [
  //               { suit: 'HEARTS', rank: 'KING', isFaceUp: true },
  //               { suit: 'SPADES', rank: '5', isFaceUp: true }
  //             ],
  //             bet: 100,
  //             isFinished: false,
  //             hasDoubled: false,
  //             hasSplit: true,
  //             result: 'WIN'
  //           },
  //           {
  //             cards: [
  //               { suit: 'DIAMONDS', rank: 'KING', isFaceUp: true },
  //               { suit: 'CLUBS', rank: '9', isFaceUp: true },
  //               { suit: 'HEARTS', rank: '2', isFaceUp: true }
  //             ],
  //             bet: 100,
  //             isFinished: false,
  //             hasDoubled: false,
  //             hasSplit: true,
  //             result: 'BUST'
  //           }
  //         ],
  //         balance: 900,
  //         isDealer: false,
  //         seatNumber: 3 // ✅ Seat 3 = lewy (pierwszy gracz)
  //       }
  //     ],
  //     currentPlayerIndex: 0,
  //     deck: [],
  //     occupiedSeats: [1]
  //   };
  // };

  // Use mock data if in test mode
  // const displayGameData = false ? getMockSplitData() || gameState.gameData : gameState.gameData;
  const displayGameData = gameState.gameData;
  
  // Debug log for test mode
  // if (false) {
  //   console.log('🧪 TEST SPLIT MODE ACTIVE');
  //   console.log('🧪 Mock data:', displayGameData);
  //   console.log('🧪 Players:', displayGameData?.players);
  // }
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  // Timer state usunięty - sprawdzamy backend w logach

  const initializationRef = useRef(false); // 🔥 GUARD przeciwko wielokrotnym inicjalizacjom
  const [previousGameData, setPreviousGameData] = useState<any>(null);

  const updateGameState = useCallback((newState: any) => {
    console.log(`🔥 updateGameState CALLED: ${newState.state}, players: ${newState.players?.length}, game: ${newState.id}`);
    
    const occupiedSeats = newState.players
      .filter((p: any) => !p.isDealer)
      .map((p: any) => p.seatNumber)
      .filter((seat: number | undefined): seat is number => seat !== undefined);

    setGameState(prev => {
      console.log(`🔄 setGameState called with new gameData`);
      
      // Player balance update logic - logs removed for cleaner console
      
      setPreviousGameData(prev.gameData); // Zapisz poprzedni stan
      return {
        ...prev,
        occupiedSeats,
        // ✅ Zachowaj pełny stan gry dla dalszego użycia
        gameData: newState
      };
    });
  }, []); // ✅ Usuń zależność gameState.playerId - używaj prev.playerId wewnątrz

  // Auto-clear notifications after 5 seconds
  useEffect(() => {
    if (gameState.notifications && gameState.notifications.length > 0) {
      const timer = setTimeout(() => {
        setGameState(prev => ({
          ...prev,
          notifications: []
        }));
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [gameState.notifications]);

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

        // Timer update - obsługujemy wszystkie typy timerów
        socketService.onTimeUpdate((data) => {
          // Obsługujemy wszystkie typy timerów: gameStart, bet, move
          setGameState(prev => ({
            ...prev,
            timer: {
              type: data.type as 'gameStart' | 'bet' | 'move',
              remainingTime: data.remainingTime,
              totalTime: data.totalTime,
              isVisible: true,
              playerId: data.playerId
            }
          }));
        });

        socketService.onKickedForInactivity((data) => {
          console.log('🚨 Kicked for inactivity:', data);
          // Gracz został wyrzucony za nieaktywność - wróć do lobby
          setGameState(prev => ({
            ...prev,
            isPlaying: false,
            playerId: null,
            playerSeat: null,
            notifications: [...(prev.notifications || []), data.reason]
          }));
        });

        socketService.onGameEnded((data) => {
          console.log('🏁 Game ended:', data);
          if (data.shouldReturnToLobby) {
            // Gra się skończyła - wróć do lobby
            setGameState(prev => ({
              ...prev,
              isPlaying: false,
              playerId: null,
              playerSeat: null,
              gameData: null,
              occupiedSeats: data.clearSeats ? [] : (prev.occupiedSeats || []),
              notifications: [...(prev.notifications || []), data.reason]
            }));
          }
        });

        socketService.onBuyInRequired((data) => {
          console.log('💰 Buy-in required:', data);
          setGameState(prev => ({
            ...prev,
            buyInDialog: {
              isOpen: true,
              message: data.message,
              timeout: data.timeout,
              minBuyIn: data.minBuyIn
            }
          }));
        });

        socketService.onBuyInConfirmed((data) => {
          console.log('✅ Buy-in confirmed:', data);
          setGameState(prev => ({
            ...prev,
            balance: data.newBalance,
            buyInDialog: {
              ...prev.buyInDialog!,
              isOpen: false
            }
          }));
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

  // Ukryj timer gdy czas się skończy lub stan gry się zmienia
  useEffect(() => {
    if (gameState.timer && gameState.timer.remainingTime <= 0) {
      setGameState(prev => ({
        ...prev,
        timer: {
          ...prev.timer!,
          isVisible: false
        }
      }));
    }
  }, [gameState.timer?.remainingTime]);

  // Ukryj timer gdy stan gry się zmienia (oprócz gameStart i move)
  useEffect(() => {
    if (gameState.gameData?.state && 
        gameState.gameData.state !== 'WAITING_FOR_PLAYERS' && 
        gameState.timer?.type !== 'move') {
      setGameState(prev => ({
        ...prev,
        timer: {
          ...prev.timer!,
          isVisible: false
        }
      }));
    }
  }, [gameState.gameData?.state, gameState.timer?.type]);

  // Pobieraj zajęte miejsca gdy jesteśmy w lobby (nie dołączeni do gry)
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;
    const MAIN_TABLE_ID = 'main-blackjack-table';
    const poll = async () => {
      try {
        const game = await api.getGameState(MAIN_TABLE_ID);
        if (game?.players) {
          const occupied = game.players
            .filter((p: any) => !p.isDealer)
            .map((p: any) => p.seatNumber)
            .filter((s: number | undefined): s is number => s !== undefined);
          setGameState(prev => ({ ...prev, occupiedSeats: occupied }));
        }
      } catch (error) {
        // ✅ CICHE obsłużenie - bez logowania błędów
        // 404 to normalne gdy gra nie istnieje - wszystkie miejsca wolne
        setGameState(prev => ({ ...prev, occupiedSeats: [] }));
        // NIE loguj błędu - to normalne zachowanie
      }
    };

    if (!gameState.isPlaying) {
      poll();
      pollTimer = setInterval(poll, 2000);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [gameState.isPlaying]);

  const handleJoinGame = async (buyIn: number, selectedSeat: number) => {
    try {
      console.log(`🎯 Starting join process for seat ${selectedSeat} with balance ${buyIn}`);
      
      // Check if socket is connected BEFORE join
      if (!socketService.isConnected()) {
        throw new Error('Connection to server has been lost. Please refresh the page.');
      }
      
      const player = await socketService.joinGameWithSeat(selectedSeat, buyIn);
      console.log(`✅ Successfully joined as player:`, player);
      
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        playerId: player.id,
        playerSeat: selectedSeat,
        occupiedSeats: [...prev.occupiedSeats, selectedSeat],
        timer: {
          type: 'gameStart',
          remainingTime: 0,
          totalTime: 20000,
          isVisible: false
        }
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
          occupiedSeats: prev.occupiedSeats.filter(seat => seat !== prev.playerSeat)
        }));
      } catch (error) {
        console.error('Error leaving game:', error);
        // Zawsze pozwól wyjść z gry nawet przy błędzie API
        setGameState(prev => ({
          isPlaying: false,
          playerId: null,
          playerSeat: null,
          occupiedSeats: prev.occupiedSeats.filter(seat => seat !== prev.playerSeat),
          timer: {
            type: 'gameStart',
            remainingTime: 0,
            totalTime: 20000,
            isVisible: false
          }
        }));
      }
    }
  };

  // Obsługa buy-in
  const handleBuyIn = (amount: number) => {
    if (gameState.playerId) {
      console.log(`💰 Processing buy-in: $${amount}`);
      socketService.requestBuyIn(gameState.playerId, amount);
    }
  };

  const handleDeclineBuyIn = () => {
    if (gameState.playerId) {
      console.log(`🚪 Declining buy-in`);
      socketService.declineBuyIn(gameState.playerId);
      
      // Zamknij dialog i opuść grę
      setGameState(prev => ({
        ...prev,
        buyInDialog: {
          ...prev.buyInDialog!,
          isOpen: false
        }
      }));
      
      handleExitGame();
    }
  };

  // Use the game hook to get processed game state
  // Usuń logowanie które powoduje spam w konsoli
  // console.log(`🎮 useGame input:`, {
  //   displayGameData: displayGameData ? {
  //     state: displayGameData.state,
  //     playersCount: displayGameData.players?.length,
  //     id: displayGameData.id
  //   } : null,
  //   playerId: gameState.playerId,
  //   hasDisplayGameData: !!displayGameData,
  //   hasPlayerId: !!gameState.playerId
  // });
  const gameInfo = useGame(displayGameData, gameState.playerId);



  // Helper function to convert game cards to React components
  const renderCards = (cards: GameCard[], playerId?: string, isDealer?: boolean): React.ReactNode[] => {
    // Debug log for test mode
    // if (false && cards.length > 2) {
    //   console.log(`🎴 Rendering ${cards.length} cards:`, cards.map(c => `${c.rank}${c.suit}`));
    // }
    
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
        const previousCards = playerId === 'community'
          ? previousGameData?.communityCards || []
          : isDealer 
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

  // Removed getDealerVisibleHandValue - not needed for poker

  // Real game action handlers
  // Funkcja do ukrywania timera 'move'
  const hideMoveTimer = () => {
    if (gameState.timer?.type === 'move') {
      setGameState(prev => ({
        ...prev,
        timer: {
          ...prev.timer!,
          isVisible: false
        }
      }));
    }
  };

  // 🆕 POKER HANDLERS

  const handleFold = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('🃏 Attempting FOLD action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      const response = await api.fold(gameState.gameData.id, gameState.playerId);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fold');
      }
      console.log('✅ FOLD action successful');
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('❌ Failed to fold:', error);
      alert('Failed to fold. Please try again.');
    }
  };

  const handleCheck = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('✅ Attempting CHECK action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      const response = await api.check(gameState.gameData.id, gameState.playerId);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to check');
      }
      console.log('✅ CHECK action successful');
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('❌ Failed to check:', error);
      alert('Failed to check. Please try again.');
    }
  };

  const handleCall = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('📞 Attempting CALL action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      const response = await api.call(gameState.gameData.id, gameState.playerId);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to call');
      }
      console.log('✅ CALL action successful');
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('❌ Failed to call:', error);
      alert('Failed to call. Please try again.');
    }
  };

  const handleRaise = async (amount: number) => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    console.log('📈 Attempting RAISE action:', {
      gameId: gameState.gameData.id,
      playerId: gameState.playerId,
      amount,
      currentState: gameState.gameData.state,
      isMyTurn: gameInfo.isMyTurn
    });
    try {
      const response = await api.raise(gameState.gameData.id, gameState.playerId, amount);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to raise');
      }
      console.log('✅ RAISE action successful');
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('❌ Failed to raise:', error);
      alert('Failed to raise. Please try again.');
    }
  };

  // 🚫 LEGACY: Blackjack handlers - nie używane w pokerze
  /*
  const handleDouble = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.double(gameState.gameData.id, gameState.playerId);
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('Failed to double:', error);
      alert('Failed to double. Please try again.');
    }
  };

  const handleSplit = async () => {
    if (!gameState.playerId || !gameState.gameData?.id) return;
    try {
      await api.split(gameState.gameData.id, gameState.playerId);
      hideMoveTimer(); // Ukryj timer po wykonaniu akcji
    } catch (error) {
      console.error('Failed to split:', error);
      alert('Failed to split. Please try again.');
    }
  };
  */

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
    console.log(`🔄 useEffect triggered - gameData changed:`, {
      hasGameData: !!gameState.gameData,
      gameDataState: gameState.gameData?.state,
      playersCount: gameState.gameData?.players?.length,
      currentPlayerIndex: gameState.gameData?.currentPlayerIndex,
      myPlayerId: gameState.playerId,
      isMyTurn: gameInfo.isMyTurn,
      availableActions: gameInfo.availableActions
    });
    
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
      
      // 🆕 POKER: Loguj pola licytacji
      console.log('🎯 Poker betting info:', {
        pot: gameState.gameData.pot,
        currentBet: gameState.gameData.currentBet,
        players: gameState.gameData.players?.map((p: any) => ({
          seatNumber: p.seatNumber,
          currentBet: p.currentBet,
          totalBet: p.totalBet,
          balance: p.balance
        }))
      });
    }
  }, [gameState.gameData, gameInfo]);

  // Ukryj timer 'move' gdy tura gracza się skończy
  useEffect(() => {
    if (gameState.timer?.type === 'move' && !gameInfo.isMyTurn) {
      console.log('⏰ Hiding move timer - not my turn anymore');
      setGameState(prev => ({
        ...prev,
        timer: {
          ...prev.timer!,
          isVisible: false
        }
      }));
    }
  }, [gameInfo.isMyTurn, gameState.timer?.type]);

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
      {/* Notifications */}
      {gameState.notifications && gameState.notifications.length > 0 && (
        <div className="notifications-container">
          {gameState.notifications.map((notification, index) => (
            <div key={index} className="notification">
              {notification}
            </div>
          ))}
        </div>
      )}
      
      <div className="game-container">
        <GameStats
          balance={gameInfo.currentPlayer?.balance ?? 0}
          gameStatus={gameInfo.gameStatus}
          onExitGame={handleExitGame}
        />

        {/* Game Timer */}
        {gameState.timer && (
          <GameTimer
            remainingTime={gameState.timer.remainingTime}
            totalTime={gameState.timer.totalTime}
            type={gameState.timer.type}
            isVisible={gameState.timer.isVisible}
            playerId={gameState.timer.playerId}
            isMyTurn={gameState.timer.type === 'move' && gameState.timer.playerId === gameState.playerId}
          />
        )}

        {(() => {
          const currentPlayerId = displayGameData?.currentPlayerIndex !== undefined && displayGameData?.currentPlayerIndex >= 0 && displayGameData?.players[displayGameData.currentPlayerIndex] ? displayGameData.players[displayGameData.currentPlayerIndex].id : undefined;
          
          // Debug log removed for cleaner console
          
          return (
            <Table 
              communityCards={renderCards(displayGameData?.communityCards || [], 'community')}
              communityCardsData={displayGameData?.communityCards || []}
              potAmount={gameInfo.potAmount}
              currentBet={gameInfo.currentBet}
              dealerHandResult={gameInfo.dealer?.hands[0]?.result}
              players={displayGameData?.players || []}
              occupiedSeats={gameState.occupiedSeats}
              currentPlayerId={currentPlayerId}
              myPlayerId={gameState.playerId || undefined}
              showBettingInterface={false} // 🚫 LEGACY: Betting phase - nie używane w pokerze
              onPlaceBet={handlePlaceBet}
              currentBalance={gameInfo.currentPlayer?.balance}
            />
          );
        })()}

        {/* Usunięto player-info-section z wartością ręki - teraz jest w kółeczku */}

        <div className="controls-container">
          <Controls
            // 🆕 POKER HANDLERS
            onCall={handleCall}
            onRaise={handleRaise}
            currentBet={gameState.gameData?.currentBet || 0}
            
            // 🆕 PROCESS FUNCTIONS (as requested by user)
            processFold={handleFold}
            processCheck={handleCheck}
            
            // 🚫 LEGACY: Blackjack handlers - nie używane w pokerze
            onSplit={undefined}
            onDouble={undefined}
          />
          
          {/* Test Mode Toggle */}
          {/* <div style={{ marginTop: '20px' }}>
            <button 
              onClick={() => console.log('Test mode disabled')}
              style={{
                background: '#6c757d',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🧪 Test Split OFF
            </button>
          </div> */}
        </div>
      </div>

      {/* Buy-in Dialog */}
      {gameState.buyInDialog && (
        <BuyInDialog
          isOpen={gameState.buyInDialog.isOpen}
          message={gameState.buyInDialog.message}
          timeout={gameState.buyInDialog.timeout}
          minBuyIn={gameState.buyInDialog.minBuyIn}
          onBuyIn={handleBuyIn}
          onDecline={handleDeclineBuyIn}
        />
      )}
    </div>
  );
}

export default App;