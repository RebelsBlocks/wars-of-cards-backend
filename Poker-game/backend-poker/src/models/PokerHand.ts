import { Card } from '../types/game';

export class PokerHand {
  constructor(private cards: Card[]) {}
  
  // Na razie placeholder dla backend logiki
  evaluate(): number {
    // TODO: implement later for game logic
    return 1;
  }
  
  compare(other: PokerHand): number {
    // TODO: implement later
    return 0;
  }
}
