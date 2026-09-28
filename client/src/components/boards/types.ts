export type BoardProps<S = any, M = any> = {
  state: S;
  /** My seat, or null when watching. */
  mySeat: number | null;
  turn: number;
  onMove: (m: M) => void;
  seats: { name: string }[];
  busy?: boolean;
};
