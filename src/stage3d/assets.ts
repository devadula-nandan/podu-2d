import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createArenaFloorTexture, createArenaRoughnessTexture, type ArenaTheme } from './arenaTexture.js';
import { createWoodBumpTexture, createWoodTexture, type WoodTheme } from './woodTexture.js';
import { BOARD_THICK, BOARD_TOP, FLOOR_Y, NODE_RADIUS, PUCK_H } from './world.js';

export const ROUTE_SIDE = 0.044;
export const FIGURE_H = 0.72;
export const ENTRY_RING_R = 0.2;

export const PUCK_COLORS = {
  route: 0xf4efe4,
  reach: 0x4caf7a,
  battle: 0xff7043,
  selected: 0xffe082,
} as const;

export type PuckKind = keyof typeof PUCK_COLORS;

const arenaFloorByTheme = new Map<ArenaTheme, THREE.CanvasTexture>();
let arenaRough: THREE.CanvasTexture | null = null;
const woodByTheme = new Map<WoodTheme, THREE.CanvasTexture>();
let woodBump: THREE.CanvasTexture | null = null;

function cachedArenaFloor(theme: ArenaTheme): THREE.CanvasTexture {
  let tex = arenaFloorByTheme.get(theme);
  if (tex === undefined) {
    tex = createArenaFloorTexture(512, theme);
    arenaFloorByTheme.set(theme, tex);
  }
  return tex;
}

function cachedArenaRough(): THREE.CanvasTexture {
  if (arenaRough === null) arenaRough = createArenaRoughnessTexture(256);
  return arenaRough;
}

function cachedWood(theme: WoodTheme): THREE.CanvasTexture {
  let tex = woodByTheme.get(theme);
  if (tex === undefined) {
    tex = createWoodTexture(512, theme);
    woodByTheme.set(theme, tex);
  }
  return tex;
}

function cachedWoodBump(): THREE.CanvasTexture {
  if (woodBump === null) woodBump = createWoodBumpTexture(256);
  return woodBump;
}

export function puckMaterial(kind: PuckKind = 'route'): THREE.MeshLambertMaterial {
  if (kind === 'reach') {
    return new THREE.MeshLambertMaterial({ color: PUCK_COLORS.reach, emissive: 0x1b5e20, emissiveIntensity: 0.35 });
  }
  if (kind === 'battle') {
    return new THREE.MeshLambertMaterial({ color: PUCK_COLORS.battle, emissive: 0xbf360c, emissiveIntensity: 0.4 });
  }
  if (kind === 'selected') {
    return new THREE.MeshLambertMaterial({ color: PUCK_COLORS.selected, emissive: 0xffb300, emissiveIntensity: 0.55 });
  }
  return new THREE.MeshLambertMaterial({ color: PUCK_COLORS.route });
}

/** Hockey-puck field node from the WebGL table. */
export function makeNodePuck(kind: PuckKind = 'route', radius = NODE_RADIUS): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, PUCK_H, 28), puckMaterial(kind));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.asset = 'node-puck';
  return mesh;
}

/** Thin square corridor between two world points. */
export function makeRouteBar(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y = 0,
  kind: PuckKind = 'route',
): THREE.Mesh {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(ROUTE_SIDE, PUCK_H, Math.max(0.01, len)), puckMaterial(kind));
  mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
  mesh.rotation.y = Math.atan2(dx, dz);
  mesh.userData.asset = 'route-bar';
  return mesh;
}

/** Square-ish entry ring around a corner. */
export function makeEntryRing(radius = ENTRY_RING_R, kind: PuckKind = 'route'): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 8, 32), puckMaterial(kind));
  ring.rotation.x = Math.PI / 2;
  ring.userData.asset = 'entry-ring';
  return ring;
}

