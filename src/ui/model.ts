import { spriteUrlForFigure } from '../content/sprites.js';
import type { Plate } from '../content/schema.js';
import type {
  BattleOutcome,
  Command,
  DamageStage,
  Engine,
  FigureState,
  FigureUid,
  GameEvent,
  GameState,
  NodeId,
  PendingDecision,
  Phase,
  PlayerId,
  PlayerView,
  ResolvedSegment,
} from '../engine/index.js';
import {
  contentFigureId,
  contentPlateId,
  isFormOnlyFigure,
  plateCostTowardBudget,
  plateDeckIssues,
} from '../engine/index.js';
import { figureOfContent, plateOfContent } from './boot.js';

export const FIGURES_PER_DECK = 6;
export const PLATES_PER_DECK = 6;
export const PLATE_COST_CAP = 8;

export interface DeckDraft {
  readonly figures: readonly number[];
  readonly plates: readonly number[];
}

export interface DeckIssue {
  readonly level: 'error' | 'warn';
  readonly message: string;
}

export function plateCost(plate: Plate): number {
  return plateCostTowardBudget(plate);
}

export function validateDeck(engine: Engine, draft: DeckDraft, allowUnimplemented: boolean): DeckIssue[] {
  const issues: DeckIssue[] = [];
  if (draft.figures.length !== FIGURES_PER_DECK) {
    issues.push({
      level: 'error',
      message: `Need exactly ${FIGURES_PER_DECK} figures (have ${draft.figures.length}).`,
    });
  }
  if (draft.plates.length > PLATES_PER_DECK) {
    issues.push({
      level: 'error',
      message: `At most ${PLATES_PER_DECK} plates (have ${draft.plates.length}).`,
    });
  }

  const loadedPlates: Plate[] = [];
  for (const id of draft.plates) {
    const plate = plateOfContent(engine, id);
    if (plate === null) {
      issues.push({ level: 'error', message: `Unknown plate #${id}.` });
      continue;
    }
    loadedPlates.push(plate);
    const support = engine.registry.plates.get(contentPlateId(id));
    if (support !== undefined && !support.implemented && !allowUnimplemented) {
      issues.push({
        level: 'error',
        message: `${plate.name} is not implemented. Enable the debug toggle to field it.`,
      });
    }
  }
  for (const issue of plateDeckIssues(loadedPlates)) {
    issues.push({ level: 'error', message: issue });
  }

  const formNames = new Map<string, string>();
  for (const id of draft.figures) {
    const figure = figureOfContent(engine, id);
    if (figure === null) {
      issues.push({ level: 'error', message: `Unknown figure #${id}.` });
      continue;
    }
    const support = engine.registry.figures.get(contentFigureId(id));
    if (support !== undefined && !support.implemented && !allowUnimplemented) {
      issues.push({
        level: 'error',
        message: `${figure.name} is not fully implemented. Enable the debug toggle to field it.`,
      });
    }
    if (isFormOnlyFigure(figure)) {
      issues.push({
        level: 'error',
        message: `${figure.name} can only be set as a form; it cannot occupy a primary slot.`,
      });
    }
    if (figure.form !== null) {
      const prior = formNames.get(figure.form);
      if (prior !== undefined) {
        issues.push({
          level: 'error',
          message: `Printed form "${figure.form}" is already used by ${prior}.`,
        });
      } else {
        formNames.set(figure.form, figure.name);
      }
    }
  }
  return issues;
}

export function deckHasErrors(issues: readonly DeckIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

export function seatLabel(player: PlayerId): string {
  return player === 0 ? 'Seat A' : 'Seat B';
}

/** Deck-builder plaques. Player 0 is always You on the near edge. */
export function deckSeatName(player: PlayerId): string {
  return player === 0 ? 'You' : 'Rival';
}

export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'setup':
      return 'Setup';
    case 'turnStart':
      return 'Turn start';
    case 'plateWindow':
      return 'Plate window';
    case 'preSelect':
      return 'Before using a figure';
    case 'action':
      return 'Move';
    case 'surroundCheck':
      return 'Surround check';
    case 'battleDecision':
      return 'Battle?';
    case 'spin':
      return 'Spin';
    case 'respin':
      return 'Respin';
    case 'damageResolve':
      return 'Damage';
    case 'turnEnd':
      return 'Turn end';
    case 'gameOver':
      return 'Game over';
  }
}

