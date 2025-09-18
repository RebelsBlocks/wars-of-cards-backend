import { Card } from '../types/game';

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
    const suits: ('HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES')[] = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'];
    const ranks: ('ACE' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'JACK' | 'QUEEN' | 'KING')[] = 
      ['ACE', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING'];
    
    // Tworzymy 6 talii
    for (let deckIndex = 0; deckIndex < this.NUMBER_OF_DECKS; deckIndex++) {
      // Dla każdego koloru i każdej figury tworzymy nową kartę
      suits.forEach(suit => {
        ranks.forEach(rank => {
          deck.push({
            suit,
            rank,
            isFaceUp: false
          });
        });
      });
    }

    console.log(`🃏 Created deck with ${this.NUMBER_OF_DECKS} decks (${deck.length} cards total)`);
    
    // Sprawdź czy mamy poprawną liczbę kart każdego typu (6 kopii każdej z 52 kart)
    const cardStrings = deck.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    const expectedUniqueCards = 52; // 13 rang × 4 kolory
    const expectedCopiesPerCard = this.NUMBER_OF_DECKS; // 6 kopii każdej karty
    
    if (uniqueCards.size !== expectedUniqueCards) {
      console.error(`🚨 WRONG NUMBER OF CARD TYPES! Expected ${expectedUniqueCards} unique card types, got ${uniqueCards.size}`);
    } else if (deck.length !== expectedUniqueCards * expectedCopiesPerCard) {
      console.error(`🚨 WRONG TOTAL CARDS! Expected ${expectedUniqueCards * expectedCopiesPerCard} total cards, got ${deck.length}`);
    } else {
      console.log(`✅ Deck validation passed - ${uniqueCards.size} unique card types, ${deck.length} total cards (${expectedCopiesPerCard} copies each)`);
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
    
    // Sprawdź czy po tasowaniu nadal mamy poprawną liczbę kart
    const cardStrings = this.cards.map(card => `${card.rank}${card.suit}`);
    const uniqueCards = new Set(cardStrings);
    const expectedUniqueCards = 52; // 13 rang × 4 kolory
    const expectedCopiesPerCard = this.NUMBER_OF_DECKS; // 6 kopii każdej karty
    
    if (uniqueCards.size !== expectedUniqueCards) {
      console.error(`🚨 WRONG NUMBER OF CARD TYPES AFTER SHUFFLE! Expected ${expectedUniqueCards} unique card types, got ${uniqueCards.size}`);
    } else if (this.cards.length !== expectedUniqueCards * expectedCopiesPerCard) {
      console.error(`🚨 WRONG TOTAL CARDS AFTER SHUFFLE! Expected ${expectedUniqueCards * expectedCopiesPerCard} total cards, got ${this.cards.length}`);
    } else {
      console.log(`✅ Shuffle validation passed - ${uniqueCards.size} unique card types, ${this.cards.length} total cards (${expectedCopiesPerCard} copies each)`);
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

  // Zwraca karty jako tablicę (do kompatybilności z istniejącym kodem)
  public getDeckAsArray(): Card[] {
    return [...this.cards]; // Zwracamy kopię żeby nie modyfikować oryginalnej talii
  }
}
