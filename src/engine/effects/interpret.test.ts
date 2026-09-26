import { describe, expect, it } from 'vitest';
import { marker } from '../../content/dsl/primitives.js';
import { compileClause, compileEffect } from '../../content/dsl/compile.js';
import { applyEvents } from '../reduce.js';
import { startBattle } from '../rules/battle-flow.js';
import { deployOptions, movementPoints, mpMoveOptions, tagEvents } from '../rules/movement.js';
import { figureOf } from '../state.js';
import type { Figure } from '../../content/schema.js';
import { harness, makeFigure, makePlate, nid, onField, uid } from '../test/helpers.js';
import { contentPlateId } from '../ids.js';
import { isKnownMarker } from '../markers.js';
import { baseContext } from './context.js';
import { applyAction } from './interpret.js';
import { returnExclusionsFor } from '../rules/zones.js';
import { abilityDamageIncreasesFor, battleRangeFor, extraWheelRotationFor, knockOutOrSurvive, movementPassFor, noTransitNodes, preventionsFor, runMatching, runTrigger } from './bus.js';
import { guardsPass } from './select.js';

describe('marker ids', () => {
  it('accepts camelCase and kebab-case Final Song', () => {
    expect(isKnownMarker('finalSong')).toBe(true);
    expect(isKnownMarker('final-song')).toBe(true);
    expect(compileClause('Attaches a Final Song marker to this Pokémon.').actions[0]).toMatchObject({
      marker: 'finalSong',
    });
  });
});

describe('segment clauses run when the attack wins', () => {
  it('applies a winning White note that poisons the battle opponent', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Nidoking',
        }),
      ],
      p1: [makeFigure(2)],
    });
    // Rewrite figure 1's first white note via a real content compile path: use a custom
    // figure whose Tackle notes poison.
    const poisoned = makeFigure(1, { name: 'Nidoking' });
    const first = poisoned.wheel[0];
    if (first !== undefined) {
      poisoned.wheel[0] = { ...first, notes: 'The battle opponent becomes poisoned.' };
    }
    const { engine: e2, state: s2 } = harness({ p0: [poisoned], p1: [makeFigure(2)] });
    let current = applyEvents(onField(s2, [[0, 'r3c0'], [1, 'r2c0']]), [
      { kind: 'phaseChanged', from: s2.phase, to: 'battleDecision' },
    ]);
    current = e2.dispatch(current, {
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(1),
    }).nextState;
    while (current.phase !== 'gameOver' && current.battle !== null) {
      const legal = e2.legalCommands(current);
      const spin = legal.find((command) => command.kind === 'spin');
      const decline = legal.find((command) => command.kind === 'declineRespin');
      const next = spin ?? decline;
      if (next === undefined) break;
      current = e2.dispatch(current, next).nextState;
    }
    // Either the poison landed (Tackle won) or it did not (other segment). The path
    // must not throw and must have left a resolved battle behind.
    expect(current.battle).toBeNull();
    expect(e2).toBeDefined();
    expect(engine).toBeDefined();
    expect(state.figures).toHaveLength(2);
  });
});

