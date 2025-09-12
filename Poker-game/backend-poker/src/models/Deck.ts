import { Card, Suit, Rank } from './Card';

export class Deck {
  private cards: Card[];
  private readonly NUMBER_OF_DECKS = 6;
  private readonly CUT_CARD_THRESHOLD = 78; // 25% z 312 kart

  constructor() {
    this.cards = this.createDeck();
    this.shuffle();
  }

  // Tworzy nową talię z 6 taliami (312 kart)
  private createDeck(): Card[] {
    const deck: Card[] = [];
    
    // Tworzymy 6 talii
    for (let deckIndex = 0; deckIndex < this.NUMBER_OF_DECKS; deckIndex++) {
      // Dla każdego koloru i każdej figury tworzymy nową kartę
      Object.values(Suit).forEach(suit => {
        Object.values(Rank).forEach(rank => {
          deck.push(new Card(suit, rank));
        });
      });
    }

    console.log(`🃏 Created deck with ${this.NUMBER_OF_DECKS} decks (${deck.length} cards total)`);
    
    // Sprawdź czy są duplikaty
    const cardStrings = deck.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    if (uniqueCards.size !== deck.length) {
      console.error(`🚨 DUPLICATE CARDS DETECTED! Expected ${deck.length}, got ${uniqueCards.size} unique cards`);
    } else {
      console.log(`✅ Deck validation passed - ${uniqueCards.size} unique cards`);
    }

    return deck;
  }

  // Tasuje karty używając algorytmu Fisher-Yates
  public shuffle(): void {
    console.log(`🃏 Shuffling deck with ${this.cards.length} cards`);
    
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    
    // Sprawdź czy po tasowaniu nie ma duplikatów
    const cardStrings = this.cards.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    if (uniqueCards.size !== this.cards.length) {
      console.error(`🚨 DUPLICATE CARDS AFTER SHUFFLE! Expected ${this.cards.length}, got ${uniqueCards.size} unique cards`);
    } else {
      console.log(`✅ Shuffle validation passed - ${uniqueCards.size} unique cards`);
    }
  }

  // Rozdaje jedną kartę (zdejmuje z wierzchu talii)
  public dealCard(): Card | null {
    if (this.isEmpty()) {
      return null;
    }
    
    // Sprawdź czy trzeba tasować (cut card logic)
    if (this.cards.length < this.CUT_CARD_THRESHOLD) {
      console.log(`🃏 Cut card reached! ${this.cards.length} cards remaining, shuffling new deck...`);
      this.reset();
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
