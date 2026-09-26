import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BoardGraph, BoardNode, FigureState, NodeId } from '../engine/index.js';
import { mpPath, OPEN_MOVEMENT } from '../engine/index.js';
import { easeInOutCubic, easeOutCubic } from '../player/motion.js';
import type { FieldHighlights } from '../player/draw-field.js';
import { RIVAL_HEX, YOU_HEX } from '../render/palette.js';
import { getSpriteImage } from '../render/sprite-images.js';
import { addDuelLights, makeArenaGround, makeBoardSlab, puckMaterial } from './assets.js';
import type { ArenaTheme } from './arenaTexture.js';
import { pokemonColor } from './pokemonColor.js';
import { createPlaceholderOrbTexture, getPokemonOrbTexture, orbGlassColor } from './pokemonArt.js';
import { createPlateCardTexture } from './plateCard.js';
import { createMpBadgeTexture, createNameBandTexture, createStatusIconsTexture, createWaitBadgeTexture } from './token.js';
import { detectTablePerf, type TablePerf } from './tablePerf.js';
import { BOARD_THICK, BOARD_TOP, FLOOR_Y, NODE_RADIUS, PUCK_H, ROUTE_Y, worldOfNode } from './world.js';

function themeTopHex(theme: ArenaTheme): number {
  return theme === 'light' ? 0xe8dcc4 : 0x121820;
}

function createCoinFaceTexture(
  label: string,
  top: string,
  bottom: string,
  ink: string,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.35, size * 0.32, size * 0.08, size * 0.5, size * 0.5, size * 0.52);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = size * 0.03;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.floor(size * 0.18)}px Tektur, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const ROUTE_SIDE = 0.044;
const PATH_HIGHLIGHT_SIDE = ROUTE_SIDE * 1.65;
const HIGHLIGHT_Y_BIAS = 0.004;
const PATH_MP_BUDGET = 8;
const GOAL_ARROW_S = 0.2;
const TIMER_R = BOARD_THICK / 2;
const FLOOR_PUCK_Y = FLOOR_Y + PUCK_H / 2;
const CLOCK_MS = 5 * 60_000;
const STACK_W = 0.62;
const STACK_H = STACK_W / (512 / 768);
const STACK_Y = FLOOR_Y + 0.02;
const HAND_COLS = 2;
const HAND_ROWS = 3;
const HAND_CARD_ASPECT = 512 / 768;
const HAND_GAP_X = 0.08;
const HAND_GAP_Y = 0.08;
const HAND_CAM_DIST = 5.2;
const HUD_TOP_PX = 88;
const HUD_BOTTOM_PX = 28;
const HUD_SIDE_PX = 12;
const CAM_POS = { x: 0, y: 11.5, z: 8.6 } as const;
/** Elevated start for match intro — eases down into CAM_POS. Keep within OrbitControls maxDistance (18). */
const CAM_INTRO_POS = { x: 0, y: 14.2, z: 10.8 } as const;
const BENCH_DROP_H = 3.2;
const BENCH_DROP_MS = 480;
const BENCH_DROP_STAGGER_MS = 85;
const CAM_INTRO_MS = 1100;
/** Wall-clock coin timing — frame counts stall forever when iPad drops to single-digit FPS. */
const COIN_FLIP_MS = 1500;
const COIN_HOLD_MS = 650;
const COIN_FLIP_MS_FAST = 950;
const COIN_HOLD_MS_FAST = 400;
const COIN_R = 0.85;
const COIN_H = 0.1;
const COIN_START_Y = BOARD_TOP + 5.0;

export type Table3dApi = {
  resetCamera: () => void;
  setCameraLocked: (locked: boolean) => void;
  /** Temporarily freeze orbit (e.g. during long-press) without changing the user lock. */
  setOrbitSuppressed: (suppressed: boolean) => void;
  setWorldTheme: (theme: ArenaTheme) => void;
  openPlateHand: () => void;
  collapsePlateHand: () => void;
  isPlateHandOpen: () => boolean;
  /** Zoom plate, hold, throw to a figure (uid) or the board center. */
  presentPlateUse: (slot: number, target: 'board' | number) => Promise<void>;
  figureWorldPos: (uid: number) => { x: number; y: number; z: number } | null;
  /** Match-start: coin flip → camera settle + bench drop. */
  playMatchIntro: (opts?: {
    onLand?: () => void;
    firstPlayer?: 'you' | 'rival';
    onCoinLand?: (winner: 'you' | 'rival') => void;
  }) => Promise<void>;
  /** Skip coin / drops — used when this match already showed the intro. */
  skipMatchIntro: () => void;
  playCoinFlip: (winner: 'you' | 'rival') => Promise<void>;
};

export interface Table3dPlate {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  readonly used: boolean;
  readonly playable: boolean;
  readonly rarity: string;
  readonly effect: string;
}

/** Path walk driven by the render loop (not React). */
export interface Table3dMove {
  readonly uid: number;
  readonly nodes: readonly NodeId[];
  readonly started: number;
  readonly duration: number;
}

type WorldPt = { readonly x: number; readonly y: number; readonly z: number };

interface ActiveHop {
  readonly uid: number;
  readonly points: readonly WorldPt[];
  readonly started: number;
  readonly duration: number;
}

interface IntroDrop {
  readonly uid: number;
  readonly dest: THREE.Vector3;
  readonly startY: number;
  readonly t0: number;
  readonly duration: number;
  readonly onLand?: () => void;
  readonly resolve: () => void;
  landed: boolean;
}

interface CamTween {
  readonly t0: number;
  readonly dur: number;
  readonly fromPos: THREE.Vector3;
  readonly toPos: THREE.Vector3;
  readonly fromTarget: THREE.Vector3;
  readonly toTarget: THREE.Vector3;
  readonly resolve: () => void;
}

interface CoinFlipFx {
  readonly mesh: THREE.Mesh;
  readonly winner: 'you' | 'rival';
  readonly t0: number;
  readonly flipMs: number;
  readonly holdMs: number;
  readonly startY: number;
  readonly landY: number;
  readonly endSpinX: number;
  readonly resolve: () => void;
  done: boolean;
}

interface PlateFx {
  readonly slot: number;
  phase: 'zoom' | 'hold' | 'throw';
  t0: number;
  readonly from: THREE.Vector3;
  readonly holdPos: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly startSx: number;
  readonly startSy: number;
  readonly holdSx: number;
  readonly holdSy: number;
  readonly resolve: () => void;
}

export interface Table3dScene {
  readonly board: BoardGraph;
  readonly figures: readonly FigureState[];
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly mpOf: (figure: FigureState) => number;
  readonly highlights: FieldHighlights;
  readonly flip: boolean;
  readonly clocks: readonly [number, number];
  readonly turnPlayer: 0 | 1;
  readonly plates?: readonly Table3dPlate[];
  readonly moves?: readonly Table3dMove[];
}

interface PieceMesh {
  readonly group: THREE.Group;
  readonly artMat: THREE.MeshBasicMaterial;
  readonly art: THREE.Mesh;
  readonly baseTopMat: THREE.MeshStandardMaterial;
  name: string;
  artKey: string | null;
  orbPending: string | null;
  wait: number;
}

