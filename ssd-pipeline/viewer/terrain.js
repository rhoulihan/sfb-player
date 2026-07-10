// Terrain (C9) — a lightweight slice for the tournament map: a barrier ring and asteroid fields. Pure
// functions over a terrain descriptor { barrier, asteroids }; the movement and fire resolvers consult
// asteroids for line-of-sight and the barrier for the map edge. Uses the same odd-q offset cube math as
// battle-geom so line-of-sight matches the board exactly.
const toCube = (q, r) => { const x = q, z = r - (q - (q & 1)) / 2; return { x, y: -x - z, z }; };
const toOffset = ({ x, z }) => ({ q: x, r: z + (x - (x & 1)) / 2 });

function cubeRound(c) {
  let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x), dy = Math.abs(ry - c.y), dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

export function hexLine(a, b) {
  const A = toCube(a.q, a.r), B = toCube(b.q, b.r);
  const N = Math.max(1, Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z));
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    out.push(toOffset(cubeRound({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t })));
  }
  return out;
}

export function asteroidAt(hex, terrain) {
  return ((terrain && terrain.asteroids) || []).some(h => h.q === hex.q && h.r === hex.r);
}

// P3.33 ELECTRONIC WARFARE: asteroids do NOT block line of sight (P3.31/P3.3) — they DEGRADE fire. Each asteroid hex
// on the line from the firing unit to the target, INCLUDING both endpoint hexes, gives the target one point of ECM
// (1 hex if both are in the same hex). This is natural ECM (D6.3143), counterable by ECCM.
export function asteroidEcm(a, b, terrain) {
  const ast = (terrain && terrain.asteroids) || [];
  if (!ast.length) return 0;
  const set = new Set(ast.map(h => `${h.q},${h.r}`));
  const counted = new Set();   // count each asteroid hex once — the degenerate same-hex line visits it twice (P3.33: 1 hex if both are in the same hex)
  for (const h of hexLine(a, b)) { const k = `${h.q},${h.r}`; if (set.has(k)) counted.add(k); }
  return counted.size;
}

export function inBarrier(hex, terrain) {
  const b = terrain && terrain.barrier;
  return !!b && (hex.q < b.minQ || hex.q > b.maxQ || hex.r < b.minR || hex.r > b.maxR);
}

// deterministic (no RNG — protects replay): open = empty; tournament = a barrier inset from the edge plus a
// fixed asteroid scatter around the center.
export function makeScenario(kind, cols, rows) {
  if (kind !== 'tournament') return { barrier: null, asteroids: [] };
  const inset = 2, cq = Math.floor(cols / 2), cr = Math.floor(rows / 2);
  const barrier = { minQ: inset, maxQ: cols - 1 - inset, minR: inset, maxR: rows - 1 - inset };
  const asteroids = [[-4, -1], [-2, 2], [-1, -3], [1, 3], [2, -2], [3, 1], [5, -1], [4, 3], [-5, 1], [0, -4]]
    .map(([dq, dr]) => ({ q: cq + dq, r: cr + dr }))
    .filter(h => h.q > inset && h.q < cols - inset && h.r > inset && h.r < rows - inset);
  return { barrier, asteroids };
}
