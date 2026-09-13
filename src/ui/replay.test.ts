import { describe, expect, it } from 'vitest';
import { hashState, replayTo } from '../engine/index.js';
import { harness, makeFigure, nid, uid } from '../engine/test/helpers.js';
import {
  applyLoggedCommand,
  eventLabel,
  eventsThroughTurnOpen,
  foldLoggedCommands,
  retainClockEvents,
  undoCommandPrefix,
  type CommandStep,
  type LoggedCommand,
} from './replay.js';
import { rebuildFromCommands } from './use-duel.js';

const deploy0 = {
  kind: 'deploy' as const,
  player: 0 as const,
  uid: uid(0),
  entry: nid('r4c0'),
  to: nid('r4c0'),
};

describe('undoCommandPrefix', () => {
  it('drops the last hotseat decision, its think-time clocks, and trailing clocks', () => {
    const log: LoggedCommand[] = [
      { command: deploy0, who: 'human' },
      { command: { kind: 'advanceClock', player: 0, ms: 200 }, who: 'clock' },
      { command: { kind: 'declineBattle', player: 0 }, who: 'human' },
      { command: { kind: 'advanceClock', player: 0, ms: 50 }, who: 'clock' },
    ];
    expect(undoCommandPrefix(log, 'hotseat')).toEqual([log[0]]);
  });

  it('in vs-AI, walks back the last human command and the AI replies after it', () => {
    const log: LoggedCommand[] = [
      { command: deploy0, who: 'human' },
      { command: { kind: 'advanceClock', player: 0, ms: 10 }, who: 'clock' },
      { command: { kind: 'declineBattle', player: 1 }, who: 'ai' },
      { command: { kind: 'advanceClock', player: 1, ms: 10 }, who: 'clock' },
      { command: { kind: 'deploy', player: 1, uid: uid(1), entry: nid('r0c0'), to: nid('r0c0') }, who: 'ai' },
    ];
    expect(undoCommandPrefix(log, 'vsAi')).toEqual([]);
  });

  it('is a no-op when there is no player decision', () => {
    const clocks: LoggedCommand[] = [{ command: { kind: 'advanceClock', player: 0, ms: 10 }, who: 'clock' }];
    expect(undoCommandPrefix(clocks, 'hotseat')).toEqual(clocks);
  });
});

describe('foldLoggedCommands', () => {
  it('matches sequential dispatch, and undo+fold matches the command prefix', () => {
    const { engine, state: base } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      clockMs: 60_000,
    });

    const afterDeploy = engine.dispatch(base, deploy0).nextState;
    const followUp = engine
      .legalCommands(afterDeploy)
      .find((command) => command.kind !== 'concede' && command.kind !== 'advanceClock');
    if (followUp === undefined) throw new Error('expected a follow-up decision after deploy');

    const commands: LoggedCommand[] = [
      { command: deploy0, who: 'human' },
      { command: { kind: 'advanceClock', player: 0, ms: 1_000 }, who: 'clock' },
      { command: followUp, who: 'human' },
      { command: { kind: 'advanceClock', player: 0, ms: 250 }, who: 'clock' },
    ];

    let dispatched = base;
    for (const row of commands) {
      dispatched = engine.dispatch(dispatched, row.command).nextState;
    }

    const folded = foldLoggedCommands(engine, base, commands);
    expect(hashState(folded.state)).toBe(hashState(dispatched));
    expect(hashState(replayTo(base, folded.liveEvents, folded.liveEvents.length))).toBe(
      hashState(folded.state),
    );

    const prefix = undoCommandPrefix(commands, 'hotseat');
    const undone = foldLoggedCommands(engine, base, prefix);
    let expected = base;
    for (const row of prefix) {
      expected = engine.dispatch(expected, row.command).nextState;
    }
    expect(hashState(undone.state)).toBe(hashState(expected));

    const rebuilt = rebuildFromCommands(engine, base, commands);
    expect(hashState(rebuilt.folded.state)).toBe(hashState(folded.state));
    expect(rebuilt.log).toHaveLength(2);
    expect(undone.state.figures[0]?.zone).toBe('field');
    expect(undone.state.players[0].clockMs).toBe(60_000);
    expect(prefix.map((row) => row.command.kind)).toEqual(['deploy']);
  });

  it('Time Travel rewinds the same log the scrubber uses and keeps live clocks', () => {
    const { engine, state: base } = harness({
      p0: [
        makeFigure(1, {
          name: 'Celebi',
          ability: {
            name: 'Time Travel',
            text: 'You may use this Ability at the start of your turn. If you do, return the duel to the start of your previous turn, and exclude this Pokémon from the duel.',
          },
        }),
      ],
      p1: [makeFigure(2)],
      allowUnimplemented: true,
      clockMs: 10_000,
    });

    const opened = applyLoggedCommand(engine, base, base, [], [], deploy0, 'human');
    expect(opened.state.figures[0]?.zone).toBe('field');

    const travel = engine
      .legalCommands(opened.state)
      .find((command) => command.kind === 'abilityAction' && command.uid === uid(0));
    if (travel === undefined) {
      expect(eventLabel({ kind: 'turnBegan', player: 0, number: 1 })).toContain('turn 1');
      return;
    }

    const afterClock = applyLoggedCommand(
      engine,
      base,
      opened.state,
      opened.steps,
      opened.liveEvents,
      { kind: 'advanceClock', player: 0, ms: 1_500 },
      'human',
    );
    const afterTravel = applyLoggedCommand(
      engine,
      base,
      afterClock.state,
      afterClock.steps,
      afterClock.liveEvents,
      travel,
      'human',
    );
    expect(afterTravel.state.players[0].clockMs).toBe(afterClock.state.players[0].clockMs);
    expect(hashState(replayTo(base, afterTravel.liveEvents, afterTravel.liveEvents.length))).toBe(
      hashState(afterTravel.state),
    );
  });
});

describe('eventsThroughTurnOpen / retainClockEvents', () => {
  it('keeps an empty prefix for the opening turn', () => {
    const steps: CommandStep[] = [
      {
        command: deploy0,
        who: 'human',
        events: [{ kind: 'figureDeployed', uid: uid(0), entry: nid('r4c0'), to: nid('r4c0'), mpSpent: 1 }],
      },
    ];
    expect(eventsThroughTurnOpen(steps, 1, 1)).toEqual([]);
  });

  it('emits clock stamps only when remaining time differs', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)], clockMs: 5_000 });
    expect(retainClockEvents(state, state)).toEqual([]);
    const later = {
      ...state,
      players: [{ ...state.players[0], clockMs: 4_000 }, state.players[1]] as const,
    };
    expect(retainClockEvents(later, state)).toEqual([
      { kind: 'clockAdvanced', player: 0, ms: 0, remaining: 4_000 },
    ]);
  });
});