export function formatClock(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16).padStart(8, '0')}`;
}

export function randomSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] ?? 1;
}

export function figureName(engine: Engine, figure: FigureState): string {
  return figureOfContent(engine, figure.figureId)?.name ?? `#${figure.figureId}`;
}

export function figureSpriteUrl(engine: Engine, figureId: number): string | null {
  const content = figureOfContent(engine, figureId);
  return content === null ? null : spriteUrlForFigure(content);
}

export function figureSpriteUrlOf(engine: Engine, figure: FigureState): string | null {
  return figureSpriteUrl(engine, figure.figureId);
}

export function figureSpriteUrlFromUid(
  engine: Engine,
  figures: readonly FigureState[],
  uid: number,
): string | null {
  const figure = figures[uid];
  return figure === undefined ? null : figureSpriteUrlOf(engine, figure);
}

export function figureMp(engine: Engine, figure: FigureState): number {
  const printed = figureOfContent(engine, figure.figureId)?.mp ?? 0;
  return printed + figure.mpDelta;
}

export function isPlayerCommand(command: Command, player: PlayerId): boolean {
  return command.player === player;
}

export function decisionCommands(legal: readonly Command[]): Command[] {
  return legal.filter((command) => command.kind !== 'concede' && command.kind !== 'advanceClock');
}

export function actorOf(state: GameState, legal: readonly Command[]): PlayerId {
  const decisions = decisionCommands(legal);
  if (decisions.some((command) => command.player === state.turn.player)) return state.turn.player;
  const only = decisions[0];
  return only?.player ?? state.turn.player;
}

export function commandsForUid(legal: readonly Command[], uid: FigureUid): Command[] {
  return legal.filter((command) => {
    if (command.kind === 'deploy' || command.kind === 'mpMove' || command.kind === 'abilityAction') {
      return command.uid === uid;
    }
    if (command.kind === 'tag') return command.uid === uid || command.target === uid;
    if (command.kind === 'initiateBattle') return command.attacker === uid || command.defender === uid;
    return false;
  });
}

export function reachableNodes(legal: readonly Command[], uid: FigureUid): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const command of legal) {
    if (command.kind === 'deploy' && command.uid === uid) nodes.add(command.to);
    if (command.kind === 'mpMove' && command.uid === uid) nodes.add(command.to);
  }
  return nodes;
}

export function battleTargetNodes(
  legal: readonly Command[],
  view: PlayerView,
  attacker: FigureUid | null,
): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const command of legal) {
    if (command.kind !== 'initiateBattle') continue;
    if (attacker !== null && command.attacker !== attacker) continue;
    const defender = view.figures.find((figure) => figure.uid === command.defender);
    if (defender !== undefined && defender.node !== null) nodes.add(defender.node);
  }
  return nodes;
}

export function movableUids(legal: readonly Command[], player: PlayerId): Set<number> {
  const uids = new Set<number>();
  for (const command of legal) {
    if (command.player !== player) continue;
    if (command.kind === 'deploy' || command.kind === 'mpMove' || command.kind === 'abilityAction') {
      uids.add(command.uid);
    }
    if (command.kind === 'initiateBattle') uids.add(command.attacker);
    if (command.kind === 'tag') uids.add(command.uid);
  }
  return uids;
}

export function findDeploy(legal: readonly Command[], uid: FigureUid, to: NodeId): Command | null {
  const matches = legal.filter(
    (command): command is Extract<Command, { kind: 'deploy' }> =>
      command.kind === 'deploy' && command.uid === uid && command.to === to,
  );
  const ontoEntry = matches.find((command) => command.entry === to);
  return ontoEntry ?? matches[0] ?? null;
}

