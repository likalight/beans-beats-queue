const order = [
  ['intro', 150], ['problem', 200], ['order', 296], ['guest', 363], ['queue', 179], ['board', 400],
  ['story', 180], ['cockpit', 786], ['report', 174], ['facts', 210], ['outro', 210],
] as const;
type Key = typeof order[number][0];
export const TIMELINE = {} as Record<Key, { from: number; dur: number }> & { callAt: number };
let t = 0;
for (const [k, d] of order) { (TIMELINE as any)[k] = { from: t, dur: d }; t += d; }
TIMELINE.callAt = 128; // board takeover lands ~4.3s into the board clip
export const TOTAL = t;
