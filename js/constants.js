// Board geometry & shared constants (15x15 grid, col/row with row 0 at the top)

export const COLORS = ['red', 'green', 'yellow', 'blue'];
export const COLOR_HEX = {
  red: 0xe53935,
  green: 0x2fae4f,
  yellow: 0xf9c623,
  blue: 0x1e88e5,
};
export const COLOR_CSS = {
  red: '#e53935',
  green: '#2fae4f',
  yellow: '#f9c623',
  blue: '#1e88e5',
};
export const COLOR_NAME = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };

// 52-cell main track, clockwise, index 0 = red's start square
export const TRACK = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

export const START_INDEX = [0, 13, 26, 39];
export const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const STAR_INDICES = new Set([8, 21, 34, 47]);

// Home column cells (progress 51..55) per color
export const HOME_COLUMN = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
];

// Final resting spot inside the centre triangle (fractional grid coords)
export const HOME_SPOT = [[6.15, 7], [7, 6.15], [7.85, 7], [7, 7.85]];

// Yard corners (top-left cell of the 6x6 yard)
export const YARD_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];
export function yardSpot(p, t) {
  const [ox, oy] = YARD_ORIGIN[p];
  // yard spans cells 0..5, centre at 2.5
  const dx = t % 2 === 0 ? 1.6 : 3.4;
  const dy = t < 2 ? 1.6 : 3.4;
  return [ox + dx, oy + dy];
}

export const PROGRESS_HOME = 56; // finished
export const PROGRESS_LAST_TRACK = 50;

// Seat layouts for 2/3/4 player games
export const SEATS_FOR = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export function trackIndexFor(player, progress) {
  if (progress < 0 || progress > PROGRESS_LAST_TRACK) return -1;
  return (START_INDEX[player] + progress) % 52;
}

// Grid coordinates (col,row) for a token at a given progress
export function cellFor(player, token, progress) {
  if (progress < 0) return yardSpot(player, token);
  if (progress <= PROGRESS_LAST_TRACK) return TRACK[trackIndexFor(player, progress)];
  if (progress < PROGRESS_HOME) return HOME_COLUMN[player][progress - 51];
  return HOME_SPOT[player];
}
