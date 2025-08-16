import { Card, Suit, Rank } from './Card';

export class Deck {
  private cards: Card[];

  constructor() {
    this.cards = this.createDeck();
    this.shuffle();
  }

  // Tworzy nową, pełną talię 52 kart
  private createDeck(): Card[] {
    const deck: Card[] = [];
    
    // Dla każdego koloru i każdej figury tworzymy nową kartę
    Object.values(Suit).forEach(suit => {
      Object.values(Rank).forEach(rank => {
        deck.push(new Card(suit, rank));
      });
    });

    return deck;
  }

  // Tasuje karty używając algorytmu Fisher-Yates
  public shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  // Rozdaje jedną kartę (zdejmuje z wierzchu talii)
  public dealCard(): Card | null {
    if (this.isEmpty()) {
      return null;
    }
    return this.cards.pop()!;
  }

  // Sprawdza czy talia jest pusta
  public isEmpty(): boolean {
    return this.cards.length === 0;
  }

  // Zwraca liczbę pozostałych kart w talii
  public remainingCards(): number {
    return this.cards.length;
  }

  // Resetuje talię - tworzy nową i tasuje
  public reset(): void {
    this.cards = this.createDeck();
    this.shuffle();
  }
}
