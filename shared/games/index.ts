import { chess } from "./chess";
import { ludo } from "./ludo";
import { tictactoe } from "./tictactoe";
import { connect4 } from "./connect4";
import type { Engine } from "./types";

export const ENGINES: Record<string, Engine> = { chess, ludo, tictactoe, connect4 };
export const BOARD_GAMES = Object.values(ENGINES);
export type GameKind = keyof typeof ENGINES;
export * from "./types";
