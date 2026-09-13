/**
 * Hand-verified compiler cases.
 *
 * The coverage test only proves text parsed into *something*; it cannot tell a correct
 * parse from a confident wrong one. Every case below was read against the real card and
 * asserts the specific structure the engine will act on, so a regression that keeps
 * coverage flat while corrupting meaning still fails.
 */
import { describe, expect, it } from 'vitest';
import { compileClause, compileEffect, normalize, parseSelector, parseSpinPredicate, splitClauses } from './compile.js';

describe('normalisation', () => {
  it('folds the Unicode punctuation both wikis mix', () => {
    // Bulbapedia writes "MP -2" with U+2212 and "40x" with U+00D7.
    expect(normalize('MP \u22122 marker')).toBe('MP -2 marker');
    expect(normalize('power 40\u00D7')).toBe('power 40x');
  });

  it("strips Serebii's leaked MediaWiki link templates", () => {
    // 160 clauses carried this artifact, hiding otherwise ordinary condition text.
    expect(normalize('The battle opponent becomes Special Condition|poisoned'))
      .toBe('The battle opponent becomes poisoned');
  });

  it('treats "faint" and "knocked out" as one mechanic', () => {
    expect(normalize('This Pokémon faints')).toBe('This Pokémon is knocked out');
  });
});

describe('clause splitting', () => {
  it('does not split on the period inside "P.C."', () => {
    // This bug produced orphan fragments like "to the bench" that could never compile.
    const parts = splitClauses('The battle opponent moves to your P.C. after battle.');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('P.C.');
  });

  it('splits genuine sentence boundaries', () => {
    expect(splitClauses('All opposing Pokémon on the field spin. Those that spin White Attacks move to the bench.'))
      .toHaveLength(2);
  });

  it('splits a parenthetical after a period so Double Chance is not one sentence', () => {
    expect(
      splitClauses(
        'Choose a Pokémon on the field or bench. (You cannot select unusable Pokémon) For this turn, you can choose to respin once for it.',
      ),
    ).toEqual([
      'Choose a Pokémon on the field or bench. (You cannot select unusable Pokémon)',
      'For this turn, you can choose to respin once for it',
    ]);
  });

  it('splits Lunar Dance\'s "and moves all your" without breaking Waterfall*', () => {
    expect(splitClauses(
      'Removes the asleep condition from your Pokémon and moves all your Pokémon that are in a P.C. to the bench.',
    )).toHaveLength(2);
    expect(splitClauses(
      'If the battle opponent is a Water Pokémon, this Pokémon takes no damage and moves to a spot beyond the battle opponent.',
    )).toHaveLength(1);
  });
});

describe('selector parsing', () => {
  it('builds a union for "the battle opponent and opposing Pokémon within 2 steps of it"', () => {
    // 81 clauses use this exact shape; flattening it would mistarget the radius.
    const sel = parseSelector('The battle opponent and opposing Pokémon within 2 steps of it');
    expect(sel.kind).toBe('union');
    if (sel.kind !== 'union') return;
    expect(sel.of[0]).toEqual({ kind: 'battleOpponent' });

    const second = sel.of[1];
    expect(second?.kind).toBe('all');
    if (second?.kind !== 'all') return;
    expect(second.where).toEqual(expect.arrayContaining([
      { kind: 'allegiance', of: 'opposing' },
      { kind: 'within', steps: 2, of: { kind: 'antecedent' } },
    ]));
  });

  it('excludes the source for "other than this Pokémon"', () => {
    const sel = parseSelector('Any Pokémon adjacent to the battle opponent other than this Pokémon');
    expect(sel.kind).toBe('except');
    if (sel.kind !== 'except') return;
    expect(sel.remove).toEqual({ kind: 'self' });
  });

  it('distinguishes a choice from the whole set', () => {
    expect(parseSelector('All opposing Pokémon on the field').kind).toBe('all');
    expect(parseSelector('An opposing Pokémon within 2 steps').kind).toBe('choose');
  });

  it('keeps "exactly N steps away" separate from "within N steps"', () => {
    // These are different board relations and conflating them mistargets 114 clauses.
    const exact = parseSelector('a Pokémon 3 steps away');
    const within = parseSelector('a Pokémon within 3 steps');
    const exactFilter = exact.kind === 'choose' ? exact.where[0] : undefined;
    const withinFilter = within.kind === 'choose' ? within.where[0] : undefined;
    expect(exactFilter?.kind).toBe('stepsAway');
    expect(withinFilter?.kind).toBe('within');
  });
});

describe('spin predicates', () => {
  it('keeps the damage threshold on the branch that carries it', () => {
    // "a Miss or a White Attack of 120 damage or more" - 60 clauses. The Miss branch has
    // no threshold; applying 120 to both would spare Misses it should knock out.
    const p = parseSpinPredicate('a Miss or a White Attack of 120 damage or more');
    expect(p.kind).toBe('anyOf');
    if (p.kind !== 'anyOf') return;
    expect(p.of).toEqual([
      { kind: 'color', colors: ['miss'] },
      { kind: 'damage', colors: ['white'], op: 'gte', value: 120 },
    ]);
  });

  it('reads a repeat-until-miss loop as a move identity test', () => {
    expect(parseSpinPredicate('Spin again until Pin Missile does not land'))
      .toEqual({ kind: 'move', names: ['pin missile'] });
  });
});

describe('triggers and guards', () => {
  it('treats "if this Pokémon is knocked out" as a trigger, not a condition', () => {
    // As a guard this would never fire - the figure is already gone when it is checked.
    const c = compileClause('* If this Pokémon is knocked out, the battle opponent becomes burned.');
    expect(c.trigger).toBe('onSelfKnockedOut');
    expect(c.actions[0]).toEqual({
      do: 'applyCondition',
      target: { kind: 'battleOpponent' },
      condition: 'burned',
    });
  });

  it('retimes a clause that trails "after battle"', () => {
    const c = compileClause('This Pokémon moves to a point 2 steps away after battle.');
    expect(c.trigger).toBe('afterBattle');
    expect(c.actions[0]?.do).toBe('move');
  });

  it('captures a guard that trails its action', () => {
    // Discarding this applied the bonus unconditionally - wrong on 8 clauses.
    const c = compileClause('Deals +50 damage if the battle opponent is a Dragon Pokémon.');
    expect(c.actions[0]).toMatchObject({ do: 'modifyDamage', modifier: { kind: 'flat', amount: 50 } });
    expect(c.when[0]).toEqual({
      kind: 'hasType',
      target: { kind: 'battleOpponent' },
      types: ['Dragon'],
    });
  });

  it('marks a passive aura as such', () => {
    expect(compileClause('While this Pokémon is on the field, Steel-type Pokémon deal +20 damage.').trigger)
      .toBe('passive');
  });
});