/** Outline goal triangle from the WebGL table. */
export function makeGoalArrow(dir: 1 | -1 = 1, kind: PuckKind = 'route'): THREE.Group {
  const s = 0.2;
  const hy = (s * Math.sqrt(3)) / 2;
  const tip = { x: dir * s, z: 0 };
  const b0 = { x: dir * (-s / 2), z: hy };
  const b1 = { x: dir * (-s / 2), z: -hy };
  const group = new THREE.Group();
  group.add(makeRouteBar(tip.x, tip.z, b0.x, b0.z, 0, kind));
  group.add(makeRouteBar(tip.x, tip.z, b1.x, b1.z, 0, kind));
  group.add(makeRouteBar(b0.x, b0.z, b1.x, b1.z, 0, kind));
  group.userData.asset = 'goal-arrow';
  return group;
}

export function makeArenaGround(theme: ArenaTheme = 'dark'): THREE.Mesh {
  const floor = cachedArenaFloor(theme);
  const rough = cachedArenaRough();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(48, 64),
    new THREE.MeshStandardMaterial({
      map: floor,
      roughnessMap: rough,
      color: 0xffffff,
      roughness: 1,
      metalness: 0.06,
      emissive: theme === 'dark' ? 0x1a0c08 : 0x000000,
      emissiveIntensity: theme === 'dark' ? 0.22 : 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y;
  ground.receiveShadow = true;
  ground.userData.asset = 'arena-ground';
  return ground;
}

export function makeBoardSlab(theme: WoodTheme = 'dark'): THREE.Mesh {
  const wood = cachedWood(theme);
  const bump = cachedWoodBump();
  const top = new THREE.MeshStandardMaterial({
    map: wood,
    bumpMap: bump,
    bumpScale: 0.012,
    color: 0xffffff,
    roughness: theme === 'dark' ? 0.68 : 0.58,
    metalness: 0.03,
  });
  const side = new THREE.MeshStandardMaterial({
    color: theme === 'dark' ? 0xe8e4e0 : 0xfff8f0,
    roughness: 0.78,
    metalness: 0.02,
  });
  const board = new THREE.Mesh(new RoundedBoxGeometry(5.2, BOARD_THICK, 5.6, 4, 0.045), [
    side,
    side,
    top,
    side,
    side,
    side,
  ]);
  board.position.y = BOARD_TOP - BOARD_THICK / 2;
  board.castShadow = true;
  board.receiveShadow = true;
  board.userData.asset = 'board-slab';
  return board;
}

export function makeFigureSprite(map: THREE.Texture | null, selected = false): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map,
    color: map === null ? 0xcfd8dc : 0xffffff,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(selected ? 0.64 : 0.55, selected ? FIGURE_H * 1.08 : FIGURE_H, 1);
  sprite.center.set(0.5, 0);
  sprite.userData.asset = 'figure-sprite';
  return sprite;
}

export function addDuelLights(
  scene: THREE.Scene,
  opts: { readonly shadows?: boolean; readonly softShadows?: boolean } = {},
): {
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly rimYou: THREE.PointLight;
  readonly rimRival: THREE.PointLight;
} {
  const shadows = opts.shadows ?? true;
  const hemi = new THREE.HemisphereLight(0xffe0c0, 0x2a1510, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0e0, 1.2);
  key.position.set(2, 14, 6);
  key.castShadow = shadows;
  if (shadows) {
    key.shadow.mapSize.set(opts.softShadows === false ? 512 : 1024, opts.softShadows === false ? 512 : 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x4da3ff, 0.25);
  fill.position.set(-5, 6, -2);
  scene.add(fill);
  const rimYou = new THREE.PointLight(0x3d9bff, 35, 18);
  rimYou.position.set(0, 1.5, 4.5);
  scene.add(rimYou);
  const rimRival = new THREE.PointLight(0xff5252, 35, 18);
  rimRival.position.set(0, 1.5, -4.5);
  scene.add(rimRival);
  return { hemi, key, fill, rimYou, rimRival };
}

export function duelFogScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a0e0a);
  scene.fog = new THREE.FogExp2(0x1a0e0a, 0.028);
  addDuelLights(scene);
  return scene;
}