export function findMove(legal: readonly Command[], uid: FigureUid, to: NodeId): Command | null {
  return (
    legal.find(
      (command): command is Extract<Command, { kind: 'mpMove' }> =>
        command.kind === 'mpMove' && command.uid === uid && command.to === to,
    ) ?? null
  );
}

export function findBattle(
  legal: readonly Command[],
  attacker: FigureUid,
  defender: FigureUid,
): Command | null {
  return (
    legal.find(
      (command): command is Extract<Command, { kind: 'initiateBattle' }> =>
        command.kind === 'initiateBattle' && command.attacker === attacker && command.defender === defender,
    ) ?? null
  );
}

export function findTag(legal: readonly Command[], uid: FigureUid, target: FigureUid): Command | null {
  return (
    legal.find(
      (command): command is Extract<Command, { kind: 'tag' }> =>
        command.kind === 'tag' && command.uid === uid && command.target === target,
    ) ?? null
  );
}

export function findKind(legal: readonly Command[], kind: Command['kind'], player: PlayerId): Command | null {
  return legal.find((command) => command.kind === kind && command.player === player) ?? null;
}

export function findFigureDecision(
  legal: readonly Command[],
  player: PlayerId,
  uid: FigureUid,
): Command | null {
  return (
    legal.find(
      (command) =>
        command.kind === 'resolveDecision' &&
        command.player === player &&
        command.accept &&
        command.figures.length === 1 &&
        command.figures[0] === uid,
    ) ?? null
  );
}

/**
 * /2d End turn is only "skip this optional battle" (`declineBattle`).
 * Not a pass — Wait Victory forbids an always-legal skip. Not skip-plate.
 */
export function endTurnCommand(legal: readonly Command[], player: PlayerId): Command | null {
  return findKind(legal, 'declineBattle', player);
}

export function commandLabel(
  engine: Engine,
  figures: readonly FigureState[],
  command: Command,
  pending: PendingDecision | null = null,
): string {
  const name = (uid: FigureUid): string => {
    const figure = figures[uid];
    return figure === undefined ? `#${uid}` : figureName(engine, figure);
  };
  if (command.kind === 'deploy') return `Deploy ${name(command.uid)} → ${command.to}`;
  if (command.kind === 'mpMove') return `Move ${name(command.uid)} → ${command.to}`;
  if (command.kind === 'tag') return `Tag ${name(command.target)} with ${name(command.uid)}`;
  if (command.kind === 'initiateBattle') {
    const zMove = command.zMoveIndex;
    const z = zMove === undefined ? '' : ` · Z-Move ${zMove + 1}`;
    return `Battle ${name(command.attacker)} vs ${name(command.defender)}${z}`;
  }
  if (command.kind === 'playPlate') return `Play plate slot ${command.slot + 1}`;
  if (command.kind === 'declinePlate') return 'Skip plate';
  if (command.kind === 'declineBattle') return 'Decline battle';
  if (command.kind === 'spin') return 'Spin both wheels';
  if (command.kind === 'useRespin') return 'Use respin';
  if (command.kind === 'declineRespin') return 'Keep spin';
  if (command.kind === 'abilityAction') {
    const figure = figures[command.uid];
    const content = figure === undefined ? undefined : engine.content.figures.get(figure.figureId);
    const clause = content?.abilityClauses.find((item) => item.id === command.clauseId);
    return clause !== undefined ? `Ability: ${clause.source}` : `Ability ${command.clauseId}`;
  }
  if (command.kind === 'concede') return 'Concede';
  if (command.kind === 'advanceClock') return 'Advance clock';
  if (command.kind === 'declineWindow') return 'Skip before-using window';
  const prompt = pending?.prompt ?? 'decision';
  if (!command.accept) return `Decline: ${prompt}`;
  const node = command.nodes[0];
  if (node !== undefined) return `Choose ${node} — ${prompt}`;
  if (command.figures.length > 0) return `Choose ${command.figures.map(name).join(', ')} — ${prompt}`;
  return `Accept: ${prompt}`;
}

export interface LandedSpin {
  readonly unit: number;
  readonly index: number;
  readonly shiftedFrom: number | null;
}

