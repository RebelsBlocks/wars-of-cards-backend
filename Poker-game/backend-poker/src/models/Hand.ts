import { Card, HandResult } from '../types/game';

export class Hand {
  constructor(
    public cards: Card[] = [],
    public bet: number = 0,
    public isFinished: boolean = false,
    public hasDoubled: boolean = false,
    public hasSplit: boolean = false,
    public result?: HandResult
  ) {}

  // 🚫 DEPRECATED - Will be replaced with poker hand evaluation
  // Oblicza wartość ręki z uwzględnieniem asów (1 lub 11)
  public calculateValue(): number {
    let value = 0;
    let aces = 0;

    for (const card of this.cards) {
      if (card.rank === 'ACE') {
        aces += 1;
      } else if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) {
        value += 10;
      } else {
        value += parseInt(card.rank);
      }
    }

    // Dodaj wartość asów - najpierw próbuj 11, potem 1
    for (let i = 0; i < aces; i++) {
      if (value + 11 <= 21) {
        value += 11;
      } else {
        value += 1;
      }
    }

    return value;
  }

  // 🚫 DEPRECATED - Poker mode doesn't use split logic
  // Sprawdza czy można wykonać split (dwie karty tej samej wartości)
  public canSplit(): boolean {
    if (this.cards.length !== 2) return false;
    
    const firstCard = this.cards[0];
    const secondCard = this.cards[1];
    
    return firstCard.rank === secondCard.rank;
  }

  // 🚫 DEPRECATED - Poker mode doesn't use blackjack logic
  // Sprawdza czy ręka to Blackjack (dwie karty = 21)
  public isBlackjack(): boolean {
    return this.cards.length === 2 && this.calculateValue() === 21;
  }

  // 🚫 DEPRECATED - Poker mode doesn't use bust logic
  // Sprawdza czy ręka przebiła (powyżej 21)
  public isBust(): boolean {
    return this.calculateValue() > 21;
  }

  // 🚫 DEPRECATED - Poker mode doesn't use hit logic
  // Sprawdza czy można dobrać kartę (nie przebita i nie skończona)
  public canHit(): boolean {
    return !this.isBust() && !this.isFinished;
  }

  // 🚫 DEPRECATED - Poker mode doesn't use double logic
  // Sprawdza czy można podwoić (tylko z pierwszymi dwoma kartami)
  public canDouble(): boolean {
    return this.cards.length === 2 && !this.isFinished;
  }

  // Dodaje kartę do ręki
  public addCard(card: Card): void {
    this.cards.push(card);
  }

  // Resetuje rękę do stanu początkowego
  public reset(): void {
    this.cards = [];
    this.bet = 0;
    this.isFinished = false;
    this.hasDoubled = false;
    this.hasSplit = false;
    this.result = undefined;
  }

  // Formatuje kartę do wyświetlania (helper)
  private formatCard(card: Card): string {
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
    const rank = rankDisplay[card.rank] || card.rank;
    const suit = suitSymbols[card.suit] || card.suit;
    return `${rank}${suit}`;
  }

  // Formatuje rękę do wyświetlania
  public formatHand(): string {
    return this.cards.map(card => this.formatCard(card)).join(', ');
  }

  // Zwraca widoczne karty (dla dealera)
  public getVisibleCards(): Card[] {
    return this.cards.filter(card => card.isFaceUp);
  }

  // 🚫 DEPRECATED - Poker mode doesn't use visible card value logic
  // Oblicza wartość widocznych kart
  public calculateVisibleValue(): number {
    return this.getVisibleCards().reduce((value, card) => {
      if (card.rank === 'ACE') return value + 11;
      if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) return value + 10;
      return value + parseInt(card.rank);
    }, 0);
  }
}
