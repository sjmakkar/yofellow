// Common shape for every board game. The same rules run on the server (which is
// the referee for multiplayer games) and in the browser (solo games vs the
// computer, which also work offline).

export type Rng = () => number;

export type Result = {
  over: boolean;
  winners: number[]; // seat numbers
  draw?: boolean;
  text?: string; // e.g. "Checkmate", "Four in a row"
};

export interface Engine<S = any, M = any> {
  kind: string;
  title: string;
  icon: string;
  minPlayers: number;
  maxPlayers: number;
  /** Fresh game for this many seats. */
  init(players: number, rng: Rng): S;
  /** Seat whose turn it is. */
  turn(s: S): number;
  /** null if the move is allowed, otherwise a short reason. */
  check(s: S, seat: number, m: M): string | null;
  /** Returns the next state (never mutates s). */
  apply(s: S, seat: number, m: M, rng: Rng): S;
  result(s: S): Result;
  /** A move for a computer player. */
  bot(s: S, seat: number, rng: Rng): M;
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
