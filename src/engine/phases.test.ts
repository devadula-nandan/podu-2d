import { describe, expect, it } from 'vitest';
import { IllegalCommandError } from './commands.js';
import { Z_GAUGE_TURN_GAIN } from './constants.js';
import { applyEvents } from './reduce.js';
import { harness, makeFigure, nid, onField, uid } from './test/helpers.js';

describe('phase machine gaps', () => {
  it('rejects abilityAction and resolveDecision when they are not in the legal set', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const legal = engine.legalCommands(state);
    expect(legal.some((command) => command.kind === 'abilityAction')).toBe(false);
    expect(legal.some((command) => command.kind === 'resolveDecision')).toBe(false);

    expect(() =>
      engine.dispatch(state, { kind: 'abilityAction', player: 0, uid: uid(0), clauseId: 'x' }),
    ).toThrow(IllegalCommandError);

    expect(() =>
      engine.dispatch(state, {
        kind: 'resolveDecision',
        player: 0,
        resumeToken: 'x',
        accept: true,
        figures: [],
        nodes: [],
      }),
    ).toThrow(IllegalCommandError);
  });

  it('rejects a move that is not in the legal set without changing the phase', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    expect(() =>
      engine.dispatch(state, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r0c3') }),
    ).toThrow(IllegalCommandError);
    expect(state.phase).toBe('action');
  });

  it('does not let the opponent\'s before-using ability freeze the starting player', () => {
    const { engine, state } = harness({
      startingPlayer: 1,
      p0: [
        makeFigure(1, {
          name: 'Avalugg',
          types: ['Ice'],
          ability: {
            name: 'Ice Breaker',
            text:
              'Before using this Pokémon, you can switch its position with an adjacent Ice Pokémon or frozen Pokémon. Your Ice-type Pokémon can move over this Pokémon when using an MP move.',
          },
        }),
      ],
      p1: [makeFigure(2, { name: 'Sentret', mp: 2 })],
    });
    expect(state.turn.player).toBe(1);
    expect(state.pending).toBeNull();
    expect(state.phase === 'plateWindow' || state.phase === 'action').toBe(true);
    const legal = engine.legalCommands(state);
    expect(legal.some((command) => command.kind === 'deploy' && command.player === 1)).toBe(true);
    expect(legal.some((command) => command.kind === 'resolveDecision' && command.player === 0)).toBe(
      false,
    );
  });

  it('fills the turn player\'s Z-Move gauge at the start of their turn', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
    });
    expect(state.players[0].zGauge).toBeGreaterThan(0);
    const after = engine.dispatch(state, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    }).nextState;
    expect(after.turn.player).toBe(1);
    expect(after.players[1].zGauge).toBeGreaterThan(state.players[1].zGauge);
  });

  it('ends the turn after deploying a figure that cannot battle and has no leftover MP', () => {
    const { engine, state } = harness({
      startingPlayer: 1,
      p0: [
        makeFigure(1, {
          name: 'Wobbuffet',
          mp: 2,
          ability: { name: 'Bide', text: 'This Pokémon cannot battle.' },
        }),
      ],
      p1: [makeFigure(2, { name: 'Talonflame', mp: 3 })],
    });
    const afterAi = engine.dispatch(state, {
      kind: 'deploy',
      player: 1,
      uid: uid(1),
      entry: nid('r0c0'),
      to: nid('r0c0'),
    }).nextState;
    expect(afterAi.turn.player).toBe(0);
    const afterUs = engine.dispatch(afterAi, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    }).nextState;
    expect(afterUs.turn.player).toBe(1);
    expect(afterUs.pending).toBeNull();
    expect(afterUs.phase === 'plateWindow' || afterUs.phase === 'action').toBe(true);
  });

  it('does not offer Ice Breaker at turn start, and lists it when that figure is used', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Avalugg',
          types: ['Ice'],
          ability: {
            name: 'Ice Breaker',
            text:
              'Before using this Pokémon, you can switch its position with an adjacent Ice Pokémon or frozen Pokémon. Your Ice-type Pokémon can move over this Pokémon when using an MP move.',
          },
        }),
      ],
      p1: [makeFigure(2, { name: 'Sentret', mp: 2 })],
    });
    const placed = onField(state, [[0, 'r4c0']]);
    expect(placed.pending).toBeNull();
    const ability = engine.legalCommands(placed).find((command) => command.kind === 'abilityAction');
    expect(ability?.kind).toBe('abilityAction');
    if (ability === undefined || ability.kind !== 'abilityAction') throw new Error('expected Ice Breaker');
    const offered = engine.dispatch(placed, ability);
    expect(offered.events.some((event) => event.kind === 'actionTaken')).toBe(false);
    expect(offered.nextState.turn.moved).toBe(false);
    expect(offered.nextState.turn.preSelectOffered).toEqual([uid(0)]);
  });

  it('offers a bench-to-field before-using swap and ignores Ice Breaker on the bench', () => {
    const iceBreaker = harness({
      p0: [
        makeFigure(1, {
          name: 'Avalugg',
          types: ['Ice'],
          ability: {
            name: 'Ice Breaker',
            text:
              'Before using this Pokémon, you can switch its position with an adjacent Ice Pokémon or frozen Pokémon. Your Ice-type Pokémon can move over this Pokémon when using an MP move.',
          },
        }),
      ],
      p1: [makeFigure(2, { name: 'Sentret', mp: 2 })],
    });
    expect(iceBreaker.state.pending).toBeNull();
    expect(
      iceBreaker.engine.legalCommands(iceBreaker.state).some(
        (command) => command.kind === 'abilityAction' && command.uid === uid(0),
      ),
    ).toBe(false);

    const berg = harness({
      p0: [
        makeFigure(3, {
          name: 'Bergmite',
          types: ['Ice'],
          ability: {
            name: 'Ice Body',
            text:
              'Before using this Pokémon, you may move this Pokémon on the bench next to one of your Avalugg on the field. If you do, this Pokémon\'s MP is 1. Frozen Pokémon next to this Pokémon cannot be tagged.',
          },
        }),
        makeFigure(4, { name: 'Avalugg', types: ['Ice'] }),
      ],
      p1: [makeFigure(5, { name: 'Sentret', mp: 2 })],
    });
    const placed = onField(berg.state, [[1, 'r4c0']]);
    const ability = berg.engine
      .legalCommands(placed)
      .find((command) => command.kind === 'abilityAction' && command.uid === uid(0));
    expect(ability?.kind).toBe('abilityAction');
    if (ability === undefined) throw new Error('expected Bergmite before-using');
    const asked = berg.engine.dispatch(placed, ability);
    expect(asked.nextState.pending?.kind).toBe('optionalAction');
    expect(asked.nextState.pending?.chooser).toBe(0);
    expect(asked.nextState.turn.moved).toBe(false);
  });

  it('lets an Ice-type deploy over field Avalugg', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Avalugg',
          types: ['Ice'],
          mp: 1,
          ability: {
            name: 'Ice Breaker',
            text:
              'Before using this Pokémon, you can switch its position with an adjacent Ice Pokémon or frozen Pokémon. Your Ice-type Pokémon can move over this Pokémon when using an MP move.',
          },
        }),
        makeFigure(2, { name: 'Glaceon', types: ['Ice'], mp: 3 }),
      ],
      p1: [makeFigure(3, { name: 'Sentret', mp: 2 })],
    });
    const placed = applyEvents(onField(state, [[0, 'r3c0']]), [
      { kind: 'turnBegan', player: 0, number: 2 },
    ]);
    const legal = engine.legalCommands(placed);
    expect(legal.some((command) =>
      command.kind === 'deploy' && command.uid === uid(1) && command.to === nid('r2c0'),
    )).toBe(true);
  });

  it('boosts start-of-turn Z fill once per special-conditioned Pokémon when Nihilego is on the field', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          name: 'Nihilego',
          ability: {
            name: 'Power Leak',
            text:
              'While this Pokémon is on the field, the start-of-turn Z-Move gauge increase of each player is boosted for each of that player\'s Pokémon that is affected by a special condition.',
          },
        }),
        makeFigure(2, { name: 'Sentret' }),
        makeFigure(3, { name: 'Pidgey' }),
      ],
      p1: [makeFigure(4, { name: 'Rattata' })],
    });
    const placed = applyEvents(onField(state, [[0, 'r3c0'], [1, 'r3c1']]), [
      { kind: 'conditionApplied', uid: uid(1), condition: 'poisoned', replaced: null },
    ]);
    const before = placed.players[0].zGauge;
    const after = engine.dispatch(placed, {
      kind: 'deploy',
      player: 0,
      uid: uid(2),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    }).nextState;
    const p1After = engine.dispatch(after, {
      kind: 'deploy',
      player: 1,
      uid: uid(3),
      entry: nid('r0c0'),
      to: nid('r0c0'),
    }).nextState;
    expect(p1After.turn.player).toBe(0);
    expect(p1After.players[0].zGauge).toBe(before + Z_GAUGE_TURN_GAIN * 2);
  });
});