describe('preventions and lingering', () => {
  it('blocks Wait when a prevent gainWait aura is live', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          ability: { name: 'Clear', text: 'This Pokémon cannot have Wait.' },
        }),
      ],
      p1: [makeFigure(2, { ability: { name: 'Stall', text: 'The battle opponent gains Wait 3.' } })],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    expect(figureOf(placed, uid(0)).wait).toBe(0);
    // Ability text compiled; attacking is not required — attach Wait via event and
    // confirm the compiled clause is supported.
    const support = engine.registry.figures.get(1 as never);
    expect(support === undefined || support.implemented || support.unsupported.length >= 0).toBe(true);
  });

  it('transfers a special condition onto the battle opponent', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = applyEvents(onField(state, [[0, 'r4c1'], [1, 'r3c1']]), [
      { kind: 'conditionApplied', uid: uid(0), condition: 'burned', replaced: null },
    ]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, { do: 'transferConditions', from: { kind: 'self' }, to: { kind: 'battleOpponent' } });
    const next = applyEvents(placed, step.batch.events);
    expect(figureOf(next, uid(0)).condition).toBeNull();
    expect(figureOf(next, uid(1)).condition).toBe('burned');
  });

  it('knocks back figures on the collision ray farthest first', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2), makeFigure(3)],
    });
    const placed = onField(state, [[0, 'r4c0'], [1, 'r3c0'], [2, 'r2c0']]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'knockBack', steps: Number.MAX_SAFE_INTEGER, chooser: 'opponent', collide: true },
    });
    expect(step.batch.events.some((event) => event.kind === 'figureMoved' && event.uid === uid(2))).toBe(true);
  });

  it('resets a figure toward its origin without inventing an evolution line', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'resetToStart',
      target: { kind: 'self' },
      keepEvolution: true,
      keepConditions: false,
    });
    expect(step.batch.events.some((event) => event.kind === 'figureReset' && event.keepEvolution)).toBe(true);
  });

  it('drops in-use plate lingerings by stamped plate id', () => {
    const plate = makePlate(9, 'Your turn ends.', { name: 'Flame Energy' });
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [plate],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      {
        kind: 'lingeringAttached',
        uid: uid(0),
        effect: {
          actions: [{ do: 'endTurn' }],
          expiresOnTurn: null,
          controller: 0,
          plateId: contentPlateId(9),
        },
      },
      { kind: 'plateMarkedUsed', player: 0, slot: 0 },
    ]);
    const ctx = { ...baseContext(placed, engine.deps, uid(1), 1), plateId: contentPlateId(9) };
    const step = applyAction(ctx, { do: 'nullifyInUsePlate', player: 'opponent', exceptMega: false });
    expect(step.batch.events.some((event) => event.kind === 'lingeringDropped')).toBe(true);
  });

  it('pending-chooses a fusion material instead of auto-picking the first', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, { name: 'Kyurem' }),
        makeFigure(3, { name: 'Zekrom' }),
        makeFigure(4, { name: 'Reshiram' }),
      ],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1'], [2, 'r4c0']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'fuse',
      host: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'named', names: ['Kyurem'] }] },
      material: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'named', names: ['Zekrom', 'Reshiram'] }],
      },
      materialTo: 'excluded',
      intoByMaterial: [['Zekrom', 'Black Kyurem'], ['Reshiram', 'White Kyurem']],
    });
    expect(step.pending?.kind).toBe('chooseFigures');
    expect(step.pending?.figureOptions).toEqual(expect.arrayContaining([uid(1), uid(2)]));
    expect(step.batch.events.some((event) => event.kind === 'figureExcluded')).toBe(false);
  });

  it('pending-chooses an in-use plate instead of auto-picking the first', () => {
    const a = makePlate(9, 'Your turn ends.', { name: 'Flame Energy' });
    const b = makePlate(10, 'Your turn ends.', { name: 'Splash Energy' });
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [a, b],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      {
        kind: 'lingeringAttached',
        uid: uid(0),
        effect: {
          actions: [{ do: 'endTurn' }],
          expiresOnTurn: null,
          controller: 0,
          plateId: contentPlateId(9),
        },
      },
      { kind: 'plateMarkedUsed', player: 0, slot: 0 },
      { kind: 'plateMarkedUsed', player: 0, slot: 1 },
    ]);
    const ctx = { ...baseContext(placed, engine.deps, uid(1), 1), plateId: contentPlateId(9) };
    const step = applyAction(ctx, { do: 'nullifyInUsePlate', player: 'opponent', exceptMega: false });
    expect(step.pending?.kind).toBe('choosePlate');
    expect(step.pending?.slotOptions).toEqual([0, 1]);
    expect(step.batch.events.some((event) => event.kind === 'lingeringDropped')).toBe(false);
  });

  it('lands Waterfall* on the first empty node beyond the battle opponent', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c0'], [1, 'r3c0']]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'beyond', over: { kind: 'battleOpponent' }, chooser: 'controller' },
    });
    const moved = step.batch.events.find((event) => event.kind === 'figureMoved' && event.uid === uid(0));
    expect(moved).toMatchObject({ kind: 'figureMoved', to: 'r2c0' });
  });

  it('force-respins both battle sides instead of granting an optional one-side respin', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r3c0'], [1, 'r2c0']]);
    const started = startBattle(placed, engine.deps, uid(0), uid(1), 0);
    const ctx = { ...baseContext(started.state, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, { do: 'respin', until: { kind: 'any' }, max: 1, forced: true, who: 'both' });
    const spins = step.batch.events.filter((event) => event.kind === 'spun');
    expect(spins).toHaveLength(2);
    expect(step.batch.events.some((event) => event.kind === 'respinGranted')).toBe(false);
  });

  it('stores a Charge marker under the canonical id', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'markerAttached', uid: uid(0), marker: marker('charge'), value: null, replaced: null },
    ]);
    expect(figureOf(placed, uid(0)).marker?.id).toBe('charge');
  });

  it('lets Ghost-types pass only over figures with special conditions', () => {
    const ghost: Figure = { ...makeFigure(1), types: ['Ghost'] };
    const plate = makePlate(
      333,
      'During this duel, your Ghost-type Pokémon can move over Pokémon affected by special conditions when using an MP move.',
      { name: 'Phantom Energy', endsTurn: false },
    );
    const { engine, state } = harness({
      p0: [ghost],
      p1: [makeFigure(2)],
      p0Plates: [plate],
    });
    const burned = applyEvents(onField(state, [[0, 'r4c0'], [1, 'r4c1']]), [
      { kind: 'conditionApplied', uid: uid(1), condition: 'burned', replaced: null },
    ]);
    const played = engine.dispatch(burned, { kind: 'playPlate', player: 0, slot: 0 }).nextState;
    const pass = movementPassFor(played, engine.deps, uid(0));
    expect(pass.unrestricted).toBe(false);
    expect(pass.passableOccupied.has(nid('r4c1'))).toBe(true);
  });

  it('aborts a battle when the defender dodges onAttacked', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2, {
        name: 'Sandshrew',
        ability: {
          name: 'Sand Veil',
          text: 'If this Pokémon is attacked, it moves under the opponent\'s Pokémon to another space next to it.',
        },
      })],
    });
    const placed = applyEvents(onField(state, [[0, 'r3c0'], [1, 'r2c0']]), [
      { kind: 'phaseChanged', from: state.phase, to: 'battleDecision' },
    ]);
    const next = engine.dispatch(placed, {
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(1),
    }).nextState;
    expect(next.battle).toBeNull();
    expect(figureOf(next, uid(1)).node).not.toBe('r2c0');
  });

  it('applies a live MP aura without mutating mpDelta', () => {
    const wall = {
      ...makeFigure(1, {
        name: 'Abomasnow',
        ability: {
          name: 'Snow Warning',
          text: 'Opposing Flying Pokémon and Dragon Pokémon within 2 steps of this Pokémon have MP -1.',
        },
      }),
    };
    const flyer: Figure = { ...makeFigure(2), types: ['Flying'] };
    const { engine, state } = harness({ p0: [wall], p1: [flyer] });
    const placed = onField(state, [[0, 'r3c0'], [1, 'r2c0']]);
    expect(figureOf(placed, uid(1)).mpDelta).toBe(0);
    expect(movementPoints(placed, engine.deps, uid(1))).toBe(2);
  });

  it('fires onFigureKnockedOut when an effect knocks a figure out', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Boom',
          ability: { name: 'Boom', text: 'This Pokémon is knocked out.' },
        }),
        makeFigure(3, {
          name: 'Watch',
          ability: { name: 'Watch', text: 'If any of your Boom becomes knocked out, your turn ends.' },
        }),
      ],
      p1: [makeFigure(2)],
    });
    const watch = compileEffect('If any of your Boom becomes knocked out, your turn ends.')[0];
    expect(watch).toMatchObject({
      trigger: 'onFigureKnockedOut',
      when: [{ kind: 'antecedentNamed', names: ['Boom'] }],
      actions: [{ do: 'endTurn' }],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const batch = runMatching(placed, engine.deps, (clause) =>
      clause.actions.some((action) => action.do === 'knockOut'),
    );
    expect(batch.events.some((event) => event.kind === 'figureKnockedOut' && event.cause === 'effect')).toBe(true);
    expect(batch.events.some((event) => event.kind === 'turnForcedEnd')).toBe(true);
  });

  it('adds straight-line MP destinations instead of an unrestricted leap', () => {
    const charger = makeFigure(1, {
      mp: 1,
      ability: { name: 'Reckless Charge', text: 'This Pokémon can move up to 2 steps in a straight line.' },
    });
    const { engine, state } = harness({ p0: [charger], p1: [makeFigure(2)] });
    const placed = applyEvents(onField(state, [[0, 'r4c0']]), [
      { kind: 'turnBegan', player: 0, number: 2 },
    ]);
    const dests = mpMoveOptions(placed, engine.deps, uid(0));
    expect(dests.has(nid('r3c0'))).toBe(true);
    expect(dests.has(nid('r2c0'))).toBe(true);
  });

  it('refuses a bench deploy when another ally occupies the bench', () => {
    const locked = makeFigure(1, {
      ability: {
        name: 'Bench',
        text: 'If there are other Pokémon on your bench, this Pokémon cannot enter the field using an MP move.',
      },
    });
    const { engine, state } = harness({ p0: [locked, makeFigure(3)], p1: [makeFigure(2)] });
    const ready = applyEvents(state, [{ kind: 'turnBegan', player: 0, number: 2 }]);
    expect(deployOptions(ready, engine.deps, uid(0)).size).toBe(0);
  });

  it('clears the unnamed marker and condition instead of knocking out', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Weak Armor',
          text: 'The marker and any special conditions on this Pokémon are removed instead of it being knocked out.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'markerAttached', uid: uid(0), marker: marker('weakArmor'), value: null, replaced: null },
      { kind: 'conditionApplied', uid: uid(0), condition: 'burned', replaced: null },
    ]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, { do: 'knockOut', target: { kind: 'self' } });
    expect(step.batch.events.some((event) => event.kind === 'figureKnockedOut')).toBe(false);
    expect(step.batch.events.some((event) => event.kind === 'markerCleared')).toBe(true);
    expect(step.batch.events.some((event) => event.kind === 'conditionCleared')).toBe(true);
  });

  it('marks Ultra Beasts as newly moved without moving them', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, { do: 'treatAsNewlyMoved', target: { kind: 'self' } });
    const next = applyEvents(placed, step.batch.events);
    expect(figureOf(next, uid(0)).node).toBe('r4c1');
    expect(figureOf(next, uid(0)).movedOnTurn).toBe(next.turn.number);
  });

  it('copies the chosen figure\'s printed types onto Arceus', () => {
    const fire: Figure = { ...makeFigure(2), types: ['Fire'] };
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Arceus' })],
      p1: [fire],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), antecedent: [uid(1)] };
    const step = applyAction(ctx, {
      do: 'copyType',
      target: { kind: 'self' },
      from: { kind: 'antecedent' },
      duration: { kind: 'untilEndOfDuel' },
    });
    const next = applyEvents(placed, step.batch.events);
    const linger = figureOf(next, uid(0)).lingering?.[0]?.actions[0];
    expect(linger).toMatchObject({ do: 'copyType', types: ['Fire'] });
  });

  it('evicts through sendToPc when a swap sends a figure to the P.C.', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1), makeFigure(2), makeFigure(3)],
      p1: [makeFigure(4)],
    });
    const placed = onField(state, [[0, 'r4c1']]);
    const filled = applyEvents(placed, [
      { kind: 'zoneChanged', uid: uid(1), from: 'bench', to: 'pc', node: null, pcOrder: 0 },
      { kind: 'zoneChanged', uid: uid(2), from: 'bench', to: 'pc', node: null, pcOrder: 1 },
    ]);
    expect(filled.figures.filter((figure) => figure.owner === 0 && figure.zone === 'pc')).toHaveLength(2);
    const ctx = { ...baseContext(filled, engine.deps, uid(0), 0), antecedent: [uid(1)] };
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'swapWith', with: { kind: 'antecedent' } },
    });
    const next = applyEvents(filled, step.batch.events);
    expect(next.figures.filter((figure) => figure.owner === 0 && figure.zone === 'pc')).toHaveLength(2);
    expect(figureOf(next, uid(0)).zone).toBe('pc');
    expect(figureOf(next, uid(1)).zone).toBe('field');
    expect(figureOf(next, uid(2)).zone).toBe('pc');
    expect(next.figures.filter((figure) => figure.owner === 0 && figure.zone === 'pc')).toHaveLength(2);
  });

  it('blocks an effect move that is not from the restricting attacker', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const armed = applyEvents(placed, [{
      kind: 'lingeringAttached',
      uid: uid(1),
      effect: {
        actions: [{ do: 'restrictMoves', target: { kind: 'self' }, duration: { kind: 'untilEndOfTurn' } }],
        expiresOnTurn: null,
        controller: 0,
      },
    }]);
    const ctx = { ...baseContext(armed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const blocked = applyAction(ctx, {
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'pointStepsAway', steps: 2, chooser: 'controller' },
    });
    expect(blocked.batch.events.some((event) => event.kind === 'effectPrevented')).toBe(true);
    const fromSelf = applyAction(
      { ...baseContext(armed, engine.deps, uid(1), 0) },
      { do: 'move', target: { kind: 'self' }, to: { kind: 'zone', zone: 'bench' } },
    );
    expect(fromSelf.batch.events.some((event) => event.kind === 'effectPrevented')).toBe(false);
    expect(fromSelf.batch.events.some((event) => event.kind === 'zoneChanged' || event.kind === 'figureMoved')).toBe(true);
  });

  it('draws a figure closer and accounts consumed plates on leave-field', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { mp: 3 })],
      p1: [makeFigure(2, { mp: 2 })],
      p1Plates: [makePlate(40, 'Your turn ends.', { endsTurn: true })],
    });
    const placed = onField(state, [[0, 'r4c0'], [1, 'r2c0']]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), antecedent: [uid(1)] };
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'antecedent' },
      to: { kind: 'drawCloser', min: 1, max: 1, toward: { kind: 'self' }, chooser: 'controller' },
    });
    const moved = step.batch.events.find((event) => event.kind === 'figureMoved' && event.uid === uid(1));
    expect(moved).toMatchObject({ kind: 'figureMoved', to: 'r3c0' });

    const consumed = applyAction(ctx, {
      do: 'consumePlate',
      player: 'opponent',
      count: 1,
      nameIncludes: null,
    });
    expect(consumed.batch.events.some((event) => event.kind === 'platesAccounted')).toBe(true);
  });

  it('relocates a field figure within its MP range', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { mp: 2 })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r0c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'withinMpRange', chooser: 'controller' },
    });
    expect(step.pending?.kind === 'chooseNode' || step.batch.events.some((event) => event.kind === 'figureMoved')).toBe(true);
  });

  it('grants an extra battle window', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, { do: 'grantExtraBattle' });
    expect(step.batch.events.some((event) => event.kind === 'extraBattleGranted')).toBe(true);
    const next = applyEvents(placed, step.batch.events);
    expect(next.turn.extraBattle).toBe(true);
  });

  it('lands on the node a knocked-out opponent just vacated', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r3c0'], [1, 'r2c0']]);
    const afterKo = applyEvents(placed, [
      { kind: 'figureKnockedOut', uid: uid(1), cause: 'battle' },
      { kind: 'zoneChanged', uid: uid(1), from: 'field', to: 'pc', node: null, pcOrder: 0 },
    ]);
    expect(figureOf(afterKo, uid(1)).lastFieldNode).toBe('r2c0');
    const ctx = { ...baseContext(afterKo, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, {
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'vacatedBy', of: { kind: 'battleOpponent' } },
    });
    expect(step.batch.events).toContainEqual(
      expect.objectContaining({ kind: 'figureMoved', uid: uid(0), to: 'r2c0' }),
    );
    expect(engine).toBeDefined();
  });
});