export interface SideDamage {
  readonly stages: readonly DamageStage[];
  readonly final: number | null;
}

export interface BattleSnap {
  readonly initiator: PlayerId;
  readonly attacker: FigureUid;
  readonly defender: FigureUid;
  readonly attackerWheel: readonly ResolvedSegment[];
  readonly defenderWheel: readonly ResolvedSegment[];
  readonly attackerLanded: LandedSpin | null;
  readonly defenderLanded: LandedSpin | null;
  readonly attackerDamage: SideDamage | null;
  readonly defenderDamage: SideDamage | null;
  readonly outcome: BattleOutcome | null;
}

export function foldBattleSnap(events: readonly GameEvent[], prev: BattleSnap | null): BattleSnap | null {
  let snap = prev;
  for (const event of events) {
    if (event.kind === 'battleStarted') {
      snap = {
        initiator: event.initiator,
        attacker: event.attacker,
        defender: event.defender,
        attackerWheel: event.attackerWheel,
        defenderWheel: event.defenderWheel,
        attackerLanded: null,
        defenderLanded: null,
        attackerDamage: null,
        defenderDamage: null,
        outcome: null,
      };
      continue;
    }
    if (event.kind === 'spun' && snap !== null) {
      const landed = { unit: event.unit, index: event.index, shiftedFrom: event.shiftedFrom };
      snap =
        event.role === 'attacker' ? { ...snap, attackerLanded: landed } : { ...snap, defenderLanded: landed };
      continue;
    }
    if (event.kind === 'damageComputed' && snap !== null) {
      const pack = { stages: event.stages, final: event.final };
      snap =
        event.role === 'attacker' ? { ...snap, attackerDamage: pack } : { ...snap, defenderDamage: pack };
      continue;
    }
    if (event.kind === 'battleResolved' && snap !== null) {
      snap = { ...snap, outcome: event.outcome };
    }
  }
  return snap;
}

export function describeSurroundEvents(
  nameOf: (uid: FigureUid) => string,
  events: readonly GameEvent[],
): string | null {
  const hits = events.filter(
    (event): event is Extract<GameEvent, { kind: 'surrounded' }> => event.kind === 'surrounded',
  );
  if (hits.length === 0) return null;
  return hits
    .map((event) => {
      const toPc = events.some(
        (row) => row.kind === 'zoneChanged' && row.uid === event.uid && row.to === 'pc',
      );
      return `${nameOf(event.uid)} was surrounded${toPc ? ' and sent to the P.C.' : ''}`;
    })
    .join(' ');
}

export function recentPlayLines(
  engine: Engine,
  figures: readonly FigureState[],
  events: readonly GameEvent[],
  you: PlayerId,
): string[] {
  const nameOf = (uid: FigureUid): string => {
    const figure = figures[uid];
    return figure === undefined ? `#${uid}` : figureName(engine, figure);
  };
  const lines: string[] = [];
  for (let index = events.length - 1; index >= 0 && lines.length < 2; index--) {
    const line = playUpdateLine(engine, events, index, nameOf, you);
    if (line !== null && line !== lines[0]) lines.push(line);
  }
  return lines.reverse();
}

function playUpdateLine(
  engine: Engine,
  events: readonly GameEvent[],
  index: number,
  nameOf: (uid: FigureUid) => string,
  you: PlayerId,
): string | null {
  const event = events[index];
  if (event === undefined) return null;
  if (event.kind === 'figureDeployed') return `${nameOf(event.uid)} entered ${event.to}`;
  if (event.kind === 'figureMoved') return `${nameOf(event.uid)} moved to ${event.to}`;
  if (event.kind === 'surrounded') return `${nameOf(event.uid)} was surrounded`;
  if (event.kind === 'figureKnockedOut') return `${nameOf(event.uid)} was knocked out`;
  if (event.kind === 'goalReached') return `${nameOf(event.uid)} reached the goal`;
  if (event.kind === 'turnBegan') return event.player === you ? 'Your turn' : "Rival's turn";
  if (event.kind === 'platePlayed') {
    const plate = engine.content.plates.get(event.plateId)?.plate.name;
    return plate === undefined ? 'Played a plate' : `Played ${plate}`;
  }
  if (event.kind === 'battleResolved') return describeBattleLine(events, index, nameOf);
  return null;
}