export class Table3d {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly routeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly dimRouteMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
  });
  private readonly reachMat = puckMaterial('reach');
  private readonly pathBarMat = new THREE.MeshLambertMaterial({
    color: 0x4caf7a,
    emissive: 0x1b5e20,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.92,
  });
  private readonly battleMat = puckMaterial('battle');
  private readonly selectMat = puckMaterial('selected');
  private readonly nodeHits = new Map<string, THREE.Mesh>();
  private readonly nodePucks = new Map<string, THREE.Mesh>();
  private readonly boardRoutes: THREE.Mesh[] = [];
  private readonly goalArrows = new Map<string, THREE.Group>();
  private readonly pathHighlight = new THREE.Group();
  private readonly pieces = new Map<number, PieceMesh>();
  private readonly plates = new Map<number, THREE.Mesh>();
  private readonly nodeById = new Map<string, BoardNode>();
  private board: BoardGraph | null = null;
  private pathNodeIds = new Set<string>();
  private readonly pieceHits: THREE.Object3D[] = [];
  private readonly plateHits: THREE.Object3D[] = [];
  private flip = false;
  private highlights: FieldHighlights | null = null;
  private figures: readonly FigureState[] = [];
  private plateRows: readonly Table3dPlate[] = [];
  private moves = new Map<number, Table3dMove>();
  /** In-flight hops (explicit path moves + auto bench/PC hops). */
  private readonly hops = new Map<number, ActiveHop>();
  private readonly introDrops = new Map<number, IntroDrop>();
  private camTween: CamTween | null = null;
  private coinFlip: CoinFlipFx | null = null;
  private matchIntroPlayed = false;
  /** Benches stay elevated until finishMatchIntro starts drops. */
  private benchesHeldHigh = false;
  /** Stable bench pad index per uid — does not compact when a figure deploys. */
  private readonly benchSlotByUid = new Map<number, number>();
  private readonly lastWorld = new Map<number, THREE.Vector3>();
  private plateFx: PlateFx | null = null;
  private nameOf: Table3dScene['nameOf'] = () => '';
  private spriteUrlOf: Table3dScene['spriteUrlOf'] = () => null;
  private mpOf: Table3dScene['mpOf'] = () => 1;
  private clocks: readonly [number, number] = [CLOCK_MS, CLOCK_MS];
  private turnPlayer: 0 | 1 = 0;
  private timers: { you: TimerTube; rival: TimerTube } | null = null;
  private lights: ReturnType<typeof addDuelLights> | null = null;
  private worldTheme: ArenaTheme = 'dark';
  private handOpen = false;
  onHandChange: ((open: boolean) => void) | null = null;
  private userCamLocked = false;
  private orbitSuppressed = false;
  private readonly handRight = new THREE.Vector3();
  private readonly handUp = new THREE.Vector3();
  private readonly handFwd = new THREE.Vector3();
  private readonly handCenter = new THREE.Vector3();
  private disposed = false;
  private frame = 0;
  private readonly perf: TablePerf;
  private needsRender = true;
  private platesSettled = false;
  private hitLayoutDirty = true;
  private readonly lastCamPos = new THREE.Vector3();
  private readonly lastCamTarget = new THREE.Vector3();
  private visible = true;

  constructor(canvas: HTMLCanvasElement) {
    this.perf = detectTablePerf();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.perf.antialias,
      alpha: false,
      powerPreference: this.perf.shadows ? 'high-performance' : 'low-power',
    });
    this.renderer.setPixelRatio(this.perf.dpr);
    this.renderer.shadowMap.enabled = this.perf.shadows;
    this.renderer.shadowMap.type = this.perf.softShadows ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x1a0e0a);
    this.scene.fog = new THREE.FogExp2(0x1a0e0a, 0.028);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    // Start elevated; playMatchIntro eases into the duel framing
    this.camera.position.set(CAM_INTRO_POS.x, CAM_INTRO_POS.y, CAM_INTRO_POS.z);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 18;
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.update();
    this.controls.addEventListener('change', this.markDirty);
    this.scene.add(this.root);
    this.root.add(this.pathHighlight);
    this.lights = addDuelLights(this.scene, {
      shadows: this.perf.shadows,
      softShadows: this.perf.softShadows,
    });
    this.root.add(makeArenaGround('dark'));
    this.root.add(makeBoardSlab('dark'));
    this.timers = {
      you: this.makeTimer(3.2),
      rival: this.makeTimer(-3.2),
    };
    this.root.add(this.timers.you.root, this.timers.rival.root);
    this.buildBenches();
    this.lastCamPos.copy(this.camera.position);
    this.lastCamTarget.copy(this.controls.target);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.tick();
  }

  /** True when HTML hit overlays should re-project (camera/anim changed). */
  takeHitLayoutDirty(): boolean {
    if (this.isAnimating()) return true;
    if (!this.hitLayoutDirty) return false;
    this.hitLayoutDirty = false;
    return true;
  }

  /** True while camera / pieces / plates are mid-motion. */
  isAnimating(): boolean {
    return (
      this.coinFlip !== null ||
      this.camTween !== null ||
      this.hops.size > 0 ||
      this.introDrops.size > 0 ||
      this.plateFx !== null ||
      !this.platesSettled
    );
  }

  private readonly markDirty = (): void => {
    this.needsRender = true;
    this.platesSettled = false;
    this.hitLayoutDirty = true;
  };

  private readonly onVisibility = (): void => {
    this.visible = document.visibilityState !== 'hidden';
    if (this.visible) this.markDirty();
  };

  setSize(width: number, height: number): void {
    const w = Math.max(120, width);
    const h = Math.max(120, height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  setScene(next: Table3dScene): void {
    // Don't rebuild meshes mid-coin — clock/React ticks were choking iPad during the intro.
    if (this.coinFlip !== null) {
      this.highlights = next.highlights;
      this.figures = next.figures;
      this.nameOf = next.nameOf;
      this.spriteUrlOf = next.spriteUrlOf;
      this.mpOf = next.mpOf;
      this.clocks = next.clocks;
      this.turnPlayer = next.turnPlayer;
      this.plateRows = next.plates ?? [];
      if (next.moves !== undefined) this.ingestMoves(next.moves);
      return;
    }
    const graphChanged = this.nodeById.size !== next.board.nodes.length || this.flip !== next.flip;
    this.flip = next.flip;
    this.highlights = next.highlights;
    this.figures = next.figures;
    this.syncBenchSlots();
    this.nameOf = next.nameOf;
    this.spriteUrlOf = next.spriteUrlOf;
    this.mpOf = next.mpOf;
    this.clocks = next.clocks;
    this.turnPlayer = next.turnPlayer;
    this.plateRows = next.plates ?? [];
    if (next.moves !== undefined) {
      this.ingestMoves(next.moves);
    }
    if (graphChanged) this.rebuildGraph(next.board);
    this.syncPathHighlights();
    this.syncPucks();
    this.syncPieces();
    this.syncPlates();
    this.syncTimers();
    this.platesSettled = false;
    this.markDirty();
  }

  setMoves(moves: readonly Table3dMove[]): void {
    this.ingestMoves(moves);
    this.markDirty();
  }

  private ingestMoves(moves: readonly Table3dMove[]): void {
    this.moves.clear();
    const live = new Set<number>();
    for (const move of moves) {
      live.add(move.uid);
      this.moves.set(move.uid, move);
      this.startHopFromMove(move);
    }
    for (const uid of [...this.hops.keys()]) {
      if (live.has(uid)) continue;
      const hop = this.hops.get(uid);
      if (hop !== undefined && hop.started + hop.duration < performance.now()) this.hops.delete(uid);
    }
  }

  private startHopFromMove(move: Table3dMove): void {
    const existing = this.hops.get(move.uid);
    if (existing !== undefined && existing.started === move.started) return;

    const points: WorldPt[] = [];
    const piece = this.pieces.get(move.uid);
    const from =
      piece !== undefined
        ? { x: piece.group.position.x, y: piece.group.position.y, z: piece.group.position.z }
        : this.lastWorld.get(move.uid);
    if (from !== undefined) points.push(from);
    for (const id of move.nodes) {
      const node = this.nodeById.get(id);
      if (node === undefined) continue;
      const w = worldOfNode(node, this.flip);
      const pt = { x: w.x, y: BOARD_TOP, z: w.z };
      const prev = points[points.length - 1];
      if (prev !== undefined && Math.hypot(prev.x - pt.x, prev.y - pt.y, prev.z - pt.z) < 0.05) continue;
      points.push(pt);
    }
    if (points.length < 2) return;
    const hops = points.length - 1;
    this.hops.set(move.uid, {
      uid: move.uid,
      points,
      started: move.started,
      duration: Math.max(move.duration, 200 * hops),
    });
  }

  pick(clientX: number, clientY: number, rect: DOMRect): NodeId | null {
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodeHits.values()], false);
    const id = hits[0]?.object.userData.nodeId;
    return typeof id === 'string' ? (id as NodeId) : null;
  }

  pickFigure(clientX: number, clientY: number, rect: DOMRect): number | null {
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pieceHits, true);
    const uid = hits[0]?.object.userData.pieceUid ?? hits[0]?.object.parent?.userData.pieceUid;
    return typeof uid === 'number' ? uid : null;
  }

  pickPlate(clientX: number, clientY: number, rect: DOMRect): number | null {
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.plateHits, false);
    const slot = hits[0]?.object.userData.plateSlot;
    return typeof slot === 'number' ? slot : null;
  }

  project(node: BoardNode): { x: number; y: number; w: number; h: number } | null {
    const pos = worldOfNode(node, this.flip);
    const radius = node.kind === 'goal' ? 0.32 : 0.28;
    return this.projectDisc(pos.x, BOARD_TOP + 0.06, pos.z, radius);
  }

  projectWorld(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** Screen-space center + size (fractions of the canvas) for a ground disc. */
  projectDisc(x: number, y: number, z: number, radius: number): { x: number; y: number; w: number; h: number } | null {
    const mid = this.projectWorld(x, y, z);
    if (mid === null) return null;
    const right = this.projectWorld(x + radius, y, z);
    const up = this.projectWorld(x, y, z + radius);
    if (right === null || up === null) return null;
    const w = Math.max(0.02, Math.abs(right.x - mid.x) * 2);
    const h = Math.max(0.02, Math.abs(up.y - mid.y) * 2);
    // Prefer a circle covering the projected ellipse.
    const span = Math.max(w, h);
    return { x: mid.x, y: mid.y, w: span, h: span };
  }

  figureScreen(uid: number): { x: number; y: number; w: number; h: number } | null {
    const piece = this.pieces.get(uid);
    if (piece === undefined) return null;
    const p = piece.group.position;
    // Match the base + glass dome volume used for 3D picks.
    const baseR = 0.38;
    const bot = this.projectWorld(p.x, p.y + 0.02, p.z);
    const top = this.projectWorld(p.x, p.y + 0.92, p.z);
    const midY = p.y + 0.42;
    const mid = this.projectWorld(p.x, midY, p.z);
    const side = this.projectWorld(p.x + baseR, midY, p.z);
    if (bot === null || top === null || mid === null || side === null) return null;
    const w = Math.max(0.03, Math.abs(side.x - mid.x) * 2);
    const h = Math.max(0.03, Math.abs(top.y - bot.y));
    return { x: mid.x, y: (top.y + bot.y) / 2, w, h };
  }

  plateScreen(slot: number): { x: number; y: number; w: number; h: number } | null {
    const mesh = this.plates.get(slot);
    if (mesh === undefined) return null;
    const p = mesh.position;
    const sx = Math.abs(mesh.scale.x) * STACK_W * 0.5;
    const sy = Math.abs(mesh.scale.y) * STACK_H * 0.5;
    const mid = this.projectWorld(p.x, p.y, p.z);
    const right = this.projectWorld(p.x + sx, p.y, p.z);
    const up = this.projectWorld(p.x, p.y + sy, p.z);
    if (mid === null || right === null || up === null) return null;
    return {
      x: mid.x,
      y: mid.y,
      w: Math.max(0.02, Math.abs(right.x - mid.x) * 2),
      h: Math.max(0.02, Math.abs(up.y - mid.y) * 2),
    };
  }

  resetCamera(): void {
    this.camTween = null;
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.markDirty();
  }

  setCameraLocked(locked: boolean): void {
    this.userCamLocked = locked;
    this.applyOrbitLock();
  }

  setOrbitSuppressed(suppressed: boolean): void {
    this.orbitSuppressed = suppressed;
    this.applyOrbitLock();
  }

  private applyOrbitLock(): void {
    const lock =
      this.userCamLocked || this.orbitSuppressed || this.camTween !== null || this.coinFlip !== null;
    this.controls.enableRotate = !lock;
    this.controls.enableZoom = !lock;
  }

  playMatchIntro(opts?: {
    onLand?: () => void;
    firstPlayer?: 'you' | 'rival';
    onCoinLand?: (winner: 'you' | 'rival') => void;
  }): Promise<void> {
    if (this.matchIntroPlayed) return Promise.resolve();
    this.matchIntroPlayed = true;
    this.controls.enabled = false;
    this.camera.position.set(CAM_INTRO_POS.x, CAM_INTRO_POS.y, CAM_INTRO_POS.z);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Park bench figures high while the coin decides first player.
    this.benchesHeldHigh = true;
    this.syncBenchSlots();
    this.markDirty();
    for (const figure of this.figures) {
      if (figure.zone !== 'bench') continue;
      let piece = this.pieces.get(figure.uid);
      if (piece === undefined) {
        piece = this.makePiece(figure, this.nameOf(figure));
        this.pieces.set(figure.uid, piece);
        this.root.add(piece.group);
      }
      const dest = this.figureHome(figure);
      const startY = dest.y + BENCH_DROP_H;
      piece.group.position.set(dest.x, startY, dest.z);
      piece.group.scale.set(1, 1, 1);
      this.lastWorld.set(figure.uid, new THREE.Vector3(dest.x, startY, dest.z));
      this.hops.delete(figure.uid);
    }

    const first = opts?.firstPlayer ?? 'you';
    return this.playCoinFlip(first).then(() => {
      if (this.disposed) return;
      opts?.onCoinLand?.(first);
      return this.finishMatchIntro(opts?.onLand);
    });
  }

  /** Land immediately in play framing — no coin, no bench rain. */
  skipMatchIntro(): void {
    this.matchIntroPlayed = true;
    this.benchesHeldHigh = false;
    this.camTween = null;
    this.clearCoinFlip(false);
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = true;
    this.controls.update();
    this.applyOrbitLock();
    this.syncBenchSlots();
    for (const figure of this.figures) {
      if (figure.zone === 'excluded' || figure.zone === 'ultraSpace') continue;
      const piece = this.pieces.get(figure.uid);
      if (piece === undefined) continue;
      const home = this.figureHome(figure);
      piece.group.position.copy(home);
      this.lastWorld.set(figure.uid, home.clone());
      this.hops.delete(figure.uid);
      this.introDrops.delete(figure.uid);
    }
    this.markDirty();
  }

  playCoinFlip(winner: 'you' | 'rival'): Promise<void> {
    if (this.coinFlip !== null) return Promise.resolve();
    this.controls.enabled = false;

    const fast = this.perf.lite;
    const faceSize = fast ? 256 : 512;
    const youFace = createCoinFaceTexture('YOU', '#4d9fff', '#1565c0', '#ffffff', faceSize);
    const rivalFace = createCoinFaceTexture('RIVAL', '#ff6b6b', '#c62828', '#ffffff', faceSize);
    const edge = fast
      ? new THREE.MeshStandardMaterial({
          color: 0xffd54f,
          metalness: 0.55,
          roughness: 0.35,
          emissive: 0xb8860b,
          emissiveIntensity: 0.35,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xffd54f,
          metalness: 0.7,
          roughness: 0.25,
          emissive: 0xb8860b,
          emissiveIntensity: 0.45,
        });
    // Unlit faces so the labels stay readable under any lighting.
    const top = new THREE.MeshBasicMaterial({ map: youFace });
    const bottom = new THREE.MeshBasicMaterial({ map: rivalFace });
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 64),
      [edge, top, bottom],
    );
    mesh.castShadow = this.perf.shadows;
    mesh.renderOrder = 50;
    mesh.position.set(0, COIN_START_Y, 0);
    mesh.userData.coin = true;
    this.root.add(mesh);
    this.setFiguresHidden(true);

    const flips = 7;
    const endSpinX = winner === 'you' ? flips * Math.PI * 2 : flips * Math.PI * 2 + Math.PI;

    return new Promise((resolve) => {
      this.coinFlip = {
        mesh,
        winner,
        t0: performance.now(),
        flipMs: fast ? COIN_FLIP_MS_FAST : COIN_FLIP_MS,
        holdMs: fast ? COIN_HOLD_MS_FAST : COIN_HOLD_MS,
        startY: COIN_START_Y,
        landY: BOARD_TOP + COIN_H / 2 + 0.02,
        endSpinX,
        resolve,
        done: false,
      };
      this.markDirty();
    });
  }

  private finishMatchIntro(onLand?: () => void): Promise<void> {
    this.benchesHeldHigh = false;
    const now = performance.now();
    this.camera.position.set(CAM_INTRO_POS.x, CAM_INTRO_POS.y, CAM_INTRO_POS.z);
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = false;
    const camDone = new Promise<void>((resolve) => {
      this.camTween = {
        t0: now,
        dur: CAM_INTRO_MS,
        fromPos: this.camera.position.clone(),
        toPos: new THREE.Vector3(CAM_POS.x, CAM_POS.y, CAM_POS.z),
        fromTarget: this.controls.target.clone(),
        toTarget: new THREE.Vector3(0, 0, 0),
        resolve,
      };
    });

    const drops: Promise<void>[] = [];
    this.syncBenchSlots();
    for (const figure of this.figures) {
      if (figure.zone !== 'bench') continue;
      const slot = this.benchSlotByUid.get(figure.uid) ?? 0;
      let piece = this.pieces.get(figure.uid);
      if (piece === undefined) {
        piece = this.makePiece(figure, this.nameOf(figure));
        this.pieces.set(figure.uid, piece);
        this.root.add(piece.group);
      }
      const dest = this.figureHome(figure);
      const startY = dest.y + BENCH_DROP_H;
      piece.group.position.set(dest.x, startY, dest.z);
      piece.group.scale.set(1, 1, 1);
      this.lastWorld.set(figure.uid, new THREE.Vector3(dest.x, startY, dest.z));
      this.hops.delete(figure.uid);
      drops.push(
        new Promise<void>((resolve) => {
          this.introDrops.set(figure.uid, {
            uid: figure.uid,
            dest: dest.clone(),
            startY,
            t0: now + slot * BENCH_DROP_STAGGER_MS,
            duration: BENCH_DROP_MS,
            onLand,
            resolve,
            landed: false,
          });
        }),
      );
    }

    return Promise.all([camDone, ...drops]).then(() => {
      this.controls.enabled = true;
    });
  }

  private clearCoinFlip(resolve = true): void {
    const fx = this.coinFlip;
    if (fx === null) return;
    fx.done = true;
    fx.mesh.removeFromParent();
    const mats = fx.mesh.material;
    if (Array.isArray(mats)) {
      for (const mat of mats) {
        if (
          (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) &&
          mat.map !== null
        ) {
          mat.map.dispose();
        }
        mat.dispose();
      }
    }
    fx.mesh.geometry.dispose();
    this.coinFlip = null;
    this.setFiguresHidden(false);
    if (resolve) fx.resolve();
  }

  private setFiguresHidden(hidden: boolean): void {
    for (const piece of this.pieces.values()) {
      piece.group.visible = !hidden;
    }
    for (const mesh of this.plates.values()) {
      mesh.visible = !hidden;
    }
  }

  private updateCoinFlip(): void {
    const fx = this.coinFlip;
    if (fx === null || fx.done) return;
    const elapsed = performance.now() - fx.t0;
    const flipU = Math.min(1, elapsed / Math.max(1, fx.flipMs));
    const e = easeOutCubic(flipU);

    // Spin many times while falling; land with YOU or RIVAL face up.
    fx.mesh.rotation.x = e * fx.endSpinX;
    fx.mesh.rotation.y = e * Math.PI * 2.2;
    fx.mesh.rotation.z = Math.sin(e * Math.PI * 3) * 0.35 * (1 - e);
    const fall = e * e;
    let y = fx.startY + (fx.landY - fx.startY) * fall;
    if (flipU > 0.85) {
      const bounce = Math.sin(((flipU - 0.85) / 0.15) * Math.PI) * 0.18 * (1 - (flipU - 0.85) / 0.15);
      y = fx.landY + bounce;
    }
    fx.mesh.position.set(0, y, 0);

    if (elapsed < fx.flipMs + fx.holdMs) return;

    this.clearCoinFlip(true);
  }

  openPlateHand(): void {
    if (this.handOpen || this.plateRows.length === 0) return;
    this.handOpen = true;
    this.controls.enabled = false;
    this.syncPlates();
    this.onHandChange?.(true);
    this.markDirty();
  }

  collapsePlateHand(): void {
    if (!this.handOpen) return;
    this.handOpen = false;
    this.controls.enabled = true;
    this.syncPlates();
    this.onHandChange?.(false);
    this.markDirty();
  }

  isPlateHandOpen(): boolean {
    return this.handOpen;
  }

  figureWorldPos(uid: number): { x: number; y: number; z: number } | null {
    const piece = this.pieces.get(uid);
    if (piece === undefined) return null;
    const p = piece.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  presentPlateUse(slot: number, target: 'board' | number): Promise<void> {
    const mesh = this.plates.get(slot);
    if (mesh === undefined) return Promise.resolve();
    if (this.plateFx !== null) return Promise.resolve();

    const worldFrom = new THREE.Vector3();
    mesh.getWorldPosition(worldFrom);
    const startSx = mesh.scale.x;
    const startSy = mesh.scale.y;

    this.camera.getWorldDirection(this.handFwd);
    const holdPos = this.camera.position.clone().addScaledVector(this.handFwd, 3.2);
    const holdSx = 1.15;
    const holdSy = holdSx / (512 / 768);

    let to: THREE.Vector3;
    if (target === 'board') {
      to = new THREE.Vector3(0, BOARD_TOP + 0.35, 0);
    } else {
      const piece = this.pieces.get(target);
      to =
        piece !== undefined
          ? piece.group.position.clone().add(new THREE.Vector3(0, 0.35, 0))
          : new THREE.Vector3(0, BOARD_TOP + 0.35, 0);
    }

    this.handOpen = true;
    this.controls.enabled = false;
    this.onHandChange?.(true);
    this.syncPlates();

    return new Promise((resolve) => {
      this.plateFx = {
        slot,
        phase: 'zoom',
        t0: performance.now(),
        from: worldFrom.clone(),
        holdPos,
        to,
        startSx,
        startSy,
        holdSx,
        holdSy,
        resolve,
      };
      this.markDirty();
    });
  }

  setWorldTheme(theme: ArenaTheme): void {
    if (this.worldTheme === theme) return;
    this.worldTheme = theme;
    const day = theme === 'light';
    const bg = day ? 0xe8dcc8 : 0x1a0e0a;
    this.scene.background = new THREE.Color(bg);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(bg);
      this.scene.fog.density = day ? 0.012 : 0.028;
    }
    this.renderer.toneMappingExposure = day ? 1.28 : 1.15;
    for (const child of [...this.root.children]) {
      if (child.userData.asset === 'arena-ground' || child.userData.asset === 'board-slab') {
        this.root.remove(child);
      }
    }
    this.root.add(makeArenaGround(theme), makeBoardSlab(theme));
    const lights = this.lights;
    if (lights !== null) {
      lights.hemi.color.setHex(day ? 0xfff4e8 : 0xffe0c0);
      lights.hemi.groundColor.setHex(day ? 0x8a7a62 : 0x2a1510);
      lights.hemi.intensity = day ? 0.95 : 0.55;
      lights.key.color.setHex(day ? 0xfffaf0 : 0xfff0e0);
      lights.key.intensity = day ? 1.55 : 1.2;
      lights.key.position.set(day ? 4 : 2, day ? 16 : 14, day ? 3 : 6);
      lights.fill.color.setHex(day ? 0x9ec8ff : 0x4da3ff);
      lights.fill.intensity = day ? 0.45 : 0.25;
      lights.rimYou.intensity = day ? 12 : 35;
      lights.rimRival.intensity = day ? 12 : 35;
    }
    const top = themeTopHex(theme);
    for (const piece of this.pieces.values()) {
      piece.baseTopMat.color.setHex(top);
    }
    this.markDirty();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearCoinFlip(true);
    this.controls.removeEventListener('change', this.markDirty);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (!this.visible) return;

    const coinOnly = this.coinFlip !== null;
    const busy = this.isAnimating();
    const camMoved =
      this.lastCamPos.distanceToSquared(this.camera.position) > 1e-8 ||
      this.lastCamTarget.distanceToSquared(this.controls.target) > 1e-8;

    // Idle: skip GPU work. OrbitControls fires `change` → markDirty on input.
    if (!busy && !this.needsRender && !camMoved) return;

    this.updateCamTween();
    this.updateCoinFlip();

    // During the intro coin, skip piece/plate bookkeeping so a loaded board
    // can't stall the flip on low-FPS tablets.
    if (!coinOnly) {
      if (this.coinFlip === null && this.camTween === null) {
        this.controls.update();
      }
      this.pruneHops();
      this.updateIntroDrops();
      if (busy || this.hops.size > 0 || this.introDrops.size > 0) {
        this.syncPiecePositions();
      }
      this.updatePlateFx();
      if (this.handOpen || this.plateFx !== null || !this.platesSettled) {
        this.layoutPlates();
      }

      const billboard = camMoved || busy || this.needsRender;
      if (billboard) {
        for (const piece of this.pieces.values()) {
          piece.art.lookAt(this.camera.position);
          const plane = piece.group.userData.statusPlane as THREE.Mesh | undefined;
          if (plane !== undefined) plane.quaternion.copy(this.camera.quaternion);
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.lastCamPos.copy(this.camera.position);
    this.lastCamTarget.copy(this.controls.target);
    if (camMoved || busy) this.hitLayoutDirty = true;
    this.needsRender = this.isAnimating();
  };

  private updateCamTween(): void {
    const tween = this.camTween;
    if (tween === null) return;
    const u = Math.min(1, (performance.now() - tween.t0) / Math.max(1, tween.dur));
    const e = easeOutCubic(u);
    this.camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    this.camera.lookAt(this.controls.target);
    if (u >= 1) {
      this.camera.position.copy(tween.toPos);
      this.controls.target.copy(tween.toTarget);
      this.camTween = null;
      this.controls.update();
      tween.resolve();
    }
  }

  private updateIntroDrops(): void {
    const now = performance.now();
    for (const [uid, drop] of [...this.introDrops]) {
      const piece = this.pieces.get(uid);
      if (piece === undefined) {
        drop.resolve();
        this.introDrops.delete(uid);
        continue;
      }
      if (now < drop.t0) {
        piece.group.position.set(drop.dest.x, drop.startY, drop.dest.z);
        piece.group.scale.set(1, 1, 1);
        continue;
      }
      const u = Math.min(1, (now - drop.t0) / Math.max(1, drop.duration));
      const ease = u * u;
      const y = drop.startY + (drop.dest.y - drop.startY) * ease;
      piece.group.position.set(drop.dest.x, y, drop.dest.z);
      const stretch = 1 + Math.sin(Math.PI * u) * 0.08;
      const squash = u > 0.85 ? 1 - (u - 0.85) * 0.35 : 1;
      piece.group.scale.set(1 / stretch, stretch * squash, 1 / stretch);
      if (u >= 1) {
        piece.group.position.copy(drop.dest);
        piece.group.scale.set(1, 1, 1);
        this.lastWorld.set(uid, drop.dest.clone());
        if (!drop.landed) {
          drop.landed = true;
          drop.onLand?.();
        }
        this.introDrops.delete(uid);
        drop.resolve();
      }
    }
  }

  private nearZ(owner: 0 | 1): boolean {
    const you = this.flip ? 1 : 0;
    return owner === you;
  }

  private benchLayout(owner: 0 | 1): { zNear: number; zFar: number; xs: { front: number[]; back: number[] }; mirror: number } {
    const d = 0.88;
    const row = d * Math.sqrt(3) * 0.5;
    const near = this.nearZ(owner);
    const zNear = near ? 3.85 : -3.85;
    const zFar = near ? zNear + row : zNear - row;
    const mirror = near ? 1 : -1;
    const front = [-d, 0, d].map((x) => x * mirror);
    const back = [-d * 0.5, d * 0.5, d * 1.5].map((x) => x * mirror);
    const mid = [...front, ...back].reduce((a, b) => a + b, 0) / 6;
    const xShift = -1.05 * mirror;
    return {
      zNear,
      zFar,
      xs: { front: front.map((x) => x - mid + xShift), back: back.map((x) => x - mid + xShift) },
      mirror,
    };
  }

  private benchSlots(owner: 0 | 1): THREE.Vector3[] {
    const { zNear, zFar, xs } = this.benchLayout(owner);
    return [
      ...xs.front.map((x) => new THREE.Vector3(x, FLOOR_Y, zNear)),
      ...xs.back.map((x) => new THREE.Vector3(x, FLOOR_Y, zFar)),
    ];
  }

  /** Keep each bench figure on its pad; never compact when another deploys. */
  private syncBenchSlots(): void {
    const onBench = new Set<number>();
    for (const figure of this.figures) {
      if (figure.zone === 'bench') onBench.add(figure.uid);
    }
    for (const uid of [...this.benchSlotByUid.keys()]) {
      if (!onBench.has(uid)) this.benchSlotByUid.delete(uid);
    }
    for (const owner of [0, 1] as const) {
      const capacity = Math.max(1, this.benchSlots(owner).length);
      const used = new Set<number>();
      for (const figure of this.figures) {
        if (figure.zone !== 'bench' || figure.owner !== owner) continue;
        const slot = this.benchSlotByUid.get(figure.uid);
        if (slot !== undefined) used.add(slot);
      }
      const needing = this.figures
        .filter((figure) => figure.zone === 'bench' && figure.owner === owner && !this.benchSlotByUid.has(figure.uid))
        .sort((a, b) => a.uid - b.uid);
      for (const figure of needing) {
        let slot = 0;
        while (slot < capacity && used.has(slot)) slot += 1;
        if (slot >= capacity) slot = capacity - 1;
        used.add(slot);
        this.benchSlotByUid.set(figure.uid, slot);
      }
    }
  }

  private pcSlots(owner: 0 | 1): THREE.Vector3[] {
    const { zFar, mirror } = this.benchLayout(owner);
    const gap = 0.75;
    const boardEnd = 2.6;
    const padHalf = gap / 2 + 0.48;
    const xCenter = mirror * (boardEnd - padHalf);
    return [
      new THREE.Vector3(xCenter - mirror * (gap / 2), FLOOR_Y, zFar),
      new THREE.Vector3(xCenter + mirror * (gap / 2), FLOOR_Y, zFar),
    ];
  }

  /** Floor stack tucked beside P.C., clear of bench figure tubes (WebGL MatchHud). */
  private plateAnchor(): { x: number; z: number; mirror: number } {
    const you = this.flip ? 1 : 0;
    const { zNear, xs, mirror } = this.benchLayout(you);
    const rightEdge = Math.max(...xs.front, ...xs.back);
    const pc = this.pcSlots(you)[0];
    const pcX = pc?.x ?? mirror * 2.2;
    const figureClear = rightEdge + mirror * 0.5;
    const nearPc = pcX - mirror * 0.42;
    const x = mirror > 0 ? Math.max(figureClear, nearPc) : Math.min(figureClear, nearPc);
    return { x, z: zNear, mirror };
  }

  private buildBenches(): void {
    for (const owner of [0, 1] as const) {
      for (const pos of this.benchSlots(owner)) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.28, 0.34, 28),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pos.x, FLOOR_Y + 0.002, pos.z);
        this.root.add(ring);
      }
      const pc = this.pcSlots(owner);
      for (const pos of pc) {
        const puck = new THREE.Mesh(new THREE.CylinderGeometry(NODE_RADIUS, NODE_RADIUS, PUCK_H, 28), this.routeMat);
        puck.position.set(pos.x, FLOOR_PUCK_Y, pos.z);
        this.root.add(puck);
      }
      const a = pc[0];
      const b = pc[1];
      if (a !== undefined && b !== undefined) this.root.add(this.makeBar(a, b, FLOOR_PUCK_Y, ROUTE_SIDE, this.routeMat));
    }
  }

  private makeTimer(z: number): TimerTube {
    const length = 5.2;
    const root = new THREE.Group();
    root.position.set(0, FLOOR_Y + TIMER_R, z);
    const wall = new THREE.MeshStandardMaterial({
      color: 0xf2f7fc,
      transparent: true,
      opacity: 0.1,
      roughness: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(TIMER_R, TIMER_R, length, 36, 1, true), wall);
    outer.rotation.z = Math.PI / 2;
    const fill = new THREE.Mesh(
      new THREE.CylinderGeometry(TIMER_R * 0.62, TIMER_R * 0.62, 1, 28),
      new THREE.MeshStandardMaterial({
        color: 0xffe082,
        emissive: 0xffab00,
        emissiveIntensity: 2.4,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      }),
    );
    fill.rotation.z = Math.PI / 2;
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(TIMER_R * 0.88, TIMER_R * 0.88, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false }),
    );
    glow.rotation.z = Math.PI / 2;
    root.add(outer, fill, glow);
    return { root, fill, glow, length };
  }

  private syncTimers(): void {
    if (this.timers === null) return;
    const you = this.flip ? 1 : 0;
    const rival = you === 0 ? 1 : 0;
    this.paintTimer(this.timers.you, this.clocks[you] ?? CLOCK_MS, this.turnPlayer === you);
    this.paintTimer(this.timers.rival, this.clocks[rival] ?? CLOCK_MS, this.turnPlayer === rival);
  }

  private paintTimer(tube: TimerTube, remain: number, on: boolean): void {
    const f = Math.max(0, Math.min(1, remain / CLOCK_MS));
    const len = tube.length * f;
    tube.fill.scale.set(1, Math.max(0.001, len), 1);
    tube.glow.scale.set(1, Math.max(0.001, len), 1);
    const x = -tube.length / 2 + len / 2;
    tube.fill.position.x = x;
    tube.glow.position.x = x;
    const urgent = f <= 30 / 300;
    const fillMat = tube.fill.material as THREE.MeshStandardMaterial;
    const glowMat = tube.glow.material as THREE.MeshBasicMaterial;
    if (on) {
      fillMat.color.setHex(urgent ? 0xff8a80 : 0xffe082);
      fillMat.emissive.setHex(urgent ? 0xff1744 : 0xffab00);
      fillMat.emissiveIntensity = urgent ? 3.2 : 2.4;
      glowMat.color.setHex(urgent ? 0xff5252 : 0xffc107);
      glowMat.opacity = urgent ? 0.55 : 0.45;
    } else {
      fillMat.color.setHex(urgent ? 0xc62828 : 0xc4b08a);
      fillMat.emissive.setHex(urgent ? 0x8b0000 : 0x6d5c3a);
      fillMat.emissiveIntensity = urgent ? 0.8 : 0.35;
      glowMat.opacity = 0.16;
    }
  }

  private rebuildGraph(board: BoardGraph): void {
    this.board = board;
    this.clearPathHighlights();
    this.boardRoutes.length = 0;
    this.goalArrows.clear();
    for (const mesh of this.nodeHits.values()) mesh.removeFromParent();
    for (const mesh of this.nodePucks.values()) mesh.parent?.remove(mesh);
    this.nodeHits.clear();
    this.nodePucks.clear();
    this.nodeById.clear();
    for (const child of [...this.root.children]) {
      if (child.userData.route === true || child.userData.nodeDecor === true) this.root.remove(child);
    }
    for (const node of board.nodes) this.nodeById.set(node.id, node);
    const seen = new Set<string>();
    for (const [a, b] of board.edges) {
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const na = board.byId.get(a);
      const nb = board.byId.get(b);
      if (na === undefined || nb === undefined) continue;
      let pa = worldOfNode(na, this.flip);
      let pb = worldOfNode(nb, this.flip);
      let wa = new THREE.Vector3(pa.x, 0, pa.z);
      let wb = new THREE.Vector3(pb.x, 0, pb.z);
      if (na.kind === 'goal') {
        const youGoal = (na.owner === 0) !== this.flip;
        wa = this.goalLineAttach(wa, wb, youGoal ? 1 : -1);
      }
      if (nb.kind === 'goal') {
        const youGoal = (nb.owner === 0) !== this.flip;
        wb = this.goalLineAttach(wb, wa, youGoal ? 1 : -1);
      }
      const bar = this.makeBar(wa, wb, ROUTE_Y, ROUTE_SIDE, this.routeMat, true);
      bar.userData.edgeKey = key;
      this.boardRoutes.push(bar);
      this.root.add(bar);
    }
    for (const node of board.nodes) {
      const pos = worldOfNode(node, this.flip);
      if (node.kind === 'goal') {
        const youGoal = (node.owner === 0) !== this.flip;
        const color = youGoal ? 0x1565c0 : 0xb71c1c;
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(0.26, 32),
          new THREE.MeshLambertMaterial({
            color,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(pos.x, BOARD_TOP + 0.002, pos.z);
        fill.userData.nodeDecor = true;
        this.root.add(fill);
        const ring = this.makeSquareRing(0.31);
        ring.position.x = pos.x;
        ring.position.z = pos.z;
        ring.userData.nodeDecor = true;
        this.root.add(ring);
        const arrow = this.makeGoalArrow();
        arrow.position.set(pos.x, 0, pos.z);
        if (!youGoal) arrow.rotation.y = Math.PI;
        arrow.userData.nodeDecor = true;
        arrow.userData.nodeId = node.id;
        this.goalArrows.set(node.id, arrow);
        this.root.add(arrow);
      } else {
        const puck = new THREE.Mesh(
          new THREE.CylinderGeometry(NODE_RADIUS, NODE_RADIUS, PUCK_H, 32),
          this.routeMat,
        );
        puck.position.set(pos.x, ROUTE_Y, pos.z);
        puck.castShadow = this.perf.shadows;
        puck.userData.nodeId = node.id;
        this.nodePucks.set(node.id, puck);
        this.root.add(puck);
        if (node.kind === 'entry') {
          const ring = this.makeSquareRing(0.22);
          ring.position.x = pos.x;
          ring.position.z = pos.z;
          ring.userData.route = true;
          this.root.add(ring);
        }
      }
      const hit = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.set(pos.x, ROUTE_Y, pos.z);
      hit.userData.nodeId = node.id;
      this.nodeHits.set(node.id, hit);
      this.root.add(hit);
    }
  }

  /** Path meets the outline triangle: tip or base midpoint. */
  private goalLineAttach(goal: THREE.Vector3, other: THREE.Vector3, dirSign: 1 | -1): THREE.Vector3 {
    const tipX = dirSign * GOAL_ARROW_S;
    const baseX = dirSign * (-GOAL_ARROW_S / 2);
    const towardOther = Math.sign(other.x - goal.x) || 1;
    if (towardOther === dirSign) {
      return goal.clone().add(new THREE.Vector3(tipX, 0, 0));
    }
    return goal.clone().add(new THREE.Vector3(baseX, 0, 0));
  }

  private makeBar(
    a: THREE.Vector3,
    b: THREE.Vector3,
    y: number,
    width: number,
    mat: THREE.Material,
    route = false,
  ): THREE.Mesh {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, PUCK_H, Math.max(0.01, Math.hypot(dx, dz))), mat);
    mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    mesh.rotation.y = Math.atan2(dx, dz);
    if (route) mesh.userData.route = true;
    return mesh;
  }

  /** Square-tube ring — same bar profile as path lines. */
  private makeSquareRing(radius: number): THREE.Mesh {
    const hw = ROUTE_SIDE / 2;
    const hh = PUCK_H / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();
    const segs = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
    }
    const path = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.ExtrudeGeometry(shape, {
      steps: segs,
      bevelEnabled: false,
      extrudePath: path,
    });
    const mesh = new THREE.Mesh(geo, this.routeMat);
    mesh.position.y = ROUTE_Y;
    return mesh;
  }

  /** Outline triangle: path bars + cube joints for sharp corners. */
  private makeGoalArrow(): THREE.Group {
    const s = GOAL_ARROW_S;
    const hy = (s * Math.sqrt(3)) / 2;
    const tip = new THREE.Vector3(s, ROUTE_Y, 0);
    const b0 = new THREE.Vector3(-s / 2, ROUTE_Y, hy);
    const b1 = new THREE.Vector3(-s / 2, ROUTE_Y, -hy);
    const g = new THREE.Group();
    g.add(this.makeBar(tip, b0, ROUTE_Y, ROUTE_SIDE, this.routeMat, true));
    g.add(this.makeBar(tip, b1, ROUTE_Y, ROUTE_SIDE, this.routeMat, true));
    g.add(this.makeBar(b0, b1, ROUTE_Y, ROUTE_SIDE, this.routeMat, true));
    for (const p of [tip, b0, b1]) {
      const joint = new THREE.Mesh(new THREE.BoxGeometry(ROUTE_SIDE, PUCK_H, ROUTE_SIDE), this.routeMat);
      joint.position.copy(p);
      joint.userData.route = true;
      g.add(joint);
    }
    return g;
  }

  private syncPucks(): void {
    const marks = this.highlights;
    for (const [id, puck] of this.nodePucks) {
      const node = this.nodeById.get(id);
      if (node !== undefined) {
        const w = worldOfNode(node, this.flip);
        puck.position.set(w.x, ROUTE_Y, w.z);
        this.nodeHits.get(id)?.position.set(w.x, ROUTE_Y, w.z);
      }
      if (marks?.selectedNode === id) {
        puck.material = this.selectMat;
        puck.scale.setScalar(1.35);
      } else if (marks?.battleNodes.has(id) === true) {
        puck.material = this.battleMat;
        puck.scale.setScalar(1.45);
      } else if (marks?.reachable.has(id) === true) {
        puck.material = this.reachMat;
        puck.scale.setScalar(1.3);
      } else if (this.pathNodeIds.has(id)) {
        puck.material = this.reachMat;
        puck.scale.setScalar(1.18);
      } else {
        const pathActive = this.pathNodeIds.size > 0;
        puck.material = pathActive ? this.dimRouteMat : this.routeMat;
        puck.scale.setScalar(1);
      }
    }
    this.syncGoalArrows();
  }

  private syncGoalArrows(): void {
    const marks = this.highlights;
    const pathActive = this.pathNodeIds.size > 0;
    for (const [id, arrow] of this.goalArrows) {
      const reachable = marks?.reachable.has(id) === true;
      const mat = reachable ? this.reachMat : pathActive ? this.dimRouteMat : this.routeMat;
      arrow.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.material = mat;
      });
    }
  }

  private clearPathHighlights(): void {
    while (this.pathHighlight.children.length > 0) {
      const child = this.pathHighlight.children[0]!;
      this.pathHighlight.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.pathNodeIds = new Set();
  }

  private syncPathHighlights(): void {
    this.clearPathHighlights();
    const legal = [...(this.highlights?.reachable ?? [])];
    if (legal.length === 0) {
      this.syncRouteDim(null);
      return;
    }
    const { nodeIds, edges } = this.legalPathGraph(legal);
    this.pathNodeIds = nodeIds;
    const edgeKeys = new Set(edges.map(([a, b]) => edgeKey(a, b)));
    this.syncRouteDim(edgeKeys);
    for (const [a, b] of edges) {
      const bar = this.makeHighlightRoute(a, b);
      if (bar !== null) this.pathHighlight.add(bar);
    }
  }

  private syncRouteDim(pathEdges: Set<string> | null): void {
    const active = pathEdges !== null && pathEdges.size > 0;
    for (const mesh of this.boardRoutes) {
      const key = mesh.userData.edgeKey as string;
      const onPath = active && pathEdges.has(key);
      mesh.material = !active || onPath ? this.routeMat : this.dimRouteMat;
    }
  }

  /** Shortest-path nodes + corridor edges for the current reachable set. */
  private legalPathGraph(legal: readonly string[]): {
    nodeIds: Set<string>;
    edges: [string, string][];
  } {
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    const edges: [string, string][] = [];
    const board = this.board;
    const marks = this.highlights;

    const addPath = (path: readonly string[] | null): void => {
      if (path === null || path.length === 0) return;
      for (const id of path) nodeIds.add(id);
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const key = edgeKey(a, b);
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push([a, b]);
      }
    };

    if (board === null || marks?.selectedUid === null || marks === null) {
      for (const id of legal) nodeIds.add(id);
      return { nodeIds, edges };
    }

    const figure = this.figures.find((item) => item.uid === marks.selectedUid);
    if (figure === undefined) {
      for (const id of legal) nodeIds.add(id);
      return { nodeIds, edges };
    }

    const occupied = new Set<NodeId>();
    for (const item of this.figures) {
      if (item.zone !== 'field' || item.node === null || item.uid === figure.uid) continue;
      occupied.add(item.node);
    }

    if (figure.zone === 'field' && figure.node !== null) {
      for (const goal of legal) {
        if (goal === figure.node) {
          addPath([figure.node]);
          continue;
        }
        const steps = mpPath(board, figure.node, goal as NodeId, PATH_MP_BUDGET, occupied, OPEN_MOVEMENT);
        if (steps.length > 0) addPath([figure.node, ...steps]);
      }
    } else if (figure.zone === 'bench') {
      const entries = board.nodes
        .filter((node) => node.kind === 'entry' && node.owner === figure.owner)
        .map((node) => node.id);
      for (const goal of legal) {
        if (entries.includes(goal as NodeId)) {
          addPath([goal]);
          continue;
        }
        let best: NodeId[] | null = null;
        for (const entry of entries) {
          const steps = mpPath(board, entry, goal as NodeId, PATH_MP_BUDGET, occupied, OPEN_MOVEMENT);
          if (steps.length === 0) continue;
          const full = [entry, ...steps];
          if (best === null || full.length < best.length) best = full;
        }
        addPath(best);
      }
    } else {
      for (const id of legal) nodeIds.add(id);
    }
    return { nodeIds, edges };
  }

  private makeHighlightRoute(aId: string, bId: string): THREE.Mesh | null {
    const board = this.board;
    if (board === null) return null;
    const na = board.byId.get(aId as NodeId);
    const nb = board.byId.get(bId as NodeId);
    if (na === undefined || nb === undefined) return null;
    let pa = worldOfNode(na, this.flip);
    let pb = worldOfNode(nb, this.flip);
    let wa = new THREE.Vector3(pa.x, 0, pa.z);
    let wb = new THREE.Vector3(pb.x, 0, pb.z);
    if (na.kind === 'goal') {
      const youGoal = (na.owner === 0) !== this.flip;
      wa = this.goalLineAttach(wa, wb, youGoal ? 1 : -1);
    }
    if (nb.kind === 'goal') {
      const youGoal = (nb.owner === 0) !== this.flip;
      wb = this.goalLineAttach(wb, wa, youGoal ? 1 : -1);
    }
    const mesh = this.makeBar(wa, wb, ROUTE_Y + HIGHLIGHT_Y_BIAS, PATH_HIGHLIGHT_SIDE, this.pathBarMat);
    mesh.renderOrder = 2;
    return mesh;
  }

  private figureHome(figure: FigureState): THREE.Vector3 {
    if (figure.zone === 'field' && figure.node !== null) {
      const node = this.nodeById.get(figure.node);
      if (node !== undefined) {
        const w = worldOfNode(node, this.flip);
        return new THREE.Vector3(w.x, BOARD_TOP, w.z);
      }
    }
    if (figure.zone === 'pc') {
      const slots = this.pcSlots(figure.owner);
      const peers = this.figures
        .filter((item) => item.owner === figure.owner && item.zone === 'pc')
        .sort((a, b) => (a.pcOrder ?? 0) - (b.pcOrder ?? 0));
      const i = Math.max(0, peers.findIndex((item) => item.uid === figure.uid));
      return (slots[Math.min(i, slots.length - 1)] ?? slots[0] ?? new THREE.Vector3()).clone();
    }
    const slots = this.benchSlots(figure.owner);
    const i = this.benchSlotByUid.get(figure.uid) ?? 0;
    return (slots[Math.min(i, slots.length - 1)] ?? slots[0] ?? new THREE.Vector3()).clone();
  }

  private syncPiecePositions(): void {
    for (const figure of this.figures) {
      if (figure.zone === 'excluded' || figure.zone === 'ultraSpace') continue;
      const piece = this.pieces.get(figure.uid);
      if (piece === undefined) continue;
      const pos = this.figureWorld(figure);
      piece.group.position.copy(pos);
      // Only commit settled poses — mid-hop lastWorld caused restart glitches.
      if (!this.hops.has(figure.uid) && !this.introDrops.has(figure.uid) && !this.benchesHeldHigh) {
        this.lastWorld.set(figure.uid, pos.clone());
      }
    }
  }

  private syncPieces(): void {
    const live = new Set<number>();
    this.pieceHits.length = 0;
    for (const figure of this.figures) {
      if (figure.zone === 'excluded' || figure.zone === 'ultraSpace') continue;
      live.add(figure.uid);
      let piece = this.pieces.get(figure.uid);
      const name = this.nameOf(figure);
      if (piece === undefined) {
        piece = this.makePiece(figure, name);
        this.pieces.set(figure.uid, piece);
        this.root.add(piece.group);
        const home = this.figureHome(figure);
        piece.group.position.copy(home);
        this.lastWorld.set(figure.uid, home.clone());
      }
      this.applyPieceArt(piece, figure, name);
      if (figure.wait !== piece.wait) {
        piece.wait = figure.wait;
        const face = piece.group.userData.badgeFace as THREE.Mesh | undefined;
        if (face !== undefined) {
          const mat = face.material as THREE.MeshBasicMaterial;
          mat.map =
            figure.wait > 0
              ? createWaitBadgeTexture(figure.wait)
              : createMpBadgeTexture(this.mpOf(figure), figure.owner === 0 ? '#1565c0' : '#b71c1c');
          mat.needsUpdate = true;
        }
      }
      const statuses = figure.condition === null ? [] : [figure.condition];
      const plane = piece.group.userData.statusPlane as THREE.Mesh | undefined;
      if (plane !== undefined && piece.group.userData.statusKey !== statuses.join(',')) {
        piece.group.userData.statusKey = statuses.join(',');
        const mat = plane.material as THREE.MeshBasicMaterial;
        mat.map = statuses.length === 0 ? null : createStatusIconsTexture(statuses);
        mat.opacity = statuses.length === 0 ? 0 : 1;
        mat.needsUpdate = true;
      }
      if (plane !== undefined) plane.quaternion.copy(this.camera.quaternion);
      const ring = piece.group.userData.selectRing as THREE.Mesh | undefined;
      if (ring !== undefined) ring.visible = this.highlights?.selectedUid === figure.uid;
      // Keep mesh where the hop / intro drop left it — never snap mid-flight.
      if (!this.hops.has(figure.uid) && !this.introDrops.has(figure.uid) && !this.benchesHeldHigh) {
        this.ensureHomeHop(figure);
        if (!this.hops.has(figure.uid)) {
          const home = this.figureHome(figure);
          piece.group.position.copy(home);
          this.lastWorld.set(figure.uid, home.clone());
        }
      }
      if (this.benchesHeldHigh && figure.zone === 'bench' && !this.introDrops.has(figure.uid)) {
        const home = this.figureHome(figure);
        const held = new THREE.Vector3(home.x, home.y + BENCH_DROP_H, home.z);
        piece.group.position.copy(held);
        this.lastWorld.set(figure.uid, held.clone());
      }
      this.pieceHits.push(piece.group);
    }
    for (const [uid, piece] of this.pieces) {
      if (live.has(uid)) continue;
      piece.group.removeFromParent();
      this.pieces.delete(uid);
      this.lastWorld.delete(uid);
      this.hops.delete(uid);
      this.introDrops.delete(uid);
    }
  }

  private ensureHomeHop(figure: FigureState): void {
    if (this.hops.has(figure.uid) || this.introDrops.has(figure.uid)) return;
    const home = this.figureHome(figure);
    const last = this.lastWorld.get(figure.uid);
    if (last === undefined) {
      this.lastWorld.set(figure.uid, home.clone());
      return;
    }
    const dist = Math.hypot(last.x - home.x, last.y - home.y, last.z - home.z);
    if (dist < 0.05) {
      this.lastWorld.set(figure.uid, home.clone());
      return;
    }
    const hops = Math.max(1, Math.round(dist / 1.1));
    this.hops.set(figure.uid, {
      uid: figure.uid,
      points: [
        { x: last.x, y: last.y, z: last.z },
        { x: home.x, y: home.y, z: home.z },
      ],
      started: performance.now(),
      duration: Math.min(720, Math.max(240, hops * 200)),
    });
  }

  private pruneHops(): void {
    const now = performance.now();
    for (const [uid, hop] of this.hops) {
      if (now - hop.started < hop.duration) continue;
      const end = hop.points[hop.points.length - 1]!;
      this.lastWorld.set(uid, new THREE.Vector3(end.x, end.y, end.z));
      const piece = this.pieces.get(uid);
      if (piece !== undefined) piece.group.position.set(end.x, end.y, end.z);
      this.hops.delete(uid);
    }
  }

  private figureWorld(figure: FigureState): THREE.Vector3 {
    const drop = this.introDrops.get(figure.uid);
    if (drop !== undefined) {
      const now = performance.now();
      if (now < drop.t0) return new THREE.Vector3(drop.dest.x, drop.startY, drop.dest.z);
      const u = Math.min(1, (now - drop.t0) / Math.max(1, drop.duration));
      const ease = u * u;
      return new THREE.Vector3(drop.dest.x, drop.startY + (drop.dest.y - drop.startY) * ease, drop.dest.z);
    }
    if (this.benchesHeldHigh && figure.zone === 'bench') {
      const home = this.figureHome(figure);
      return new THREE.Vector3(home.x, home.y + BENCH_DROP_H, home.z);
    }
    const hop = this.hops.get(figure.uid);
    if (hop !== undefined && hop.points.length >= 2) {
      const pts = hop.points;
      const hops = pts.length - 1;
      const elapsed = performance.now() - hop.started;
      if (elapsed <= 0) {
        const p = pts[0]!;
        return new THREE.Vector3(p.x, p.y, p.z);
      }
      const t = Math.min(1, Math.max(0, elapsed / Math.max(1, hop.duration)));
      const x = t * hops;
      const index = Math.min(hops - 1, Math.floor(x));
      const local = easeInOutCubic(x - index);
      const a = pts[index]!;
      const b = pts[index + 1] ?? a;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      const vert = Math.abs(b.y - a.y);
      // Low natural arc; mute it when the path already rises/falls a lot (bench/PC).
      const arc =
        vert > 0.35 ? Math.min(0.08, horiz * 0.05) : Math.min(0.2, 0.06 + horiz * 0.1);
      const lift = Math.sin(local * Math.PI) * arc;
      return new THREE.Vector3(
        a.x + (b.x - a.x) * local,
        a.y + (b.y - a.y) * local + lift,
        a.z + (b.z - a.z) * local,
      );
    }
    return this.figureHome(figure);
  }

  private updatePlateFx(): void {
    const fx = this.plateFx;
    if (fx === null) return;
    const mesh = this.plates.get(fx.slot);
    if (mesh === undefined) {
      fx.resolve();
      this.plateFx = null;
      this.collapsePlateHand();
      return;
    }
    const now = performance.now();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.depthTest = false;
    mat.depthWrite = false;
    mesh.renderOrder = 200;

    if (fx.phase === 'zoom') {
      const u = Math.min(1, (now - fx.t0) / 280);
      const e = 1 - (1 - u) ** 3;
      mesh.position.lerpVectors(fx.from, fx.holdPos, e);
      mesh.scale.x = fx.startSx + (fx.holdSx - fx.startSx) * e;
      mesh.scale.y = fx.startSy + (fx.holdSy - fx.startSy) * e;
      mesh.quaternion.slerp(this.camera.quaternion, 0.35);
      mat.opacity = 1;
      if (u >= 1) {
        fx.phase = 'hold';
        fx.t0 = now;
      }
      return;
    }

    if (fx.phase === 'hold') {
      mesh.position.copy(fx.holdPos);
      mesh.scale.set(fx.holdSx, fx.holdSy, 1);
      mesh.quaternion.copy(this.camera.quaternion);
      mat.opacity = 1;
      if (now - fx.t0 >= 900) {
        fx.phase = 'throw';
        fx.t0 = now;
        this.collapsePlateHand();
      }
      return;
    }

    // throw
    const u = Math.min(1, (now - fx.t0) / 560);
    const e = 1 - (1 - u) ** 3;
    mesh.position.lerpVectors(fx.holdPos, fx.to, e);
    mesh.position.y += Math.sin(e * Math.PI) * 1.15;
    mesh.scale.x = Math.max(0.04, fx.holdSx * (1 - e * 0.92));
    mesh.scale.y = Math.max(0.04, fx.holdSy * (1 - e * 0.92));
    mesh.rotateZ(0.14);
    mat.opacity = 1 - e * 0.85;
    if (u >= 1) {
      mat.opacity = 0.4;
      mat.depthTest = true;
      mat.depthWrite = true;
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      this.plateFx = null;
      fx.resolve();
    }
  }

  private makePiece(figure: FigureState, name: string): PieceMesh {
    const g = new THREE.Group();
    const you = this.flip ? 1 : 0;
    const mine = figure.owner === you;
    const team = mine ? 0x1565c0 : 0xb71c1c;
    const teamCss = mine ? YOU_HEX : RIVAL_HEX;
    const orbCol = pokemonColor(name);
    g.userData.pieceUid = figure.uid;

    const baseTopMat = new THREE.MeshStandardMaterial({
      color: themeTopHex(this.worldTheme),
      metalness: 0.25,
      roughness: 0.55,
    });
    const baseSideMat = new THREE.MeshStandardMaterial({
      color: team,
      metalness: 0.45,
      roughness: 0.38,
      emissive: team,
      emissiveIntensity: 0.18,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.16, 48), [
      baseSideMat,
      baseTopMat,
      baseSideMat,
    ]);
    base.position.y = 0.08;
    base.castShadow = this.perf.shadows;
    g.add(base);

    const selectRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.016, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0xffe66d,
        emissive: 0xffc107,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.88,
      }),
    );
    selectRing.rotation.x = Math.PI / 2;
    selectRing.position.y = 0.02;
    selectRing.visible = false;
    g.userData.selectRing = selectRing;
    g.add(selectRing);

    const nameBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.341, 0.361, 0.144, 48, 1, true),
      new THREE.MeshStandardMaterial({
        map: createNameBandTexture(name),
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    nameBand.position.y = 0.08;
    nameBand.rotation.y = Math.PI;
    g.add(nameBand);

    const tubeR = 0.34;
    const tubeH = 0.3;
    // Full clearcoat on desktop; lit standard glass on tablets (still smooth, far cheaper).
    const glass = this.perf.lite
      ? new THREE.MeshStandardMaterial({
          color: orbGlassColor(orbCol),
          emissive: orbCol,
          emissiveIntensity: 0.12,
          metalness: 0.15,
          roughness: 0.12,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial({
          color: orbGlassColor(orbCol),
          emissive: orbCol,
          emissiveIntensity: 0.08,
          metalness: 0.05,
          roughness: 0.06,
          transparent: true,
          opacity: 0.28,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          side: THREE.DoubleSide,
        });
    const orbRoot = new THREE.Group();
    orbRoot.position.y = 0.2;
    const orbSegs = 48;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, tubeH, orbSegs, 1, true), glass);
    body.position.y = tubeH / 2;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(tubeR, orbSegs, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      glass,
    );
    dome.position.y = tubeH;
    const artMat = new THREE.MeshBasicMaterial({
      map: createPlaceholderOrbTexture(orbCol),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const art = new THREE.Mesh(new THREE.CircleGeometry(tubeR * 0.78, 48), artMat);
    art.position.y = tubeH * 0.48;
    orbRoot.add(body, dome, art);
    g.add(orbRoot);

    const badge = new THREE.Group();
    badge.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.048, 28),
        new THREE.MeshStandardMaterial({ color: team, metalness: 0.35, roughness: 0.4 }),
      ),
    );
    const badgeFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.086, 32),
      new THREE.MeshBasicMaterial({
        map: createMpBadgeTexture(this.mpOf(figure), teamCss),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    badgeFace.rotation.x = -Math.PI / 2;
    badgeFace.position.y = 0.025;
    badge.add(badgeFace);
    badge.position.set(0, 0.22, 0.28);
    badge.rotation.x = 0.55;
    g.userData.badgeFace = badgeFace;
    g.add(badge);

    const statusPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.14),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    statusPlane.position.set(0, 0.95, 0);
    g.userData.statusPlane = statusPlane;
    g.userData.statusKey = '';
    g.add(statusPlane);

    return { group: g, artMat, art, baseTopMat, name, artKey: null, orbPending: null, wait: 0 };
  }

  private applyPieceArt(piece: PieceMesh, figure: FigureState, name: string): void {
    const url = this.spriteUrlOf(figure);
    if (url !== null) {
      const img = getSpriteImage(url);
      if (img !== null) {
        if (piece.artKey === url) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        piece.artMat.map = tex;
        piece.artMat.needsUpdate = true;
        piece.artKey = url;
        return;
      }
    }
    const orbKey = `orb:${name}|${url ?? ''}`;
    if (piece.artKey === orbKey || piece.orbPending === orbKey) return;
    piece.orbPending = orbKey;
    void getPokemonOrbTexture(name, undefined, url).then((tex) => {
      if (piece.artKey !== null && !piece.artKey.startsWith('orb:')) return;
      piece.artMat.map = tex;
      piece.artMat.needsUpdate = true;
      piece.artKey = orbKey;
    });
  }

  private syncPlates(): void {
    this.plateHits.length = 0;
    const live = new Set<number>();
    for (const row of this.plateRows) {
      live.add(row.slot);
      let mesh = this.plates.get(row.slot);
      const disabled = !row.playable && !row.used;
      const detailed = this.handOpen;
      const texKey = `${row.name}|${row.cost}|${row.rarity}|${row.used ? 1 : 0}|${disabled ? 1 : 0}|${detailed ? 1 : 0}`;
      if (mesh === undefined) {
        const mat = new THREE.MeshBasicMaterial({
          map: createPlateCardTexture(row.name, row.cost, row.rarity, row.used, row.effect, detailed, disabled),
          transparent: true,
          alphaTest: 0.08,
          side: THREE.DoubleSide,
          depthWrite: true,
        });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        mesh.userData.plateSlot = row.slot;
        mesh.userData.texKey = texKey;
        this.plates.set(row.slot, mesh);
        this.root.add(mesh);
      } else if (mesh.userData.texKey !== texKey) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = createPlateCardTexture(row.name, row.cost, row.rarity, row.used, row.effect, detailed, disabled);
        mat.needsUpdate = true;
        mesh.userData.texKey = texKey;
      }
      this.plateHits.push(mesh);
    }
    for (const [slot, mesh] of this.plates) {
      if (live.has(slot)) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.removeFromParent();
      this.plates.delete(slot);
    }
    this.layoutPlates(true);
  }

  private fitHandInHud(): {
    cardW: number;
    cardH: number;
    gapX: number;
    gapY: number;
    originX: number;
    originY: number;
    centerY: number;
  } {
    const gapX = HAND_GAP_X;
    const gapY = HAND_GAP_Y;
    const size = this.renderer.getSize(new THREE.Vector2());
    const vw = Math.max(1, size.x);
    const vh = Math.max(1, size.y);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const halfH = Math.tan(vFov / 2) * HAND_CAM_DIST;
    const halfW = halfH * this.camera.aspect;
    const ndcTop = 1 - (2 * HUD_TOP_PX) / vh;
    const ndcBot = -1 + (2 * HUD_BOTTOM_PX) / vh;
    const fill = 0.94;
    const header = typeof document !== 'undefined' ? document.getElementById('match-header') : null;
    const headerW = header?.getBoundingClientRect().width ?? 0;
    const hudPx = Math.min(
      vw - HUD_SIDE_PX * 2,
      Math.max(headerW > 120 ? headerW : 0, Math.min(420, vh * 0.56)),
    );
    const hudWorldW = (hudPx / vw) * 2 * halfW;
    const safeW = Math.max(0.5, hudWorldW * fill);
    const safeH = Math.max(0.5, (ndcTop - ndcBot) * halfH * fill);
    const centerY = ((ndcTop + ndcBot) / 2) * halfH;
    const maxCellW = (safeW - (HAND_COLS - 1) * gapX) / HAND_COLS;
    const maxCellH = (safeH - (HAND_ROWS - 1) * gapY) / HAND_ROWS;
    let cardW = maxCellW;
    let cardH = cardW / HAND_CARD_ASPECT;
    if (cardH > maxCellH) {
      cardH = maxCellH;
      cardW = cardH * HAND_CARD_ASPECT;
    }
    const gridW = HAND_COLS * cardW + (HAND_COLS - 1) * gapX;
    const gridH = HAND_ROWS * cardH + (HAND_ROWS - 1) * gapY;
    return {
      cardW,
      cardH,
      gapX,
      gapY,
      originX: -gridW / 2 + cardW / 2,
      originY: gridH / 2 - cardH / 2,
      centerY,
    };
  }

  private layoutPlates(snap = false): void {
    if (this.plateRows.length === 0) {
      this.platesSettled = true;
      return;
    }
    const anchor = this.plateAnchor();
    const layout = this.fitHandInHud();
    const fxSlot = this.plateFx?.slot ?? -1;
    if (this.handOpen && this.plateFx === null) {
      this.camera.getWorldDirection(this.handFwd);
      this.handCenter.copy(this.camera.position).addScaledVector(this.handFwd, HAND_CAM_DIST);
      this.handRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.handUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.handCenter.addScaledVector(this.handUp, layout.centerY);
    }
    const ease = snap ? 1 : this.handOpen ? 0.28 : 0.22;
    let maxDelta = 0;
    for (const row of this.plateRows) {
      const mesh = this.plates.get(row.slot);
      if (mesh === undefined) continue;
      if (row.slot === fxSlot) continue;
      let targetPos: THREE.Vector3;
      let targetSx: number;
      let targetSy: number;
      if (this.handOpen) {
        const col = row.slot % HAND_COLS;
        const rowI = Math.min(HAND_ROWS - 1, Math.floor(row.slot / HAND_COLS));
        const lx = layout.originX + col * (layout.cardW + layout.gapX);
        const ly = layout.originY - rowI * (layout.cardH + layout.gapY);
        targetPos = this.handCenter
          .clone()
          .addScaledVector(this.handRight, lx)
          .addScaledVector(this.handUp, ly);
        targetSx = layout.cardW * (row.playable || row.used ? 1 : 0.96);
        targetSy = layout.cardH * (row.playable || row.used ? 1 : 0.96);
        mesh.quaternion.slerp(this.camera.quaternion, ease);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.opacity = row.used ? 0.4 : row.playable ? 1 : 0.55;
        mesh.renderOrder = 80 + row.slot;
      } else {
        // Peek fan so the stack reads as a deck, not a single black speck.
        const n = this.plateRows.length;
        const peek = 0.055;
        const spread = Math.max(0, n - 1) * peek;
        const along = -spread / 2 + row.slot * peek;
        targetPos = new THREE.Vector3(
          anchor.x + anchor.mirror * along * 0.35,
          STACK_Y + row.slot * 0.014,
          anchor.z - along,
        );
        targetSx = STACK_W * (row.used ? 0.9 : 1);
        targetSy = STACK_H * (row.used ? 0.9 : 1);
        const yaw = anchor.mirror * (row.slot - (n - 1) / 2) * 0.04;
        const floorQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, yaw));
        mesh.quaternion.slerp(floorQuat, ease);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.depthTest = true;
        mat.depthWrite = true;
        mat.opacity = row.used ? 0.4 : row.playable ? 1 : 0.7;
        mesh.renderOrder = 2 + row.slot;
      }
      mesh.position.lerp(targetPos, ease);
      mesh.scale.x += (targetSx - mesh.scale.x) * ease;
      mesh.scale.y += (targetSy - mesh.scale.y) * ease;
      mesh.scale.z = 1;
      maxDelta = Math.max(
        maxDelta,
        mesh.position.distanceToSquared(targetPos),
        Math.abs(targetSx - mesh.scale.x) + Math.abs(targetSy - mesh.scale.y),
      );
    }
    this.platesSettled = maxDelta < 1e-5;
    if (!this.platesSettled) this.needsRender = true;
  }
}

interface TimerTube {
  readonly root: THREE.Group;
  readonly fill: THREE.Mesh;
  readonly glow: THREE.Mesh;
  readonly length: number;
}
