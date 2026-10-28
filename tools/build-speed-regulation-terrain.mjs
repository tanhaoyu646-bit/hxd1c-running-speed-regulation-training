import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';

const baseTerrainPath = process.argv[2];
if (!baseTerrainPath) throw new Error('请提供大山铺原生地形 JSON 路径。');

const readJson = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));
const [baseTerrain, scene, route] = await Promise.all([
  readJson(baseTerrainPath),
  readJson('assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json'),
  readJson('assets/msts-neiyi/neiyi-5635-trackdb-path.json'),
]);

const routePoints = buildRailAlignedPath(route.positions, scene.instances, { spacing: 5 });
const routeDistances = cumulativePathDistances(routePoints);
const targetRoute = routePoints
  .map((point, index) => ({ x: point[0], y: point[1], z: point[2], distance: routeDistances[index] }))
  .filter((point) => point.distance >= 22_500 && point.distance <= 30_500);

const syntheticKeys = [
  [-5732, 14700], [-5732, 14701], [-5732, 14702],
  [-5731, 14700], [-5731, 14701], [-5731, 14702],
  [-5730, 14700],
];
const resolution = 65;
const { tileSize, origin, originTile } = baseTerrain.source;
const [originX, , originZ] = origin;
const [originTileX, originTileZ] = originTile;

const worldAt = (tileX, tileZ, row, column) => {
  const localZ = tileSize * 0.5 - row / (resolution - 1) * tileSize;
  const localX = -tileSize * 0.5 + column / (resolution - 1) * tileSize;
  return {
    x: -(((tileX - originTileX) * tileSize) + localX - originX),
    z: ((tileZ - originTileZ) * tileSize) + localZ - originZ,
  };
};

const candidateAnchors = scene.instances
  .filter((instance) => ['StaticObj', 'TrackObj', 'BaseObj'].includes(instance.type))
  .map((instance) => ({ x: instance.position[0], y: instance.position[1], z: instance.position[2] }))
  .filter((point) => point.x >= -24_800 && point.x <= -18_500 && point.z >= -3_000 && point.z <= 4_000 && point.y >= -600 && point.y <= -300);

const nearestRoute = (x, z) => {
  let best = null;
  for (const point of targetRoute) {
    const dx = x - point.x;
    const dz = z - point.z;
    const distanceSq = dx * dx + dz * dz;
    if (!best || distanceSq < best.distanceSq) best = { ...point, distanceSq };
  }
  return best;
};

const anchorHeight = (x, z, routePoint) => {
  const nearest = [];
  for (const point of candidateAnchors) {
    const dx = x - point.x;
    const dz = z - point.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > 1_400 * 1_400) continue;
    nearest.push({ point, distanceSq });
  }
  nearest.sort((a, b) => a.distanceSq - b.distanceSq);
  const selected = nearest.slice(0, 8);
  if (!selected.length) return routePoint.y;
  let weighted = 0;
  let total = 0;
  for (const item of selected) {
    const weight = 1 / (item.distanceSq + 90 * 90);
    weighted += item.point.y * weight;
    total += weight;
  }
  const nearestDistance = Math.sqrt(selected[0].distanceSq);
  const blend = Math.max(0, Math.min(.68, 1 - nearestDistance / 900));
  return routePoint.y * (1 - blend) + weighted / total * blend;
};

const syntheticTiles = syntheticKeys.map(([tileX, tileZ]) => {
  const heights = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const { x, z } = worldAt(tileX, tileZ, row, column);
      const routePoint = nearestRoute(x, z);
      const lateral = Math.sqrt(routePoint.distanceSq);
      const base = anchorHeight(x, z, routePoint);
      const roughness = Math.min(1, lateral / 260);
      const noise = (Math.sin(x * .0017) + Math.cos(z * .0013) + Math.sin((x + z) * .0008)) * 3.2 * roughness;
      const terrainHeight = lateral < 38 ? Math.min(base, routePoint.y - .04) : base + noise;
      heights.push(Number((terrainHeight + .12).toFixed(3)));
    }
  }
  return { tileX, tileZ, resolution, heights, synthetic: true };
});

const tiles = [...baseTerrain.tiles, ...syntheticTiles];
const tileMap = new Map(tiles.map((tile) => [`${tile.tileX},${tile.tileZ}`, tile]));
const indexAt = (tile, row, column) => row * tile.resolution + column;

// 将程序化补齐块与相邻原生块的公共边精确焊接，避免移动中出现地形裂缝。
for (const tile of syntheticTiles) {
  const east = tileMap.get(`${tile.tileX + 1},${tile.tileZ}`);
  if (east && !east.synthetic) {
    for (let row = 0; row < tile.resolution; row += 1) {
      const sourceRow = Math.round(row / (tile.resolution - 1) * (east.resolution - 1));
      tile.heights[indexAt(tile, row, tile.resolution - 1)] = east.heights[indexAt(east, sourceRow, 0)];
    }
  }
  const north = tileMap.get(`${tile.tileX},${tile.tileZ + 1}`);
  if (north && !north.synthetic) {
    for (let column = 0; column < tile.resolution; column += 1) {
      const sourceColumn = Math.round(column / (tile.resolution - 1) * (north.resolution - 1));
      tile.heights[indexAt(tile, 0, column)] = north.heights[indexAt(north, north.resolution - 1, sourceColumn)];
    }
  }
}

const output = {
  source: {
    ...baseTerrain.source,
    derivedFrom: 'NEIYI原生大山铺地形＋24 km区段线路与场景锚点补齐',
  },
  summary: {
    tileCount: tiles.length,
    nativeTileCount: baseTerrain.tiles.length,
    syntheticTileCount: syntheticTiles.length,
    resolutions: [...new Set(tiles.map((tile) => tile.resolution))].sort((a, b) => a - b),
  },
  tiles,
};

await writeFile(
  resolve('assets/msts-neiyi-corridor/neiyi-speed-regulation-terrain.json'),
  `${JSON.stringify(output)}\n`,
);
console.log(JSON.stringify(output.summary));
