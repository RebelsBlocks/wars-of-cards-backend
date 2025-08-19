import type { Card, Hand } from '../types/game';

/**
 * Oblicza wartość pojedynczej karty
 */
export function getCardValue(card: Card): number {
  if (card.rank === 'ACE') return 11; // As początkowo ma wartość 11
  if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

/**
 * Oblicza wartość ręki uwzględniając asy
 */
export function getHandValue(hand: Hand): number {
  let value = 0;
  let aces = 0;

  // Zlicz wartość wszystkich kart i liczbę asów
  for (const card of hand.cards) {
    if (card.rank === 'ACE') {
      aces++;
      value += 11;
    } else if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Przelicz asy z 11 na 1 jeśli wartość przekracza 21
  while (value > 21 && aces > 0) {
    value -= 10; // Zmiana asa z 11 na 1
    aces--;
  }

  return value;
}

/**
 * Sprawdza czy ręka to blackjack (21 z dwóch kart: as + figura/10)
 */
export function isBlackjack(hand: Hand): boolean {
  if (hand.cards.length !== 2) return false;
  
  const values = hand.cards.map(card => {
    if (card.rank === 'ACE') return 11;
    if (['JACK', 'QUEEN', 'KING', '10'].includes(card.rank)) return 10;
    return parseInt(card.rank);
  });

  return values.includes(11) && values.includes(10);
}

/**
 * Sprawdza czy ręka jest przegrana (powyżej 21)
 */
export function isBusted(hand: Hand): boolean {
  return getHandValue(hand) > 21;
}

/**
 * Sprawdza czy można splitować ręką (dwie karty tej samej wartości)
 */
export function canSplit(hand: Hand): boolean {
  if (hand.cards.length !== 2) return false;
  
  const card1 = hand.cards[0];
  const card2 = hand.cards[1];
  
  // Sprawdź czy obie karty mają tę samą wartość w grze
  const value1 = ['JACK', 'QUEEN', 'KING'].includes(card1.rank) ? 10 : card1.rank;
  const value2 = ['JACK', 'QUEEN', 'KING'].includes(card2.rank) ? 10 : card2.rank;
  
  return value1 === value2;
}

/**
 * Sprawdza czy można podwoić stawkę (dwie karty + wystarczające środki)
 */
export function canDouble(hand: Hand, balance: number, currentBet: number): boolean {
  return hand.cards.length === 2 && balance >= currentBet;
}

/**
 * Formatuje wartość ręki dla wyświetlenia (pokazuje soft/hard asy)
 */
export function formatHandValue(hand: Hand): string {
  const value = getHandValue(hand);
  
  // Sprawdź czy mamy "soft" asa (as liczony jako 11)
  let tempValue = 0;
  let aces = 0;
  
  for (const card of hand.cards) {
    if (card.rank === 'ACE') {
      aces++;
      tempValue += 11;
    } else if (['JACK', 'QUEEN', 'KING'].includes(card.rank)) {
      tempValue += 10;
    } else {
      tempValue += parseInt(card.rank);
    }
  }
  
  const hasoftAce = aces > 0 && tempValue <= 21;
  
  if (hasoftAce && value !== 21) {
    return `${value} (soft)`;
  }
  
  return value.toString();
}

/**
 * Zwraca nazwę karty dla wyświetlenia
 */
export function getCardDisplayName(card: Card): string {
  const suitSymbols = {
    HEARTS: '♥️',
    DIAMONDS: '♦️',
    CLUBS: '♣️',
    SPADES: '♠️'
  };
  
  const rankNames = {
    ACE: 'A',
    JACK: 'J',
    QUEEN: 'Q',
    KING: 'K'
  };
  
  const rank = rankNames[card.rank as keyof typeof rankNames] || card.rank;
  const suit = suitSymbols[card.suit];
  
  return `${rank}${suit}`;
}