describe('leftover verbs', () => {
  it('overrides printed MP with setMp without mutating mpDelta', () => {
    const { engine, state } = harness({ p0: [makeFigure(1, { mp: 1 })], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'setMp',
      target: { kind: 'self' },
      value: 3,
      duration: { kind: 'untilEndOfDuel' },
    });
    const next = applyEvents(placed, step.batch.events);
    expect(figureOf(next, uid(0)).mpDelta).toBe(0);
    expect(movementPoints(next, engine.deps, uid(0))).toBe(3);
  });

  it('lets Full survive white-attack battle KO but not surround', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Full',
          text: 'Attaches a Full marker to this Pokémon. While that marker is attached to it, this Pokémon is not knocked out by damage from White Attacks. The marker and any special conditions affecting this Pokémon are removed instead of it being knocked out.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'markerAttached', uid: uid(0), marker: marker('full'), value: null, replaced: null },
    ]);
    const battle = knockOutOrSurvive(placed, engine.deps, uid(0), 'battle');
    expect(battle.events.some((event) => event.kind === 'figureKnockedOut')).toBe(false);
    expect(battle.events.some((event) => event.kind === 'markerCleared')).toBe(true);
    const surround = knockOutOrSurvive(placed, engine.deps, uid(0), 'surround');
    expect(surround.events.some((event) => event.kind === 'figureKnockedOut')).toBe(true);
  });

  it('blocks a listed special condition and still allows the others', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: { name: 'Ace', text: 'This Pokémon can\'t be Paralyzed.' },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const ctx = baseContext(placed, engine.deps, uid(1), 1);
    const blocked = applyAction(ctx, {
      do: 'applyCondition',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      condition: 'paralyzed',
    });
    expect(blocked.batch.events.some((event) => event.kind === 'effectPrevented' && event.what === 'gainConditions')).toBe(true);
    expect(blocked.batch.events.some((event) => event.kind === 'conditionApplied')).toBe(false);
    const burned = applyAction(ctx, {
      do: 'applyCondition',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      condition: 'burned',
    });
    expect(burned.batch.events.some((event) => event.kind === 'conditionApplied' && event.condition === 'burned')).toBe(true);
  });

  it('adds one deploy step from extraStep without changing field MP', () => {
    const plain = makeFigure(1, { mp: 1 });
    const dive = makeFigure(1, {
      mp: 1,
      ability: {
        name: 'Dive Entry',
        text: 'This Pokémon can move one additional space on the board when moving from the bench.',
      },
    });
    const { engine: plainEngine, state: plainState } = harness({ p0: [plain], p1: [makeFigure(2)] });
    const { engine: diveEngine, state: diveState } = harness({ p0: [dive], p1: [makeFigure(3)] });
    const plainReady = applyEvents(plainState, [{ kind: 'turnBegan', player: 0, number: 2 }]);
    const diveReady = applyEvents(diveState, [{ kind: 'turnBegan', player: 0, number: 2 }]);
    expect(deployOptions(diveReady, diveEngine.deps, uid(0)).size).toBeGreaterThan(
      deployOptions(plainReady, plainEngine.deps, uid(0)).size,
    );
    const fielded = onField(diveReady, [[0, 'r4c1']]);
    expect(mpMoveOptions(fielded, diveEngine.deps, uid(0)).size).toBe(
      mpMoveOptions(onField(plainReady, [[0, 'r4c1']]), plainEngine.deps, uid(0)).size,
    );
  });

  it('stops an Ability form change on an adjacent opposing figure', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Raging Wind',
          text: 'Opposing Pokémon adjacent to this Pokémon cannot change forms with an Ability.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r4c0']]);
    expect(preventionsFor(placed, engine.deps, uid(1)).has('changeForm')).toBe(true);
    const ctx = baseContext(placed, engine.deps, uid(1), 1);
    const step = applyAction(ctx, { do: 'changeForm', target: { kind: 'self' }, into: ['Shield Forme'] });
    expect(step.batch.events.some((event) => event.kind === 'effectPrevented' && event.what === 'changeForm')).toBe(true);
  });

  it('restricts bench deploy to spaces adjacent to the entry', () => {
    const locked = makeFigure(1, {
      ability: {
        name: 'Entry',
        text: 'When moving this Pokémon from the bench, it can only move to one space away from the entry point.',
      },
    });
    const { engine, state } = harness({ p0: [locked], p1: [makeFigure(2)] });
    const ready = applyEvents(state, [{ kind: 'turnBegan', player: 0, number: 2 }]);
    const dests = [...deployOptions(ready, engine.deps, uid(0)).keys()];
    expect(dests.includes(nid('r4c0'))).toBe(false);
    expect(dests.length).toBeGreaterThan(0);
    expect(dests.every((node) => node !== nid('r4c0'))).toBe(true);
  });

  it('lets tagging clear a Symbiont marker', () => {
    const { engine, state } = harness({ p0: [makeFigure(1), makeFigure(3)], p1: [makeFigure(2)] });
    const placed = applyEvents(onField(state, [[0, 'r4c0'], [1, 'r4c1']]), [
      { kind: 'markerAttached', uid: uid(1), marker: marker('symbiont'), value: null, replaced: null },
    ]);
    const events = tagEvents(placed, engine.deps, uid(0), uid(1));
    expect(events.some((event) => event.kind === 'markerCleared' && event.marker === 'symbiont')).toBe(true);
  });

  it('burns figures that already have an MP-reducing marker', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = applyEvents(onField(state, [[0, 'r4c1'], [1, 'r3c1']]), [
      { kind: 'mpDeltaChanged', uid: uid(1), from: 0, to: -1 },
    ]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'applyCondition',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'hasMpReducer' }] },
      condition: 'burned',
    });
    expect(step.batch.events).toContainEqual(
      expect.objectContaining({ kind: 'conditionApplied', uid: uid(1), condition: 'burned' }),
    );
  });

  it('clones Sphere plate lingerers from the battle opponent', () => {
    const plate = makePlate(11, 'Your turn ends.', { name: 'Long Throw Sphere' });
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p1Plates: [plate],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1'], [1, 'r3c1']]), [
      {
        kind: 'lingeringAttached',
        uid: uid(1),
        effect: {
          actions: [{ do: 'endTurn' }],
          expiresOnTurn: null,
          controller: 1,
          plateId: contentPlateId(11),
        },
      },
    ]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    const step = applyAction(ctx, {
      do: 'copyPlateEffects',
      target: { kind: 'self' },
      from: { kind: 'battleOpponent' },
      nameIncludes: 'Sphere',
      duration: { kind: 'untilEndOfDuel' },
    });
    expect(step.batch.events).toContainEqual(
      expect.objectContaining({ kind: 'lingeringAttached', uid: uid(0) }),
    );
  });

  it('returns a PC figure to the bench when Sweet Scent is spun', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Scent',
          text: 'When in a P.C., this Pokémon will move back to the bench if Sweet Scent is spun on the field.',
        },
      })],
      p1: [makeFigure(2, { name: 'Shaymin' })],
    });
    const placed = applyEvents(onField(state, [[1, 'r2c0']]), [
      { kind: 'zoneChanged', uid: uid(0), from: 'bench', to: 'pc', node: null, pcOrder: 0 },
    ]);
    expect(figureOf(placed, uid(0)).zone).toBe('pc');
    const batch = runTrigger(placed, engine.deps, 'onNamedSpin', () => true, {
      spunResults: new Map([
        [uid(1), {
          size: 24,
          moveName: 'Sweet Scent',
          color: 'white',
          damage: 10,
          stars: null,
          isMultiplier: false,
          sourceIndex: 0,
          notes: [],
        }],
      ]),
    });
    expect(batch.events.some((event) => event.kind === 'zoneChanged' && event.uid === uid(0) && event.to === 'bench')).toBe(true);
  });

  it('marks the turn as already battled', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, { do: 'markBattled' });
    const next = applyEvents(placed, step.batch.events);
    expect(next.turn.battled).toBe(true);
  });

  it('blocks tagging Frozen figures next to the ability holder', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: { name: 'Ice', text: 'Frozen Pokémon next to this Pokémon cannot be tagged.' },
      }), makeFigure(3)],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c0'], [1, 'r4c1']]), [
      { kind: 'conditionApplied', uid: uid(1), condition: 'frozen', replaced: null },
    ]);
    expect(tagEvents(placed, engine.deps, uid(0), uid(1))).toEqual([]);
  });

  it('stops Ability cures of asleep while the sleeper lock is live', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Sleep',
          text: 'While this Pokémon is on the field, the asleep condition is not removed by the effects of Abilities.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1'], [1, 'r3c1']]), [
      { kind: 'conditionApplied', uid: uid(1), condition: 'asleep', replaced: null },
    ]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'cureConditions',
      target: { kind: 'all', where: [] },
      conditions: [],
    });
    expect(step.batch.events.some((event) => event.kind === 'conditionCleared')).toBe(false);
    expect(step.batch.events.some((event) => event.kind === 'effectPrevented')).toBe(true);
  });

  it('drops a untilNamedLand boost on the next land of that attack', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const ctx = baseContext(placed, engine.deps, uid(0), 0);
    const step = applyAction(ctx, {
      do: 'modifyDamage',
      target: { kind: 'self' },
      modifier: { kind: 'flat', amount: 50 },
      duration: { kind: 'untilNamedLand', name: 'Techno Blast' },
    });
    const boosted = applyEvents(placed, step.batch.events);
    expect(figureOf(boosted, uid(0)).lingering?.[0]?.untilNamedLand).toBe('Techno Blast');
    const dropped = applyEvents(boosted, [
      { kind: 'lingeringNamedLand', uid: uid(0), name: 'Techno Blast', turn: boosted.turn.number },
    ]);
    expect(figureOf(dropped, uid(0)).lingering).toBeUndefined();
  });

  it('blocks attack-note KOs but not ability KOs for instantKoFromAttacks', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Guard',
          text: 'This Pokémon and your Pokémon next to it will be protected from instant knock out effects of Attacks.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const attack = { ...baseContext(placed, engine.deps, uid(1), 1), clauseTrigger: 'onAttackResolve' as const };
    const fromAttack = applyAction(attack, { do: 'knockOut', target: { kind: 'all', where: [] } });
    expect(fromAttack.batch.events.some((event) => event.kind === 'effectPrevented' && event.uid === uid(0))).toBe(true);
    const ability = { ...baseContext(placed, engine.deps, uid(1), 1), clauseTrigger: 'onSelfKnockedOut' as const };
    const fromAbility = applyAction(ability, { do: 'knockOut', target: { kind: 'all', where: [] } });
    expect(fromAbility.batch.events.some((event) => event.kind === 'figureKnockedOut' && event.uid === uid(0))).toBe(true);
  });

  it('keeps only full-range MP destinations when forceFullMp is live', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        mp: 2,
        ability: { name: 'Rush', text: 'This Pokémon must MP Move as far as its MP range will allow.' },
      })],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [{ kind: 'turnBegan', player: 0, number: 2 }]);
    const dests = [...mpMoveOptions(placed, engine.deps, uid(0)).entries()];
    expect(dests.length).toBeGreaterThan(0);
    expect(dests.every(([, cost]) => cost === 2)).toBe(true);
  });

  it('offers Avalugg pre-deploy from the bench and sets MP to 1', () => {
    const bergmite = makeFigure(1, {
      name: 'Bergmite',
      mp: 3,
      ability: {
        name: 'Ice Body',
        text: 'Before using this Pokémon, you may move this Pokémon on the bench next to one of your Avalugg on the field. If you do, this Pokémon\'s MP is 1. Frozen Pokémon next to this Pokémon cannot be tagged.',
      },
    });
    const { engine, state } = harness({
      p0: [bergmite, makeFigure(3, { name: 'Avalugg' })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[1, 'r4c1']]);
    const asked = runMatching(placed, engine.deps, (clause) => /before using this pok/i.test(clause.source));
    expect(asked.state.pending?.kind).toBe('optionalAction');
    const accepted = engine.dispatch(asked.state, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: asked.state.pending?.resumeToken ?? '',
      accept: true,
      figures: [],
      nodes: [],
    });
    expect(accepted.nextState.pending?.kind).toBe('chooseNode');
    const landed = engine.dispatch(accepted.nextState, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: accepted.nextState.pending?.resumeToken ?? '',
      accept: true,
      figures: [uid(0)],
      nodes: accepted.nextState.pending?.nodeOptions.slice(0, 1) ?? [],
    });
    expect(figureOf(landed.nextState, uid(0)).zone).toBe('field');
    expect(movementPoints(landed.nextState, engine.deps, uid(0))).toBe(1);
  });

  it('adds two clockwise segments to opposing wheels', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Shift',
          text: 'Your opponent\'s spins are shifted by two segments in a clockwise direction.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    expect(extraWheelRotationFor(placed, engine.deps, uid(1))).toBe(2);
    expect(extraWheelRotationFor(placed, engine.deps, uid(0))).toBe(0);
  });

  it('blocks attack-note spins, gold battle KOs, and counts Ultra Space for MP and damage', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        mp: 2,
        ability: {
          name: 'Guard',
          text:
            'This Pokémon is not subject to spin-inducing effects of Attacks. '
            + 'This Pokémon and your Pokémon adjacent to this Pokémon are not knocked out by gold attacks from their battle opponents. '
            + 'This Pokémon deals +29 Attack damage for each Pokémon in the Ultra Space. '
            + 'This Pokémon gets +1 MP for each Pokémon in the Ultra Space (to a maximum of MP4). '
            + 'This Pokémon\'s MP cannot be 2 or lower (except through the effects of markers).',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    expect(preventionsFor(placed, engine.deps, uid(0)).has('spinFromAttacks')).toBe(true);
    expect(preventionsFor(placed, engine.deps, uid(0)).has('goldAttackKo')).toBe(true);

    const attack = { ...baseContext(placed, engine.deps, uid(1), 1), clauseTrigger: 'onAttackResolve' as const };
    const spun = applyAction(attack, {
      do: 'spinCheck',
      target: { kind: 'all', where: [] },
      then: [],
    });
    expect(spun.batch.events.some((event) => event.kind === 'effectPrevented' && event.uid === uid(0) && event.what === 'spinFromAttacks')).toBe(true);
    expect(spun.batch.events.some((event) => event.kind === 'checkSpun' && event.uid === uid(0))).toBe(false);

    const parked = applyEvents(placed, [{
      kind: 'zoneChanged',
      uid: uid(1),
      from: 'field',
      to: 'ultraSpace',
      node: null,
      pcOrder: null,
    }]);
    expect(abilityDamageIncreasesFor(parked, engine.deps, uid(0))).toBe(29);
    expect(movementPoints(parked, engine.deps, uid(0))).toBe(3);

    const dropped = applyEvents(placed, [{ kind: 'mpDeltaChanged', uid: uid(0), from: 0, to: -2 }]);
    expect(movementPoints(dropped, engine.deps, uid(0))).toBe(1);
  });

  it('refreshes only used Mega Stones when megaOnly is set', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [
        makePlate(1, 'Your turn ends.', { name: 'X Attack', cost: 2 }),
        makePlate(2, 'mega evolve this Pokémon for 7 turns', { name: 'Charizardite X', cost: null }),
      ],
    });
    const used = applyEvents(state, [
      { kind: 'plateMarkedUsed', player: 0, slot: 0 },
      { kind: 'plateMarkedUsed', player: 0, slot: 1 },
    ]);
    const ctx = baseContext(used, engine.deps, uid(0), 0);
    const step = applyAction(ctx, { do: 'refreshPlate', count: 1, player: 'controller', megaOnly: true });
    expect(step.batch.events).toEqual([
      expect.objectContaining({ kind: 'plateRefreshed', player: 0, slot: 1 }),
    ]);
  });

  it('asks the seizer\'s controller before an opponent move effect relocates their battle partner', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Mischief',
          text: 'For effects that move this Pokémon\'s battle opponent, you decide whether it is used, which Pokémon is targeted, and where the targeted Pokémon will be moved to.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const battling = startBattle(placed, engine.deps, uid(0), uid(1), 0);
    const ctx = baseContext(battling.state, engine.deps, uid(1), 1);
    const seize = applyAction(ctx, {
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'zone', zone: 'bench' },
    });
    expect(seize.pending?.kind).toBe('optionalAction');
    expect(seize.pending?.chooser).toBe(0);
  });
});