describe('markers and MP', () => {
  it('reads "gains Wait 3" with its magnitude', () => {
    const c = compileClause('This Pokémon gains Wait 3.');
    expect(c.actions[0]).toEqual({
      do: 'attachMarker', target: { kind: 'self' }, marker: 'wait', value: 3, duration: { kind: 'instant' },
    });
  });

  it('reads a bare "gains Wait" as having no magnitude', () => {
    const c = compileClause('The battle opponent gains Wait.');
    expect(c.actions[0]).toMatchObject({ marker: 'wait', value: null, target: { kind: 'battleOpponent' } });
  });

  it('turns an MP marker into a signed delta', () => {
    const c = compileClause('Attaches an MP -2 marker to opposing Pokémon within 2 steps.');
    expect(c.actions[0]).toMatchObject({ do: 'modifyMp', delta: -2 });
  });

  it('accepts the long tail of named markers without a closed union', () => {
    // Modelling markers as a 7-member enum would have rejected these outright.
    for (const [text, id] of [
      ['Attaches a Cracked marker to the battle opponent.', 'cracked'],
      ['Attach a Curse marker to the battle opponent.', 'curse'],
      ['This Pokémon may attach a Photon marker to the battle opponent.', 'photon'],
      ['Attaches a Final Song marker to this Pokémon.', 'finalSong'],
      ['This Pokémon gains a Charge marker.', 'charge'],
    ] as const) {
      const action = compileClause(text).actions[0];
      const inner = action?.do === 'optional' ? action.then[0] : action;
      expect(inner).toMatchObject({ do: 'attachMarker', marker: id });
    }
  });
});

describe('parity expansions', () => {
  it('compiles mutual knockout as an onSelfKnockedOut knock-out', () => {
    const c = compileClause('If this Pokémon is knocked out, so is the battle opponent.');
    expect(c.trigger).toBe('onSelfKnockedOut');
    expect(c.actions[0]).toMatchObject({ do: 'knockOut', target: { kind: 'battleOpponent' } });
  });

  it('compiles "no longer asleep" onto the antecedent', () => {
    expect(compileClause('That Pokémon is no longer asleep.').actions[0]).toMatchObject({
      do: 'cureConditions',
      conditions: ['asleep'],
    });
  });

  it('compiles form change and primal reversion', () => {
    expect(compileClause('Change its form to Sky Forme.').actions[0]).toMatchObject({
      do: 'changeForm',
      into: ['Sky Forme'],
    });
    expect(compileClause('It undergoes Primal Reversion.').actions[0]).toMatchObject({
      do: 'changeForm',
      into: ['Primal'],
    });
  });

  it('does not treat "if possible" as a guard', () => {
    const c = compileClause('This Pokémon must battle if possible after making an MP move.');
    expect(c.when).toEqual([]);
    expect(c.actions[0]?.do).toBe('forceBattle');
  });

  it('reads "not affected by a special condition"', () => {
    const c = compileClause('Deals +20 damage if this Pokémon is not affected by a special condition.');
    expect(c.when[0]?.kind).toBe('not');
  });

  it('compiles open-spot leaps after stripping you-can', () => {
    const inner = compileClause('You can move this Pokémon to an open spot next to an adjacent figure (or adjacent figures in succession to the first).').actions[0];
    const action = inner?.do === 'optional' ? inner.then[0] : inner;
    expect(action).toMatchObject({ do: 'move', to: { kind: 'openSpotAdjacentTo' } });
  });

  it('compiles Goal Block as a choose-and-move onto your goal when open', () => {
    const c = compileClause('Choose one of your Pokémon on the field and move it to your goal point if it is open.');
    expect(c.when[0]).toEqual({ kind: 'goalOpen', whose: 'controller' });
    expect(c.actions[0]).toMatchObject({ do: 'move', to: { kind: 'goal' } });
  });

  it('compiles Quick Care\'s P.C. move with a capacity guard', () => {
    const c = compileClause('If there is space in your P.C., move it there.');
    expect(c.when[0]).toEqual({ kind: 'pcHasSpace', whose: 'controller' });
    expect(c.actions[0]).toMatchObject({ do: 'move', to: { kind: 'zone', zone: 'pc' } });
  });

  it('compiles Drive miss-shift without stealing the if as a dead guard', () => {
    const c = compileClause('During this turn, if your Pokémon\'s move lands on miss, it will shift to the move next to it instead.');
    expect(c.when.every((cond) => cond.kind !== 'unimplemented')).toBe(true);
    expect(c.actions[0]).toMatchObject({ do: 'shiftSpinResult' });
  });

  it('transfers a special condition instead of inventing poison', () => {
    expect(compileClause('If this Pokémon has a special condition, that condition is applied to its battle opponent and removed from this Pokémon instead.').actions[0])
      .toMatchObject({ do: 'transferConditions' });
  });

  it('locks the goal and fills half the Z-gauge', () => {
    expect(compileClause('This Pokémon cannot win you the duel by moving to the goal point.').actions[0])
      .toMatchObject({ do: 'lockGoal', locked: true });
    expect(compileClause('Increases your Z-Move gauge by half its max value.').actions[0])
      .toMatchObject({ do: 'adjustZGauge', fractionOfMax: 0.5 });
  });

  it('does not invent marker names from "Pokémon with that marker"', () => {
    const c = compileClause('The Pokémon with that marker is knocked out.');
    expect(c.actions[0]).toMatchObject({ do: 'knockOut' });
    const gaps = JSON.stringify(c);
    expect(gaps).not.toContain('monWithThat');
  });
});

describe('the two-clause spin idiom', () => {
  it('folds the follow-up into the spin check rather than leaving it orphaned', () => {
    // 314 spin checks feed 378 follow-ups. As siblings, the second clause has no
    // referent; nesting keeps each clause a pure function of its own inputs.
    const clauses = compileEffect(
      'All opposing Pokémon on the field spin. Those that spin White Attacks move to the bench.',
    );
    expect(clauses).toHaveLength(1);

    const action = clauses[0]?.actions[0];
    expect(action?.do).toBe('spinCheck');
    if (action?.do !== 'spinCheck') return;
    expect(action.then).toHaveLength(1);
    expect(action.then[0]?.actions[0]).toMatchObject({ do: 'move' });
  });

  it('does not fold an unrelated following clause', () => {
    const clauses = compileEffect('All opposing Pokémon on the field spin. Your turn ends.');
    expect(clauses).toHaveLength(2);
    expect(clauses[1]?.actions[0]).toEqual({ do: 'endTurn' });
  });
});

describe('optionality and player decisions', () => {
  it('wraps "you may" so the engine raises a decision instead of auto-resolving', () => {
    const c = compileClause('You may move this Pokémon to the bench.');
    expect(c.actions[0]?.do).toBe('optional');
    if (c.actions[0]?.do !== 'optional') return;
    expect(c.actions[0].then[0]).toMatchObject({ do: 'move' });
  });
});

