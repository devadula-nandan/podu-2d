/**
 * Internal-consistency checks on the rules constants.
 *
 * These tests prove nothing about Pokemon Duel - they cannot, since the whole point of
 * this module is that some of its values are rulings rather than facts. What they catch
 * is a fat-fingered edit: a range whose bounds got swapped, a clock set to zero, a
 * ruling whose audit note references a constant that no longer exists. Flipping a
 * ruling should be a one-token change that still passes; breaking the module's
 * invariants should not.
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_CONDITIONS } from '../content/dsl/primitives.js';
import * as RULES from './constants.js';
import {
  BOARD_EDGE_COUNT,
  BOARD_NODE_COUNT,
  CHESS_CLOCK_MINUTES,
  CHESS_CLOCK_MS,
  CONDITION_BLOCKS_MP_MOVE,
  CONTESTED_FIELDS,
  CONTESTED_FIELD_COUNT,
  CONTESTED_FIELD_OVERRIDES,
  GOAL_NODE_COUNT,
  GOAL_NODE_DEGREE,
  MAX_NODE_DEGREE,
  MAX_SURROUNDS_PER_TURN,
  MIN_NODE_DEGREE,
  MP_BASE_MAX,
  MP_BASE_MIN,
  MP_EFFECTIVE_MAX,
  NON_GOAL_NODE_COUNT,
  OPEN_RULINGS,
  OPEN_RULING_COUNT,
  PURPLE_STAR_MAX,
  PURPLE_STAR_MIN,
  RULING_CONFIDENCES,
  RULES_SOURCES,
  STARLESS_PURPLE_SUBSTITUTE_STARS,
  TURN_LIMIT,
  WHEEL_TOTAL_UNITS,
} from './constants.js';

describe('rules constants: ranges are ordered and non-degenerate', () => {
  it('orders the MP range and leaves room for the buffed maximum', () => {
    expect(MP_BASE_MIN).toBeLessThan(MP_BASE_MAX);
    // Five figures really do have 0 MP, so the floor is 0 and not 1.
    expect(MP_BASE_MIN).toBe(0);
    // Abilities push MP past the printed ceiling; clamping at MP_BASE_MAX is the bug
    // this assertion exists to make obvious.
    expect(MP_EFFECTIVE_MAX).toBeGreaterThan(MP_BASE_MAX);
  });

  it('orders the Purple star range and keeps the starless substitute inside it', () => {
    expect(PURPLE_STAR_MIN).toBeLessThan(PURPLE_STAR_MAX);
    expect(PURPLE_STAR_MIN).toBeGreaterThan(0);
    expect(STARLESS_PURPLE_SUBSTITUTE_STARS).toBeGreaterThanOrEqual(PURPLE_STAR_MIN);
    expect(STARLESS_PURPLE_SUBSTITUTE_STARS).toBeLessThanOrEqual(PURPLE_STAR_MAX);
  });

  it('orders the node-degree range and keeps the goal degree inside it', () => {
    expect(MIN_NODE_DEGREE).toBeLessThan(MAX_NODE_DEGREE);
    expect(GOAL_NODE_DEGREE).toBeGreaterThanOrEqual(MIN_NODE_DEGREE);
    expect(GOAL_NODE_DEGREE).toBeLessThanOrEqual(MAX_NODE_DEGREE);
  });
});

describe('rules constants: the counted quantities are positive', () => {
  it('keeps the wheel total, turn cap and clock positive', () => {
    expect(WHEEL_TOTAL_UNITS).toBeGreaterThan(0);
    expect(TURN_LIMIT).toBeGreaterThan(0);
    expect(CHESS_CLOCK_MINUTES).toBeGreaterThan(0);
    expect(CHESS_CLOCK_MS).toBe(CHESS_CLOCK_MINUTES * 60_000);
  });

  it('keeps every capacity and budget positive', () => {
    const positive = {
      PC_CAPACITY: RULES.PC_CAPACITY,
      PLATE_DECK_SLOTS: RULES.PLATE_DECK_SLOTS,
      PLATE_COST_BUDGET: RULES.PLATE_COST_BUDGET,
      PLATE_USES_PER_DUEL: RULES.PLATE_USES_PER_DUEL,
      MEGA_DURATION_TURNS: RULES.MEGA_DURATION_TURNS,
      MEGA_EVOLUTIONS_PER_DUEL: RULES.MEGA_EVOLUTIONS_PER_DUEL,
      TEMPORARY_EXCLUSION_DEFAULT_TURNS: RULES.TEMPORARY_EXCLUSION_DEFAULT_TURNS,
      MAX_CONDITIONS_PER_FIGURE: RULES.MAX_CONDITIONS_PER_FIGURE,
      MAX_MARKERS_PER_FIGURE: RULES.MAX_MARKERS_PER_FIGURE,
      MAX_TYPES_PER_FIGURE: RULES.MAX_TYPES_PER_FIGURE,
      BATTLE_RANGE_DEFAULT: RULES.BATTLE_RANGE_DEFAULT,
      BATTLE_RANGE_MAX: RULES.BATTLE_RANGE_MAX,
      DEPLOY_MP_COST: RULES.DEPLOY_MP_COST,
      CHAIN_LEVEL_DAMAGE_PER_LEVEL: RULES.CHAIN_LEVEL_DAMAGE_PER_LEVEL,
    };
    for (const [name, value] of Object.entries(positive)) {
      expect(value, name).toBeGreaterThan(0);
      expect(Number.isInteger(value), name).toBe(true);
    }
  });

  it('lets a range-2 attacker actually reach further than the default', () => {
    expect(RULES.BATTLE_RANGE_MAX).toBeGreaterThanOrEqual(RULES.BATTLE_RANGE_DEFAULT);
  });

  it('treats an unlimited surround cap as null rather than zero', () => {
    // `0` would read as "surround never kills", which is the opposite of unlimited.
    if (MAX_SURROUNDS_PER_TURN !== null) expect(MAX_SURROUNDS_PER_TURN).toBeGreaterThan(0);
  });
});

describe('rules constants: the board counts agree with each other', () => {
  it('derives the non-goal count from the node and goal counts', () => {
    expect(NON_GOAL_NODE_COUNT).toBe(BOARD_NODE_COUNT - GOAL_NODE_COUNT);
    // The official material states 26 non-goal points; this is the check that the
    // 28-node topology is describing the same board.
    expect(NON_GOAL_NODE_COUNT).toBe(26);
  });

  it('has enough edges to connect every node and stay within the degree bounds', () => {
    expect(BOARD_EDGE_COUNT).toBeGreaterThanOrEqual(BOARD_NODE_COUNT - 1);
    // Sum of degrees is twice the edge count, so the edge count cannot imply an
    // average degree outside the per-node bounds.
    const averageDegree = (2 * BOARD_EDGE_COUNT) / BOARD_NODE_COUNT;
    expect(averageDegree).toBeGreaterThanOrEqual(MIN_NODE_DEGREE);
    expect(averageDegree).toBeLessThanOrEqual(MAX_NODE_DEGREE);
  });
});

describe('rules constants: the condition table is total', () => {
  it('gives a movement ruling for all seven conditions and no others', () => {
    expect(Object.keys(CONDITION_BLOCKS_MP_MOVE).sort()).toEqual([...SPECIAL_CONDITIONS].sort());
  });

  it('blocks movement for at least one condition, or the ruling is doing nothing', () => {
    // If every entry is false the whole ruling has been flattened away, which is a
    // likelier edit accident than a deliberate decision.
    expect(Object.values(CONDITION_BLOCKS_MP_MOVE)).toContain(true);
  });
});

describe('rules constants: the open-ruling registry is auditable', () => {
  const entries = Object.entries(OPEN_RULINGS);

  it('holds every open question', () => {
    expect(entries).toHaveLength(OPEN_RULING_COUNT);
  });

  it('gives each ruling a question, a ruling, a reason and a real confidence level', () => {
    for (const [id, note] of entries) {
      expect(note.question, id).toMatch(/\?$/);
      expect(note.ruling.length, id).toBeGreaterThan(0);
      // A reason that is a restatement of the ruling is useless six months from now,
      // so require it to be substantially longer than the ruling itself.
      expect(note.reason.length, id).toBeGreaterThan(note.ruling.length);
      expect(RULING_CONFIDENCES, id).toContain(note.confidence);
      expect(note.blastRadius.length, id).toBeGreaterThan(0);
    }
  });

  it('cites at least one source and one rejected alternative for each ruling', () => {
    for (const [id, note] of entries) {
      expect(note.evidence.length, id).toBeGreaterThan(0);
      for (const source of note.evidence) expect(RULES_SOURCES, id).toContain(source);
      expect(note.alternatives.length, id).toBeGreaterThan(0);
    }
  });

  it('names constants that this module actually exports', () => {
    // Catches the rename that leaves the audit note pointing at nothing.
    for (const [id, note] of entries) {
      expect(note.constants.length, id).toBeGreaterThan(0);
      for (const name of note.constants) {
        expect(Object.keys(RULES), `${id} -> ${name}`).toContain(name);
      }
    }
  });

  it('never claims a ruling is verified, because a verified question is not open', () => {
    for (const [id, note] of entries) {
      expect(note.confidence, id).not.toBe('verified');
    }
  });
});

describe('rules constants: the contested-field manifest is consistent', () => {
  it('matches its own declared count', () => {
    expect(CONTESTED_FIELDS).toHaveLength(CONTESTED_FIELD_COUNT);
  });

  it('uses well-formed, unique keys', () => {
    const keys = CONTESTED_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^\d+:[a-zA-Z]/);
  });

  it('only overrides fields that are actually contested', () => {
    const known: string[] = CONTESTED_FIELDS.map((f) => f.key);
    for (const key of Object.keys(CONTESTED_FIELD_OVERRIDES)) {
      expect(known, `override for an unflagged field: ${key}`).toContain(key);
    }
  });
});
