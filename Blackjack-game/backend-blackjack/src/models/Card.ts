// Enumy dla kolorów kart
export enum Suit {
  HEARTS = '♥️',
  DIAMONDS = '♦️',
  CLUBS = '♣️',
  SPADES = '♠️'
}

// Enumy dla figur
export enum Rank {
  TWO = '2',
  THREE = '3',
  FOUR = '4',
  FIVE = '5',
  SIX = '6',
  SEVEN = '7',
  EIGHT = '8',
  NINE = '9',
  TEN = '10',
  JACK = 'J',
  QUEEN = 'Q',
  KING = 'K',
  ACE = 'A'
}

export class Card {
  constructor(
    public readonly suit: Suit,
    public readonly rank: Rank
  ) {}

  // Zwraca wartość karty w Blackjacku
  getValue(): number {
    switch (this.rank) {
      case Rank.ACE:
        return 11; // As domyślnie wart 11, logika 1/11 będzie w klasie Hand
      case Rank.KING:
      case Rank.QUEEN:
      case Rank.JACK:
        return 10;
      default:
        return parseInt(this.rank);
    }
  }

  // Zwraca string reprezentujący kartę (np. "♠️K" dla Króla Pik)
  toString(): string {
    return `${this.suit}${this.rank}`;
  }

  // Sprawdza czy karta to As
  isAce(): boolean {
    return this.rank === Rank.ACE;
  }
}