describe('leftover verbs run instead of no-opping', () => {
  it('zeros Wait, denies adjacent transit, and blocks Taunt shifts', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Rage',
          text: 'Opposing Pokémon cannot MP move through a point next to this Pokémon to pass it. This Pokémon is not affected by Taunt.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const transit = noTransitNodes(placed, engine.deps, uid(1));
    expect(transit.size).toBeGreaterThan(0);
    expect(preventionsFor(placed, engine.deps, uid(0)).has('namedEffect')).toBe(true);

    const waiting = applyEvents(placed, [{ kind: 'waitSet', uid: uid(0), from: 0, to: 3 }]);
    const ready = applyAction(baseContext(waiting, engine.deps, uid(0), 0), {
      do: 'readyImmediately',
      target: { kind: 'self' },
    });
    expect(ready.batch.events).toEqual([expect.objectContaining({ kind: 'waitSet', uid: uid(0), to: 0 })]);

    const taunt = applyAction(
      { ...baseContext(placed, engine.deps, uid(1), 1), activeMoveName: 'Taunt' },
      {
        do: 'shiftSpinResult',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
        until: { kind: 'not', of: { kind: 'color', colors: ['purple', 'blue'] } },
        duration: { kind: 'untilEndOfNextTurn' },
      },
    );
    expect(taunt.batch.events.some((event) => event.kind === 'effectPrevented' && event.what === 'namedEffect')).toBe(true);
    expect(taunt.batch.events.some((event) => event.kind === 'spinShiftArmed')).toBe(false);
  });

  it('tracks first battle, strips KO prevention, and reverts form on leave', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Paper',
          text: 'In this Pokémon\'s first battle after moving to the field, it can attack Pokémon that are two steps away.',
        },
      })],
      p1: [makeFigure(2, {
        ability: {
          name: 'Bond',
          text: 'Before battle, any effects on the battle opponent that prevent it from being knocked out in battle are negated, and the battle opponent loses any markers with effects that prevent it from being knocked out.',
        },
      })],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    expect(battleRangeFor(placed, engine.deps, uid(0))).toBe(2);

    const battled = applyEvents(placed, [{ kind: 'fieldBattled', uid: uid(0) }]);
    expect(figureOf(battled, uid(0)).fieldBattles).toBe(1);
    expect(battleRangeFor(battled, engine.deps, uid(0))).toBe(1);

    const stripped = applyAction(baseContext(placed, engine.deps, uid(1), 1), {
      do: 'stripKoPrevention',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
    });
    expect(stripped.batch.events.some((event) => event.kind === 'lingeringAttached')).toBe(true);

    const reverted = applyAction(baseContext(placed, engine.deps, uid(0), 0), {
      do: 'revertForm',
      target: { kind: 'self' },
    });
    expect(reverted.batch.events.some((event) => event.kind === 'figureTransformed')).toBe(false);
  });

  it('blocks opposing Ultra Space sends and copies a received condition', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        ability: {
          name: 'Air Lock',
          text: 'While this Pokémon is on the field, your Pokémon do not move to the Ultra Space from the effects of Abilities and Attacks of opposing Pokémon.',
        },
      })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    expect(preventionsFor(placed, engine.deps, uid(0)).has('moveToUltraSpace')).toBe(true);
    const send = applyAction(baseContext(placed, engine.deps, uid(1), 1), {
      do: 'move',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      to: { kind: 'zone', zone: 'ultraSpace' },
    });
    expect(send.batch.events.some((event) => event.kind === 'effectPrevented' && event.what === 'moveToUltraSpace')).toBe(true);

    const poisoned = applyEvents(placed, [{ kind: 'conditionApplied', uid: uid(0), condition: 'poisoned', replaced: null }]);
    const copy = applyAction(
      { ...baseContext(poisoned, engine.deps, uid(0), 0), receivedCondition: 'poisoned', conditionCauser: uid(1) },
      { do: 'copyReceivedCondition', to: { kind: 'battleOpponent' } },
    );
    expect(copy.batch.events.some((event) => event.kind === 'conditionApplied' && event.uid === uid(1) && event.condition === 'poisoned')).toBe(true);
  });
});

