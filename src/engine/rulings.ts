/**
 * The boolean rulings, widened from literal types to `boolean`.
 *
 * This module looks pointless and is not. `src/rules/constants.ts` declares things like
 * `export const GOLD_BEATS_BLUE = false`, which TypeScript narrows to the literal type
 * `false`. Any engine code that then writes `if (GOLD_BEATS_BLUE)` is, as far as the
 * compiler is concerned, writing `if (false)` - so the branch is statically dead, the
 * lint rules that catch genuinely dead code fire on it, and the obvious "fix" is to
 * delete the branch and hardcode the current answer.
 *
 * That would be exactly the bug the constants exist to prevent. Six of these are open
 * rulings, one of them at low confidence, and the whole point is that flipping the
 * constant flips the engine. So the values are re-exported here at type `boolean`,
 * which keeps both branches live code, keeps the ruling readable at every call site,
 * and keeps `src/rules/constants.ts` the single place a ruling is ever edited.
 *
 * Nothing here changes a value. If a line in this file ever does anything other than
 * restate its import, that is a bug.
 */
import {
  EQUAL_DAMAGE_IS_DRAW,
  EQUAL_STARS_IS_DRAW,
  GOAL_CAPTURE_REQUIRES_MOVEMENT,
  GOLD_BEATS_BLUE,
  GOLD_BEATS_WHITE,
  INITIATOR_TRIGGERS_FIRST,
  MAX_MARKERS_PER_FIGURE,
  PC_OVERFLOW_IS_FIFO,
  PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY,
  PLATES_ALLOWED_AFTER_MOVING,
  PLATES_ALLOWED_MID_BATTLE,
  SURROUND_CHECKED_AT_END_OF_MOVEMENT,
  TAGGING_ENDS_TURN,
  ULTRA_SPACE_FREEZES_TIMERS,
  VOLUNTARY_PASS_ALLOWED,
  WAIT_TICKS_ON_BOTH_TURNS,
  WINNER_ADVANCES,
} from '../rules/constants.js';

export const goldBeatsBlue: boolean = GOLD_BEATS_BLUE;
export const goldBeatsWhite: boolean = GOLD_BEATS_WHITE;
export const equalDamageIsDraw: boolean = EQUAL_DAMAGE_IS_DRAW;
export const equalStarsIsDraw: boolean = EQUAL_STARS_IS_DRAW;
export const winnerAdvances: boolean = WINNER_ADVANCES;
export const initiatorTriggersFirst: boolean = INITIATOR_TRIGGERS_FIRST;

export const waitTicksOnBothTurns: boolean = WAIT_TICKS_ON_BOTH_TURNS;
export const taggingEndsTurn: boolean = TAGGING_ENDS_TURN;
export const ultraSpaceFreezesTimers: boolean = ULTRA_SPACE_FREEZES_TIMERS;
export const pcOverflowIsFifo: boolean = PC_OVERFLOW_IS_FIFO;

export const goalCaptureRequiresMovement: boolean = GOAL_CAPTURE_REQUIRES_MOVEMENT;
export const surroundCheckedAtEndOfMovement: boolean = SURROUND_CHECKED_AT_END_OF_MOVEMENT;
export const plateCountsAsActionForWaitVictory: boolean = PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY;
export const voluntaryPassAllowed: boolean = VOLUNTARY_PASS_ALLOWED;

export const platesAllowedAfterMoving: boolean = PLATES_ALLOWED_AFTER_MOVING;
export const platesAllowedMidBattle: boolean = PLATES_ALLOWED_MID_BATTLE;

/** Numeric, but narrowed to `1`, which makes "does a new marker replace the old one?" dead code. */
export const maxMarkersPerFigure: number = MAX_MARKERS_PER_FIGURE;