function describeBattleLine(
  events: readonly GameEvent[],
  at: number,
  nameOf: (uid: FigureUid) => string,
): string {
  let started: Extract<GameEvent, { kind: 'battleStarted' }> | null = null;
  let atkIndex: number | null = null;
  let defIndex: number | null = null;
  let atkFinal: number | null = null;
  let defFinal: number | null = null;
  for (let i = at; i >= 0; i--) {
    const event = events[i];
    if (event === undefined) continue;
    if (event.kind === 'battleStarted') {
      started = event;
      break;
    }
    if (event.kind === 'spun') {
      if (event.role === 'attacker') atkIndex = event.index;
      else defIndex = event.index;
    }
    if (event.kind === 'damageComputed') {
      if (event.role === 'attacker') atkFinal = event.final;
      else defFinal = event.final;
    }
    if (event.kind === 'battleLandedRewritten') {
      if (event.role === 'attacker') atkFinal = event.damage;
      else defFinal = event.damage;
    }
  }
  const resolved = events[at];
  if (started === null) {
    return resolved?.kind === 'battleResolved' ? resolved.outcome.reason : 'Battle over';
  }
  const atk = started.attackerWheel[atkIndex ?? -1];
  const def = started.defenderWheel[defIndex ?? -1];
  if (atk !== undefined && def !== undefined) {
    const left = `${atk.moveName}${atkFinal !== null ? ` ${atkFinal}` : atk.damage !== null ? ` ${atk.damage}` : ''}`;
    const right = `${def.moveName}${defFinal !== null ? ` ${defFinal}` : def.damage !== null ? ` ${def.damage}` : ''}`;
    return `${left} beat ${right}`;
  }
  return `${nameOf(started.attacker)} vs ${nameOf(started.defender)}`;
}

export function foldSurround(events: readonly GameEvent[], prev: readonly FigureUid[]): FigureUid[] {
  const moved = events.some((event) => event.kind === 'figureMoved' || event.kind === 'figureDeployed');
  const extra = events.filter((event) => event.kind === 'surrounded').map((event) => event.uid);
  if (moved) return extra;
  if (extra.length === 0) return [...prev];
  return [...new Set([...prev, ...extra])];
}

export function landedSegment(
  wheel: readonly ResolvedSegment[],
  index: number | null,
): ResolvedSegment | null {
  if (index === null) return null;
  return wheel[index] ?? null;
}

export function describeSegment(segment: ResolvedSegment | null): string {
  if (segment === null) return '—';
  const dmg =
    segment.stars !== null
      ? `${segment.stars}★`
      : segment.damage !== null
        ? `${segment.damage}${segment.isMultiplier ? '×' : ''}`
        : '—';
  return `${segment.color.toUpperCase()} ${segment.moveName} (${dmg}, ${segment.size}/96)`;
}

export function zoneFigures(view: PlayerView, player: PlayerId, zone: FigureState['zone']): FigureState[] {
  const rows = view.figures.filter((figure) => figure.owner === player && figure.zone === zone);
  if (zone === 'pc') {
    return [...rows].sort((a, b) => (a.pcOrder ?? 0) - (b.pcOrder ?? 0));
  }
  return rows;
}

export function conditionLabel(figure: FigureState): string[] {
  const badges: string[] = [];
  if (figure.condition !== null) badges.push(figure.condition);
  if (figure.wait > 0) badges.push(`Wait ${figure.wait}`);
  if (figure.marker !== null) {
    badges.push(
      figure.marker.value === null ? figure.marker.id : `${figure.marker.id} ${figure.marker.value}`,
    );
  }
  if (figure.megaTurnsLeft !== null) badges.push(`Mega ${figure.megaTurnsLeft}`);
  if (figure.goalLocked) badges.push('goal-locked');
  if (figure.chainLevel > 0) badges.push(`CL ${figure.chainLevel}`);
  return badges;
}