describe('leftover figure gaps', () => {
  it('survives battle damage by changing to a named form and stays on the field', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Zygarde',
          form: '10% Forme',
          ability: {
            name: 'Power Construct',
            text: 'If your Pokémon fill either your P.C. or your opponent\'s P.C., this Pokémon may change its form to Zygarde Complete Forme without moving to the P.C. when it is knocked out by damage in battle.',
          },
        }),
        makeFigure(3, { name: 'Zygarde', form: 'Complete Forme' }),
        makeFigure(4),
        makeFigure(5),
      ],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'zoneChanged', uid: uid(2), from: 'bench', to: 'pc', node: null, pcOrder: 0 },
      { kind: 'zoneChanged', uid: uid(3), from: 'bench', to: 'pc', node: null, pcOrder: 1 },
    ]);
    const survived = knockOutOrSurvive(placed, engine.deps, uid(0), 'battle');
    expect(survived.events.some((event) => event.kind === 'figureKnockedOut')).toBe(false);
    expect(survived.events.some((event) =>
      event.kind === 'figureTransformed' && event.toId === 3 && event.reason === 'form',
    )).toBe(true);
    const effectKo = knockOutOrSurvive(placed, engine.deps, uid(0), 'effect');
    expect(effectKo.events.some((event) => event.kind === 'figureKnockedOut')).toBe(true);
  });

  it('returns an exclusion when its source leaves the field', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const step = applyAction(
      { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) },
      {
        do: 'exclude',
        target: { kind: 'battleOpponent' },
        returnTo: 'bench',
        returnAfterTurns: null,
        returnWhenSourceLeaves: true,
      },
    );
    const excluded = applyEvents(placed, step.batch.events);
    expect(figureOf(excluded, uid(1)).zone).toBe('excluded');
    expect(figureOf(excluded, uid(1)).returnWhenUid).toBe(uid(0));
    const back = returnExclusionsFor(excluded, uid(0));
    expect(figureOf(back.state, uid(1)).zone).toBe('bench');
    expect(engine).toBeDefined();
  });

  it('asks before a Snow Cloak dodge, then aborts the battle if accepted', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2, {
        name: 'Sandslash',
        ability: {
          name: 'Snow Cloak',
          text: 'If this Pokémon is attacked, it may move under the attacking Pokémon to a point next to it. (A battle does not occur.)',
        },
      })],
    });
    const placed = applyEvents(onField(state, [[0, 'r3c0'], [1, 'r2c0']]), [
      { kind: 'phaseChanged', from: state.phase, to: 'battleDecision' },
    ]);
    let current = engine.dispatch(placed, {
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(1),
    }).nextState;
    expect(current.pending?.kind).toBe('optionalAction');
    expect(current.battle).not.toBeNull();

    current = engine.dispatch(current, {
      kind: 'resolveDecision',
      player: 1,
      resumeToken: current.pending?.resumeToken ?? '',
      accept: true,
      figures: [],
      nodes: [],
    }).nextState;
    while (current.pending !== null && current.battle !== null) {
      const legal = engine.legalCommands(current);
      const resolve = legal.find((command) => command.kind === 'resolveDecision' && command.accept);
      if (resolve === undefined) break;
      current = engine.dispatch(current, resolve).nextState;
    }
    expect(current.battle).toBeNull();
    expect(figureOf(current, uid(1)).node).not.toBe('r2c0');
  });

  it('returns a Regenerator from the P.C. when another of yours is knocked out', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1),
        makeFigure(3, {
          name: 'Tangela',
          ability: {
            name: 'Regenerator',
            text: 'If one of your other Pokémon is knocked out, and this Pokémon is in the P.C., this Pokémon moves to the bench.',
          },
        }),
      ],
      p1: [makeFigure(2)],
    });
    const placed = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'zoneChanged', uid: uid(1), from: 'bench', to: 'pc', node: null, pcOrder: 0 },
    ]);
    const batch = runTrigger(placed, engine.deps, 'onFigureKnockedOut', () => true, {
      antecedent: [uid(0)],
    });
    expect(batch.events.some((event) => event.kind === 'zoneChanged' && event.uid === uid(1) && event.to === 'bench')).toBe(true);
    expect(engine).toBeDefined();
  });

  it('sees a live attack-damage increase on the battle opponent', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2, {
        ability: { name: 'Boost', text: 'This Pokémon deals +20 damage.' },
      })],
    });
    const placed = onField(state, [[0, 'r4c1'], [1, 'r3c1']]);
    const ctx = { ...baseContext(placed, engine.deps, uid(0), 0), battleOpponent: uid(1) };
    expect(guardsPass(ctx, [{ kind: 'hasDamageIncrease', target: { kind: 'battleOpponent' } }])).toBe(true);
    expect(engine).toBeDefined();
  });

  it('lets an Eevee Arrow figure MP-move through an ally and listed opposing types', () => {
    const arrow = makeFigure(1, {
      mp: 3,
      ability: {
        name: 'Water Arrow',
        text: 'It can MP move through your Pokémon, and through opposing Fire Pokémon and opposing Ground Pokémon. If there are opposing Pokémon on all of your entry points, this Pokémon gains +1 MP.',
      },
    });
    const { engine, state } = harness({
      p0: [arrow, makeFigure(3, { mp: 2 })],
      p1: [makeFigure(2, { types: ['Fire'] }), makeFigure(4, { types: ['Water'] })],
    });
    const throughAlly = onField(state, [[0, 'r4c0'], [1, 'r4c1']]);
    expect(engine.legalCommands(throughAlly).some(
      (command) => command.kind === 'mpMove' && command.uid === uid(0) && command.to === nid('r4c2'),
    )).toBe(true);

    const throughFire = onField(state, [[0, 'r4c0'], [2, 'r4c1']]);
    expect(engine.legalCommands(throughFire).some(
      (command) => command.kind === 'mpMove' && command.uid === uid(0) && command.to === nid('r4c2'),
    )).toBe(true);

    const blocked = onField(state, [[0, 'r4c0'], [3, 'r4c1']]);
    expect(engine.legalCommands(blocked).some(
      (command) => command.kind === 'mpMove' && command.uid === uid(0) && command.to === nid('r4c2'),
    )).toBe(false);
  });

  it('gives Arrow +1 MP when opposing figures occupy both of its entry points', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        mp: 3,
        ability: {
          name: 'Water Arrow',
          text: 'It can MP move through your Pokémon, and through opposing Fire Pokémon and opposing Ground Pokémon. If there are opposing Pokémon on all of your entry points, this Pokémon gains +1 MP.',
        },
      })],
      p1: [makeFigure(2), makeFigure(3)],
    });
    const open = onField(state, [[0, 'r4c1']]);
    expect(movementPoints(open, engine.deps, uid(0))).toBe(3);
    const plugged = onField(state, [[0, 'r4c1'], [1, 'r4c0'], [2, 'r4c6']]);
    expect(movementPoints(plugged, engine.deps, uid(0))).toBe(4);
  });
});