describe('plate choose-then-it', () => {
  it('binds Double Chance\'s respin to the chosen figure, not an optional prompt', () => {
    const clauses = compileEffect(
      'Choose a Pokémon on the field or bench. (You cannot select unusable Pokémon) For this turn, you can choose to respin once for it.',
    );
    const live = clauses.filter((clause) => clause.trigger !== 'usageRestriction');
    expect(live).toHaveLength(1);
    expect(live[0]?.actions[0]?.do).toBe('select');
    expect(live[0]?.actions.some((action) => action.do === 'respin')).toBe(true);
    expect(live[0]?.actions.some((action) => action.do === 'optional')).toBe(false);
  });

  it('binds X Attack\'s +30 to the chosen figure, not self', () => {
    const clauses = compileEffect(
      'Choose one of your Pokémon on the field or bench. For this turn, it deals +30 damage',
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.actions[0]?.do).toBe('select');
    expect(clauses[0]?.actions[1]).toMatchObject({
      do: 'modifyDamage',
      target: { kind: 'antecedent' },
      modifier: { kind: 'flat', amount: 30 },
    });
  });
});

describe('plate usage restrictions', () => {
  it('hoists playability out of the effect list', () => {
    // 33 clauses. These are preconditions on playing the plate, not effects.
    const c = compileClause('This plate can be used when none of your Pokémon are Mega Evolved.');
    expect(c.trigger).toBe('usageRestriction');
    expect(c.actions[0]).toEqual({ do: 'usageGate' });
    expect(c.when[0]).toMatchObject({ kind: 'targetCount', op: 'eq', value: 0 });
  });
});

describe('damage shapes', () => {
  it('scales a multiplier off a spin tally', () => {
    const c = compileClause('Spin again until Bullet Seed does not land - damage is multiplied by the number of Bullet Seed spins.');
    expect(c.actions[0]).toMatchObject({ do: 'respin' });
  });

  it('scales a multiplier off a board count', () => {
    // Not every multiplier is a spin tally; 6 clauses count figures instead.
    const c = compileClause('Damage is multiplied by the number of your own Pokémon on the field.');
    expect(c.actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'multiplyByCount', of: { kind: 'figures' } },
    });
  });
});

describe('refused-plate leftovers', () => {
  const actionsOf = (text: string) => compileEffect(text).flatMap((clause) => clause.actions);
  const kinds = (text: string) => actionsOf(text).map((action) => action.do);

  it('compiles Ballast as a named Whirlwind prevent', () => {
    const c = compileClause('Choose one of your Pokémon on the field. For this turn, it cannot be affected by Whirlwind.');
    expect(c.actions.some((action) => action.do === 'prevent' || action.do === 'select')).toBe(true);
    const effect = compileEffect('Choose one of your Pokémon on the field. For this turn, it cannot be affected by Whirlwind.');
    expect(JSON.stringify(effect)).toContain('Whirlwind');
    expect(JSON.stringify(effect)).toContain('namedEffect');
  });

  it('compiles DNA Splicers and Necroizer from printed names only', () => {
    const dna = compileEffect(
      'Choose one of your Kyurem on the field, and one of your Zekrom or Reshiram on the field or bench in the P.C.. Exclude that Zekrom or Reshiram from the duel, and change form of Kyurem to Black Kyurem or White Kyurem.',
    );
    expect(dna[0]?.actions[0]).toMatchObject({
      do: 'fuse',
      materialTo: 'excluded',
      intoByMaterial: [['Zekrom', 'Black Kyurem'], ['Reshiram', 'White Kyurem']],
    });
    const necro = compileEffect(
      'Choose one of your Necrozma on the field and one of your Solgaleo or Lunala on the field, bench or in the P.C. That Solgaleo or Lunala moves to the Ultra Space and the Necrozma changes its form into Dusk Mane Necrozma or Dawn Wings Necrozma',
    );
    expect(necro[0]?.actions[0]).toMatchObject({
      do: 'fuse',
      materialTo: 'ultraSpace',
      intoByMaterial: [['Solgaleo', 'Dusk Mane Necrozma'], ['Lunala', 'Dawn Wings Necrozma']],
    });
  });

  it('compiles collide knockback, Frost Sphere, Reveal recycle, and X+1 within', () => {
    expect(compileClause('Any Pokémon it collides with are also knocked back.').actions[0]).toMatchObject({
      do: 'move',
      to: { kind: 'knockBack', collide: true },
    });
    expect(kinds(
      'Until the end of the duel, plates with Sphere in their name, except for Frost Sphere, have their effects negated on opposing Pokémon within 3 steps of that Pokémon.',
    )).toContain('nullify');
    const reveal = compileEffect(
      'This plate can be used again if the opponent uses a plate that is not Reveal Glass.',
    );
    expect(reveal[0]?.trigger).toBe('onPlatePlayed');
    expect(reveal[0]?.when[0]).toMatchObject({ kind: 'plateJustPlayed', match: 'ne' });
    const within = parseSelector('an opposing Pokémon within X+1 steps');
    expect(JSON.stringify(within)).toContain('plusZone');
  });

  it('compiles start-of-duel reset excluding evolution', () => {
    expect(compileClause(
      'The battle opponent returns to their start-of-the-duel state, excluding evolution and any special conditions.',
    ).actions[0]).toMatchObject({ do: 'resetToStart', keepEvolution: true, keepConditions: true });
  });

  it('keeps Lunar Dance on this Pokémon, not the whole board', () => {
    const clauses = compileEffect(
      'Removes the asleep condition from your Pokémon and moves all your Pokémon that are in a P.C. to the bench. Then, this Pokémon moves to your P.C.',
    );
    expect(clauses.some((clause) =>
      clause.actions.some((action) =>
        action.do === 'move' && action.to.kind === 'zone' && action.to.zone === 'bench',
      ),
    )).toBe(true);
    const toPc = clauses.flatMap((clause) => clause.actions).filter((action) =>
      action.do === 'move' && action.to.kind === 'zone' && action.to.zone === 'pc',
    );
    expect(toPc).toHaveLength(1);
    expect(toPc[0]).toMatchObject({ target: { kind: 'self' } });
  });

  it('compiles Power Battle as a forced both-side respin', () => {
    const effect = compileEffect(
      'Choose one of your Pokémon on the field or bench. For this turn, if this Pokémon or its opponent spins a Purple Attack in battle, they must both spin once again.',
    );
    const armed = effect.flatMap((clause) => clause.actions).find((action) => action.do === 'armTrigger');
    expect(armed).toMatchObject({
      do: 'armTrigger',
      then: [{ do: 'respin', forced: true, who: 'both' }],
    });
  });

  it('compiles Phantom Energy as over-conditions only, not every figure', () => {
    const c = compileClause(
      'During this duel, your Ghost-type Pokémon can move over Pokémon affected by special conditions when using an MP move.',
    );
    expect(c.actions[0]).toMatchObject({
      do: 'grantMovement',
      grant: 'overOthers',
      over: { kind: 'all', where: [{ kind: 'hasCondition' }] },
    });
  });

  it('compiles Waterfall* as incoming none plus a beyond-opponent move', () => {
    const c = compileClause(
      'If the battle opponent is a Water Pokémon, this Pokémon takes no damage and moves to a spot beyond the battle opponent.',
    );
    expect(c.when[0]).toMatchObject({ kind: 'hasType', types: ['Water'] });
    expect(c.actions[0]).toMatchObject({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'none' },
    });
    expect(c.actions[1]).toMatchObject({
      do: 'move',
      to: { kind: 'beyond', over: { kind: 'battleOpponent' } },
    });
  });

  it('compiles the high-frequency leftover dodge, evolve, and aura phrases', () => {
    expect(compileClause(
      'If this Pokémon is attacked, it can move under the opponent\'s Pokémon to another space next to it.',
    )).toMatchObject({
      trigger: 'onAttacked',
      actions: [{ do: 'move', to: { kind: 'openSpotAdjacentTo', of: { kind: 'battleOpponent' } } }],
    });
    expect(compileClause('(A battle does not occur.)').actions[0]).toMatchObject({ do: 'tag', tag: 'noBattle' });
    expect(compileClause('After this Pokémon battles, it may evolve if it\'s on the field')).toMatchObject({
      trigger: 'afterBattle',
      actions: [{ do: 'optional', then: [{ do: 'evolve' }] }],
    });
    expect(compileClause(
      'If the battle opponent is knocked out, this Pokémon moves to a spot 2 steps away, after the battle.',
    )).toMatchObject({
      trigger: 'onOpponentKnockedOut',
      actions: [{ do: 'move', to: { kind: 'pointStepsAway', steps: 2 } }],
    });
    expect(compileClause(
      'When this Pokémon is on the field, all poisoned Pokémon will do a further -20 damage.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'flat', amount: -20 },
    });
    expect(compileClause(
      'The damage dealt to this Pokémon by its battle opponents (excluding Fire Pokémon) is cut in half.',
    )).toMatchObject({
      trigger: 'passive',
      when: [{ kind: 'not', of: { kind: 'hasType', types: ['Fire'] } }],
      actions: [{ do: 'modifyDamage', target: { kind: 'battleOpponent' }, modifier: { kind: 'multiply', factor: 0.5 } }],
    });
    expect(compileClause(
      'Opposing Pokémon next to this Pokémon cannot make MP moves.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'mpMove' });
    expect(compileClause(
      'Before using this Pokémon, you can switch its position with another one of your own Pokémon in an adjacent space.',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'swapWith' } }],
    });
    expect(compileClause('This Pokémon switches with its battle opponent.').actions[0]).toMatchObject({
      do: 'move',
      target: { kind: 'self' },
      to: { kind: 'swapWith', with: { kind: 'battleOpponent' } },
    });
    expect(compileClause(
      'If this Pokémon is on the field, it may switch with a Pokémon on your bench or in your P.C. after battle.',
    )).toMatchObject({
      trigger: 'afterBattle',
      actions: [{ do: 'optional', then: [{ do: 'move', to: { kind: 'swapWith' } }] }],
    });
    const emergency = compileEffect(
      'When this Pokémon is attacked, it may switch with a Pokémon on your bench that is neither Wimpod nor Golisopod (no battles are triggered). If it does, this Pokémon and the Pokémon that it switched with both gain Wait.',
    );
    expect(emergency[0]).toMatchObject({ trigger: 'onAttacked' });
    expect(emergency[0]?.actions.some((action) => action.do === 'optional')).toBe(true);
    expect(JSON.stringify(emergency)).toMatch(/noBattle/);
    expect(JSON.stringify(emergency)).toMatch(/"do":"attachMarker"/);
    const swarm = compileEffect(
      'At the start of your turn, instead of an MP move, this Pokémon may move one of your Ledyba or Ledian on the field next to itself. If opposing Pokémon do not occupy all of your entry points, you may move one of your Ledyba or Ledian on the bench next to this Pokémon. In either case, your turn ends.',
    );
    expect(swarm).toHaveLength(2);
    expect(swarm.every((clause) => clause.actions.some((action) => action.do === 'move'))).toBe(true);
    expect(swarm.every((clause) => clause.actions.some((action) => action.do === 'endTurn'))).toBe(true);
    expect(swarm.every((clause) => /instead of an mp move/i.test(clause.source))).toBe(true);
  });

  it('compiles the leftover verbs that needed new primitives', () => {
    expect(compileClause('This Pokémon can move up to 2 steps in a straight line.')).toMatchObject({
      trigger: 'passive',
      actions: [{ do: 'grantStraightMp', steps: 2 }],
    });
    expect(compileClause(
      'If there are other Pokémon on your bench, this Pokémon cannot enter the field using an MP move.',
    )).toMatchObject({
      trigger: 'passive',
      when: [{ kind: 'targetExists' }],
      actions: [{ do: 'denyDeploy' }],
    });
    expect(compileClause(
      'If it changes its form, until the end of your next turn, any effects of its battle opponent\'s Ability that would increase damage decrease that damage instead.',
    ).actions[0]).toMatchObject({ do: 'invertAbilityIncreases' });
    expect(compileClause(
      'This Pokémon\'s Ember gains +20 damage for each Pokémon in your P.C.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      named: 'Ember',
      modifier: { kind: 'flatByCount', amount: 20 },
    });
    expect(compileClause(
      'The battle opponent of this Pokémon cannot move by effects other than the Attacks of this Pokémon until the end of battle.',
    )).toMatchObject({
      trigger: 'duringBattle',
      actions: [{ do: 'restrictMoves' }],
    });
    expect(compileClause(
      'The marker and any special conditions on this Pokémon are removed instead of it being knocked out.',
    ).actions[0]).toMatchObject({ do: 'surviveByClearing' });
    expect(compileClause(
      'When this Pokémon is on the field, at the start of your turn, your Ultra Beasts on the field are treated as though they have newly moved to the field (any special conditions and markers remain).',
    )).toMatchObject({
      trigger: 'startOfTurn',
      actions: [{ do: 'treatAsNewlyMoved' }],
    });
    expect(compileClause(
      'While this Pokémon is on the field, this Pokémon\'s type becomes the type of the chosen Pokémon.',
    ).actions[0]).toMatchObject({ do: 'copyType', from: { kind: 'antecedent' } });
    expect(compileClause(
      'Move one other Steel Pokémon within 2 steps of this Pokémon to a point not more than 1 or 2 steps away from this Pokémon.',
    ).actions[0]).toMatchObject({
      do: 'move',
      to: { kind: 'pointWithinSteps', min: 1, max: 2 },
    });
    const repeated = compileEffect(
      'If there are any Pokémon in the Ultra Space, an opposing Pokémon on the field spins. If it spins a White Attack, it becomes paralyzed. Repeat this effect for each Pokémon in the Ultra Space.',
    );
    expect(repeated[0]?.actions[0]).toMatchObject({
      do: 'repeatFor',
      then: [{ do: 'spinCheck' }],
    });
    expect(compileClause(
      'This Pokémon is knocked out if the opponent\'s Attack deals more than half the damage that this Pokémon\'s Attack deals.',
    )).toMatchObject({
      when: [{ kind: 'opponentDamageVsSelf', op: 'gt', fraction: 0.5 }],
      actions: [{ do: 'knockOut' }],
    });
    expect(compileClause(
      'If it passes through Poisoned, noxious, or sleeping Pokémon, they will faint.',
    )).toMatchObject({
      trigger: 'afterMove',
      when: [{ kind: 'passedThrough', conditions: ['poisoned', 'noxious', 'asleep'] }],
      actions: [{ do: 'knockOut' }],
    });
    const slippery = compileClause(
      'Just once, before this Pokémon would be surrounded, it may switch places with an adjacent Pokémon.',
    );
    expect(slippery).toMatchObject({
      trigger: 'onSurrounded',
      actions: [{
        do: 'optional',
        then: [
          { do: 'move', target: { kind: 'self' }, to: { kind: 'swapWith' } },
          { do: 'spendOnce' },
        ],
      }],
    });
    expect(slippery.actions[0]?.do === 'optional' && slippery.actions[0].then[0]?.do === 'unimplemented').toBe(false);
    const slipMove = slippery.actions[0]?.do === 'optional' ? slippery.actions[0].then[0] : slippery.actions[0];
    expect(slipMove).toMatchObject({
      do: 'move',
      to: { kind: 'swapWith', with: { kind: 'choose', count: 1 } },
    });
  });

  it('compiles the leftover soar / draw-closer / spin / MP-range verbs', () => {
    expect(compileClause(
      'If this Pokémon is not affected by a special condition, it may MP move over Pokémon on the field that don\'t have Soar.',
    )).toMatchObject({
      trigger: 'passive',
      when: [{ kind: 'not', of: { kind: 'hasCondition' } }],
      actions: [{ do: 'grantMovement', grant: 'overOthers' }],
    });
    const drawn = compileClause(
      'One Pokémon within 3 steps\' range is drawn 1-2 steps closer to this Pokémon and is given an MP -1 Marker.',
    );
    expect(drawn.actions[0]).toMatchObject({ do: 'move', to: { kind: 'drawCloser', min: 1, max: 2 } });
    expect(drawn.actions[1]).toMatchObject({ do: 'modifyMp', delta: -1 });
    expect(compileClause('The Attack that is spun takes the place of this Attack.').actions[0]).toMatchObject({
      do: 'replaceSegment',
      moveName: '*spun*',
    });
    expect(compileClause(
      'When this Pokémon (or a Pokémon that evolved from this Pokémon) leaves the field, return as many plates as were switched to used with this Attack since this Pokémon entered the field back to unused.',
    )).toMatchObject({
      actions: [{ do: 'armTrigger', trigger: 'onLeaveField', then: [{ do: 'refreshPlate', accounted: true }] }],
    });
    expect(compileClause(
      'After moving, this Pokémon may attack an opposing Pokémon again, but just once.',
    )).toMatchObject({
      trigger: 'onAttackResolve',
      actions: [{ do: 'optional', then: [{ do: 'grantExtraBattle' }, { do: 'spendOnce' }] }],
    });
    expect(compileClause('Both Pokémon spin twice.')).toMatchObject({
      trigger: 'duringBattle',
      actions: [{ do: 'respin', forced: true, who: 'both' }],
    });
    expect(compileClause(
      'If the battle opponent spins the same Attack both times, it misses.',
    )).toMatchObject({
      trigger: 'duringBattle',
      when: [{ kind: 'sameAttackBothTimes' }],
      actions: [{ do: 'replaceSegment', moveName: 'Miss' }],
    });
    expect(compileClause(
      'Switches this Pokémon for one of your Pokémon on the field, bench, or in a P.C.',
    ).actions[0]).toMatchObject({
      do: 'move',
      to: { kind: 'swapWith' },
    });
    expect(compileClause(
      'One other Water Pokémon on the field (that is not asleep or frozen) may be moved within their MP range.',
    )).toMatchObject({
      actions: [{ do: 'optional', then: [{ do: 'move', to: { kind: 'withinMpRange' } }] }],
    });
    expect(compileClause(
      'You may move one of your Combee on the field next to this Pokémon.',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'openSpotAdjacentTo' } }],
    });
    expect(compileClause(
      'One of your Seismitoad, Palpitoad, or Tympole (that is not asleep or frozen) may be moved within their MP range.',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'withinMpRange' } }],
    });
    expect(compileClause(
      'If there are Pokémon at three entry points, switch this Pokémon with another Pokémon on the field.',
    )).toMatchObject({
      when: [{ kind: 'targetCount', op: 'gte', value: 3 }],
      actions: [{ do: 'move', to: { kind: 'swapWith' } }],
    });
    expect(compileClause(
      'If the battle opponent is knocked out, move the Pokémon adjacent to the battle opponent (excluding this one) to their bench.',
    )).toMatchObject({
      trigger: 'onOpponentKnockedOut',
      actions: [{ do: 'move', to: { kind: 'zone', zone: 'bench' } }],
    });
    expect(compileClause('This Pokémon cannot battle.')).toMatchObject({
      trigger: 'passive',
      actions: [{ do: 'prevent', what: 'attack' }],
    });
    expect(compileClause(
      'If this Pokémon has a special condition, this Attack\'s damage is cut in half',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'multiply', factor: 0.5 },
    });
    expect(compileClause('Spin for adjacent opposing Pokémon.').actions[0]).toMatchObject({
      do: 'spinCheck',
    });
    expect(compileClause(
      'If the battle opponent is knocked out, then, after the battle, this Pokémon moves to the point the battle opponent was on.',
    )).toMatchObject({
      trigger: 'onOpponentKnockedOut',
      actions: [{ do: 'move', to: { kind: 'vacatedBy' } }],
    });
    expect(compileClause('Can MP move past burned Pokémon.')).toMatchObject({
      trigger: 'passive',
      actions: [{ do: 'grantMovement', grant: 'throughOthers' }],
    });
  });

  it('compiles the frequency-1 leftovers as real verbs', () => {
    expect(compileClause(
      'If this Pokémon has evolved, this effect repeats for each time this Pokémon has evolved.',
    ).actions[0]).toMatchObject({ do: 'repeatTimes', times: { kind: 'evolutionCount' } });
    expect(compileClause(
      'Until the end of the duel, this Pokémon\'s MP becomes 3 and its Blue Attacks becomes Misses.',
    ).actions.map((action) => action.do)).toEqual(['setMp', 'recolorAttacks']);
    expect(compileClause(
      'You may move one of your Pokémon in Ultra Space or one of your Solgaleo or Lunala next to this Pokémon.',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'openSpotAdjacentTo' } }],
    });
    expect(compileClause(
      'One Bug Pokémon on the field, or one other Pokémon within 3 steps, moves 1 step.',
    ).actions[0]).toMatchObject({ do: 'move', to: { kind: 'pointStepsAway', steps: 1 } });
    expect(compileClause(
      'A Pokémon with this marker attached can only be used by its opposing player (MP moves only).',
    ).actions[0]).toMatchObject({ do: 'tag', tag: 'opposingPlayerMp' });
    expect(compileClause('This marker can be removed by tagging.').actions[0]).toMatchObject({
      do: 'tag',
      tag: 'tagRemove',
    });
    expect(compileClause(
      'This Attack\'s damage is boosted by the amount of any Attack damage increases from the battle opponent\'s Ability.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'copyAbilityIncreases' },
    });
    const full = compileEffect(
      'Attaches a Full marker to this Pokémon. While that marker is attached to it, this Pokémon is not knocked out by damage from White Attacks. The marker and any special conditions affecting this Pokémon are removed instead of it being knocked out.',
    );
    expect(full.some((clause) => clause.actions.some((action) => action.do === 'attachMarker'))).toBe(true);
    expect(full.some((clause) =>
      clause.actions.some((action) => action.do === 'surviveByClearing' && action.vs === 'whiteDamage'),
    )).toBe(true);
    expect(full.every((clause) => clause.actions.every((action) => action.do !== 'unimplemented'))).toBe(true);
    expect(compileClause(
      'The battle opponent\'s Metal Coat effects are lost, and Metal Coat counts as having been used.',
    ).actions[0]).toMatchObject({ do: 'nullifyInUsePlate', nameIncludes: 'Metal Coat' });
    expect(compileClause(
      'This does not cause it to return to its previous Evolution.',
    ).actions[0]).toMatchObject({ do: 'tag', tag: 'noDevolve' });
    expect(compileClause(
      'If any Sphere plates have been used on the battle opponent, then this Pokémon also gains those effects until the end of the duel.',
    ).actions[0]).toMatchObject({ do: 'copyPlateEffects', nameIncludes: 'Sphere' });
    expect(compileClause(
      'Moves one opposing Pokémon in the Ultra Space to a point of your choosing on the field.',
    ).actions[0]).toMatchObject({ do: 'move', to: { kind: 'anyOpenField' } });
    expect(compileClause(
      'This Pokémon moves to the Ultra Space outside of the field and one of your Pokémon that is in the Ultra Space moves to a point 2 or 3 steps away.',
    ).actions.map((action) => action.do)).toEqual(['move', 'move']);
    expect(compileClause(
      'An opposing Pokémon within X+1 steps spins, where X is the number of Pokémon in the Ultra Space.',
    ).actions[0]).toMatchObject({ do: 'spinCheck' });
    expect(compileClause(
      'Any opposing Pokémon with a marker that reduces MP is now burned.',
    ).actions[0]).toMatchObject({ do: 'applyCondition', condition: 'burned' });
    expect(compileClause(
      'If your opponent spins a Purple Attack, you can force them to respin once a turn.',
    )).toMatchObject({
      trigger: 'duringBattle',
      actions: [{ do: 'optional', then: [{ do: 'respin', forced: true, oncePerTurn: true }] }],
    });
    expect(compileClause(
      'If the battle opponent spins an Attack of 10 or more damage, you may force them to respin but only once per turn.',
    ).actions[0]).toMatchObject({ do: 'optional', then: [{ do: 'respin', oncePerTurn: true }] });
    expect(compileClause(
      'At the start of your turn, instead of using an MP move, this Pokémon can route move to a point that is three steps away and adjacent to an opponent\'s Pokémon.',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'route', minSteps: 3, maxSteps: 3 } }],
    });
    expect(compileClause(
      'When moving this Pokémon from the bench, it can only move to one space away from the entry point.',
    ).actions[0]).toMatchObject({ do: 'restrictDeploy' });
    expect(compileClause(
      'When in a P.C., this Pokémon will move back to the bench if Sweet Scent is spun on the field.',
    )).toMatchObject({
      trigger: 'onNamedSpin',
      when: [
        { kind: 'inZone', target: { kind: 'self' }, zones: ['pc'] },
        { kind: 'namedAttackSpun', names: ['Sweet Scent'] },
      ],
      actions: [{ do: 'move', to: { kind: 'zone', zone: 'bench' } }],
    });
    expect(compileClause(
      'Any opposing Pokémon that has used an MP move to move next to this Pokémon must attack it on that turn, if possible.',
    ).actions[0]).toMatchObject({ do: 'forceBattle', against: { kind: 'self' } });
    expect(compileClause(
      'If it does, this Pokémon counts as having already battled.',
    ).actions[0]).toMatchObject({ do: 'markBattled' });
    expect(compileClause(
      'While this Pokémon is on the field, opposing Ghost Pokémon cannot use the effect of an Ability to pass through your Dark Pokémon.',
    ).actions[0]).toMatchObject({ do: 'denyPassThrough' });
    expect(compileClause(
      'When this Pokémon is on the field, it can move to your goal point instead of making an MP move (ends your turn).',
    ).actions[0]).toMatchObject({
      do: 'optional',
      then: [{ do: 'move', to: { kind: 'goal' } }, { do: 'endTurn' }],
    });
    expect(compileClause(
      'If a Pokémon finishes an MP move next to this Pokémon, this Pokémon moves 1 space away.',
    )).toMatchObject({
      trigger: 'afterMove',
      actions: [{ do: 'move', to: { kind: 'pointStepsAway', steps: 1 } }],
    });
    expect(compileClause(
      'Pokémon next to this Pokémon cannot move using the effects of attacks, abilities, or energy.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'beMoved' });
    expect(compileClause(
      'Frozen Pokémon next to this Pokémon cannot be tagged.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'beTagged' });
    expect(compileClause(
      'While this Pokémon is on the field, the asleep condition is not removed by the effects of Abilities.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'loseConditions' });
    expect(compileClause(
      'Your opponent\'s spins are shifted by two segments in a clockwise direction.',
    ).actions[0]).toMatchObject({ do: 'rotateWheel', segments: 2 });
    expect(compileClause(
      'When this Pokémon is on the field, your Psychic Pokémon gain a +1 ★.',
    ).actions[0]).toMatchObject({ do: 'modifyStars', delta: 1 });
    expect(compileClause(
      'In exchange, it receives a damage boost of +50 until the next time it lands on Techno Blast',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'flat', amount: 50 },
      duration: { kind: 'untilNamedLand', name: 'Techno Blast' },
    });
    expect(compileClause(
      'This Pokémon deals +50 damage until the end of the next turn in which it spins Techno Blast.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      duration: { kind: 'untilNamedLand', name: 'Techno Blast', endOfThatTurn: true },
    });
    expect(compileClause(
      'This Pokémon and your Pokémon next to it will be protected from instant knock out effects of Attacks.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'instantKoFromAttacks' });
    expect(compileClause(
      'This Pokémon must MP Move as far as its MP range will allow.',
    ).actions[0]).toMatchObject({ do: 'forceFullMp' });
    expect(compileClause(
      'If this Pokémon is not affected by a special condition, the attack damage dealt to this Pokémon by its opponents is cut in half.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'multiply', factor: 0.5 },
    });
    expect(compileClause(
      'Before using this Pokémon, you may move this Pokémon on the bench next to one of your Avalugg on the field.',
    )).toMatchObject({
      trigger: 'startOfTurn',
      actions: [{
        do: 'optional',
        then: [{ do: 'move', to: { kind: 'openSpotAdjacentTo' } }],
      }],
    });
    expect(compileClause(
      'Sleeping opposing Pokémon next to this Pokémon are knocked out. (Pokémon passed while moving do not count.)',
    ).actions[0]).toMatchObject({ do: 'knockOut', target: { kind: 'except' } });
    expect(compileEffect(
      'On the field, this Pokémon can pass through other Pokémon. Attach a Forest Mischief marker to any Psychic Pokémon that battles this Pokémon. (While that marker is attached, that Pokémon is not subject to Energy effects.)',
    ).every((clause) => clause.actions.every((action) => action.do !== 'unimplemented'))).toBe(true);
    expect(compileClause(
      'This Pokémon is not subject to spin-inducing effects of Attacks.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'spinFromAttacks' });
    expect(compileClause(
      'This Pokémon and your Pokémon adjacent to this Pokémon are not knocked out by gold attacks from their battle opponents.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'goldAttackKo' });
    expect(compileClause(
      'Whenever this Pokémon moves from a P.C. to the bench, one of your used Mega Evolution plates becomes usable.',
    )).toMatchObject({
      trigger: 'onPcToBench',
      actions: [{ do: 'refreshPlate', megaOnly: true }],
    });
    expect(compileClause(
      'For effects that move this Pokémon\'s battle opponent, you decide whether it is used, which Pokémon is targeted, and where the targeted Pokémon will be moved to.',
    ).actions[0]).toMatchObject({ do: 'seizeMoveEffects' });
    expect(compileClause(
      'This Pokémon deals +29 Attack damage for each Pokémon in the Ultra Space.',
    ).actions[0]).toMatchObject({
      do: 'modifyDamage',
      modifier: { kind: 'flatByCount', amount: 29 },
    });
    expect(compileClause(
      'This Pokémon gets +1 MP for each Pokémon in the Ultra Space (to a maximum of MP4).',
    ).actions[0]).toMatchObject({
      do: 'modifyMp',
      delta: 1,
      cap: 4,
    });
    expect(compileClause(
      'This Pokémon\'s MP cannot be 2 or lower (except through the effects of markers).',
    ).actions[0]).toMatchObject({ do: 'floorMp', min: 3 });
    expect(compileClause('Undergoes branching Evolution.').actions[0]).toMatchObject({
      do: 'unimplemented',
    });
    expect(compileClause(
      'Before battle, allows one friendly Exeggcute to be chosen.',
    ).actions[0]).toMatchObject({ do: 'select' });
    expect(compileClause(
      'Before battle, allows one of friendly Exeggcute to be choosed.',
    ).actions[0]).toMatchObject({ do: 'select' });
    expect(compileClause(
      'If this Pokémon is knocked out by damage in battle, the next turn will always be yours.',
    )).toMatchObject({
      trigger: 'onSelfKnockedOut',
      actions: [{ do: 'forceNextTurn', player: 'controller' }],
    });
    expect(compileClause(
      'This Pokémon can\'t be Paralyzed.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'gainConditions', conditions: ['paralyzed'] });
    expect(compileClause(
      'Opposing Grass and Fairy Pokémon within 2 steps of this Pokémon have MP-1.',
    ).actions[0]).toMatchObject({ do: 'modifyMp', delta: -1 });
    expect(compileClause(
      'This Pokémon can always attack after moving.',
    ).actions[0]).toMatchObject({ do: 'forceBattle' });
    expect(compileClause(
      'This Pokémon can move one additional space on the board when moving from the bench.',
    ).actions[0]).toMatchObject({ do: 'grantMovement', grant: 'extraStep' });
    expect(compileClause(
      'Opposing Pokémon adjacent to this Pokémon cannot change forms with an Ability.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'changeForm' });
    expect(compileClause(
      'When this Pokémon moves from the bench to the field, spin a Pokémon.',
    )).toMatchObject({
      trigger: 'onEnterField',
      actions: [{ do: 'spinCheck' }],
    });
    expect(compileEffect(
      'When this Pokémon moves from the bench to the field, or appears as an evolution, spin for each opposing Pokémon on an entry point. If a Purple Attack is spun, knock that opposing Pokémon out.',
    ).some((clause) => clause.actions.some((action) => action.do === 'spinCheck'))).toBe(true);
    expect(compileClause(
      'You can use this Pokémon immediately.',
    ).actions[0]).toMatchObject({ do: 'readyImmediately' });
    expect(compileClause(
      'You may use this Ability at the start of your turn.',
    ).actions[0]).toMatchObject({ do: 'tag', tag: 'activableStartOfTurn' });
  });

  it('compiles the leftover first-battle / US / surround / Loyalty verbs', () => {
    expect(compileClause(
      'This Pokémon negates status effects for your opponent\'s White Attacks.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'gainConditions', fromColor: 'white' });
    expect(compileClause(
      'If there is an opponent\'s Pokémon on your entry point, and this Pokémon is on the bench, at the beginning of your turn, this Pokémon can move next to that Pokémon and battle.',
    ).trigger).toBe('startOfTurn');
    expect(compileClause(
      'When this Pokémon becomes poisoned, noxious, paralyzed, burned etc. by an Attack, the Pokémon that caused the condition will also become it.',
    )).toMatchObject({ trigger: 'onConditionApplied', actions: [{ do: 'copyReceivedCondition' }] });
    expect(compileClause(
      'Pokémon that have battled this Pokémon become Grass type while they are on the field (but they stop being Grass type if they leave the field).',
    ).actions[0]).toMatchObject({ do: 'setType', types: ['Grass'] });
    const electric = compileClause(
      'Instead of an MP move, you can move this Pokémon through an adjacent Electric Pokémon and a succession of Electric-type Pokémon adjacent to that Pokémon to another spot.',
    );
    const electricMove = electric.actions[0]?.do === 'optional' ? electric.actions[0].then[0] : electric.actions[0];
    expect(electric.trigger).toBe('startOfTurn');
    expect(electricMove).toMatchObject({ do: 'move', to: { kind: 'beyondSuccession' } });
    expect(compileClause(
      'Each player moves one Benched Pokémon to its respective entry point (your opponent goes first).',
    ).actions[0]).toMatchObject({ do: 'move', to: { kind: 'respectiveEntry' } });
    expect(compileClause(
      'Your Pokémon do not move to the Ultra Space from the effects of Abilities and Attacks of opposing Pokémon.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'moveToUltraSpace' });
    expect(compileClause(
      'Ultra Beasts do not move from the Ultra Space to the field by the effects of Abilities or Attacks.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'leaveUltraSpace' });
    expect(compileClause(
      'In this Pokémon\'s first battle after moving to the field, it can attack Pokémon that are two steps away.',
    ).actions[0]).toMatchObject({ do: 'setBattleRange', range: 2 });
    expect(compileClause(
      'Mega evolution does not end via passage of turns for the Pokémon of the player whose entry point it is.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'megaTick' });
    expect(compileClause(
      'If there are three or more opposing Pokémon on the field or bench with the same name as the surrounded Pokémon is excluded from the duel.',
    ).actions[0]).toMatchObject({ do: 'exclude' });
    expect(compileClause(
      'Attack damage-increasing effects on Flying battle opponents of your Flying-type Pokémon are negated.',
    ).actions[0]).toMatchObject({ do: 'nullify', scope: 'damageModifiers', onlyVsAllyTypes: ['Flying'] });
    expect(compileClause(
      'Add +1 spin to the spin-again Attacks of your Pokémon.',
    ).actions[0]).toMatchObject({ do: 'bonusRespin', delta: 1 });
    expect(compileClause(
      'Any effects on the battle opponent that prevent it from being knocked out in battle are negated, and the battle opponent loses any markers with effects that prevent it from being knocked out.',
    ).actions[0]).toMatchObject({ do: 'stripKoPrevention' });
    expect(compileClause(
      'Opposing Pokémon cannot MP move through a point next to this Pokémon to pass it.',
    ).actions[0]).toMatchObject({ do: 'denyAdjacentPass' });
    expect(compileClause(
      'When this Pokémon leaves the field, it returns to the form it was before it changed forms.',
    )).toMatchObject({ trigger: 'onLeaveField', actions: [{ do: 'revertForm' }] });
    expect(compileClause(
      'Opposing Pokémon cannot use the effect of Air Balloon to MP move over other Pokémon.',
    ).actions[0]).toMatchObject({ do: 'denyNamedGrant', nameIncludes: 'Air Balloon' });
    expect(compileClause(
      'Neither player\'s remaining time changes.',
    ).actions[0]).toMatchObject({ do: 'tag', tag: 'preserveClocks' });
    expect(compileClause(
      'Until the end of your opponent\'s next turn, neither player can use Time Travel.',
    ).actions[0]).toMatchObject({ do: 'tag', tag: 'lockTimeTravel' });
    expect(compileClause(
      'This Pokémon is not affected by Taunt.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'namedEffect', named: 'Taunt' });
    expect(compileClause(
      'While this Pokémon is on the field, the start-of-turn Z-Move gauge increase of each player is boosted for each of that player\'s Pokémon that is affected by a special condition.',
    ).actions[0]).toMatchObject({ do: 'unimplemented' });
    expect(compileClause('The Dodges of opposing Pokémon adjacent to this Pokémon becomes Misses.').actions[0])
      .toMatchObject({ do: 'replaceSegment', replaces: 'Dodge' });
    expect(compileClause(
      'Pokémon next to this Pokémon cannot move using the effects of moves, Abilities or Energy.',
    ).actions[0]).toMatchObject({ do: 'prevent', what: 'beMoved' });
    expect(compileClause('Your opponent\'s Dark-type Pokémon will do -20 damage.').actions[0])
      .toMatchObject({ do: 'modifyDamage' });
    expect(compileClause('If the opponent\'s Pokémon is knocked out, so is this Pokémon.')).toMatchObject({
      when: [{ kind: 'isBattleWinner' }],
      actions: [{ do: 'knockOut', target: { kind: 'self' } }],
    });
    expect(compileClause('If Barrage is spun, it deals +60 damage.')).toMatchObject({
      when: [{ kind: 'namedAttackSpun', names: ['Barrage'] }],
    });
    expect(compileClause(
      'If this Pokémon cannot evolve, it is knocked out.',
    ).when[0]).toMatchObject({ kind: 'unimplemented' });
    expect(compileClause('If it does, the Exeggcute is knocked out.')).toMatchObject({
      when: [{ kind: 'precedingActionTaken' }],
      actions: [{ do: 'knockOut', target: { kind: 'all', where: [{ kind: 'named', names: ['Exeggcute'] }] } }],
    });
    expect(compileClause(
      'Temporarily excludes its battle opponent from the duel if it is a Rock- or Fairy Pokémon.',
    )).toMatchObject({
      actions: [{ do: 'exclude', returnTo: 'bench' }],
    });
    expect(compileClause(
      'If your Pokémon fill either your P.C. or your opponent\'s P.C., this Pokémon may change its form to Zygarde Complete Forme without moving to the P.C. when it is knocked out by damage in battle.',
    ).actions[0]).toMatchObject({ do: 'surviveByForm' });
    const snow = compileEffect(
      'If this Pokémon is attacked, it may move under the attacking Pokémon to a point next to it. (A battle does not occur.) This Pokémon can MP move past Ice Pokémon on the field.',
    );
    expect(snow.some((clause) =>
      clause.trigger === 'onAttacked'
      && clause.actions.some((action) => action.do === 'optional')
      && JSON.stringify(clause).includes('noBattle'),
    )).toBe(true);
    expect(snow.some((clause) => clause.actions.some((action) => action.do === 'grantMovement'))).toBe(true);
    expect(compileClause(
      'Pokémon that have battled this Pokémon become Grass type while they are on the field (but they stop being Grass type if they leave the field).',
    ).when.every((cond) => cond.kind !== 'unimplemented')).toBe(true);
    expect(compileClause(
      'If one of your other Pokémon is knocked out, and this Pokémon is in the P.C., this Pokémon moves to the bench.',
    )).toMatchObject({ trigger: 'onFigureKnockedOut' });
    expect(compileClause(
      'If this Pokémon surrounds an opponent\'s Pokémon, this Pokémon may evolve.',
    ).trigger).toBe('onSurrounded');
    const homeward = compileEffect(
      'When this Pokémon appears as a Mega Evolution, and again when its Mega Evolution ends, you may move one of your Pokémon in the Ultra Space or P.C. next to this Pokémon. Your Electric and your Dragon Pokémon deal +10 damage.',
    );
    expect(homeward.some((clause) => clause.trigger === 'onMegaStart')).toBe(true);
    expect(homeward.some((clause) => clause.trigger === 'onMegaEnd')).toBe(true);
    const loyalty = compileEffect(
      'At the start of your turn, if this Pokémon is on the field, it may move to the bench. You can use this Pokémon immediately. If this Pokémon has evolved, this Pokémon gains +1 MP.',
    );
    expect(loyalty.some((clause) => clause.actions.some((action) =>
      action.do === 'optional' && action.then.some((inner) => inner.do === 'readyImmediately'),
    ))).toBe(true);
  });

  it('does not leave the leftover Energy / Sphere / appliance plates as unimplemented', () => {
    const texts = [
      'During this duel, when your Deoxys is attacked, before the battle, you may switch that Deoxys with another of your Deoxys on the field or bench.',
      'Choose one of your Dark-type Pokémon. Until the end of the duel, while that Pokémon is on the field, opposing Ghost-type Pokémon and Psychic-type Pokémon cannot pass through your Dark-type Pokémon by the effects of Abilities.',
      'Choose one of your Ice-type Pokémon. Until the end of the duel, plates with Sphere in their name, except for Frost Sphere, have their effects negated on opposing Pokémon within 3 steps of that Pokémon.',
      'Choose one of your Rotom, Wash Rotom, Frost Rotom, Fan Rotom or Mow Rotom on the field and change its form to Heat Rotom. All Pokémon become Fire-type Pokémon for 9 turns.',
      'During this duel, if there are 2 or more Water-type Pokémon and 2 or more Ground-type Pokémon on the field, your opponent\'s Pokémon on the field get +1 to Wait effects that they receive.',
    ];
    for (const text of texts) {
      expect(kinds(text).every((kind) => kind !== 'unimplemented'), text).toBe(true);
    }
  });
});

describe('failure behaviour', () => {
  it('never drops a clause, even when it cannot express it', () => {
    const c = compileClause('Some entirely unparseable nonsense phrase about wombats.');
    expect(c.actions[0]).toEqual({
      do: 'unimplemented',
      text: 'Some entirely unparseable nonsense phrase about wombats',
    });
    expect(c.source.length).toBeGreaterThan(0);
  });
});
