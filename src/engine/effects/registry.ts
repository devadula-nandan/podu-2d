/**
 * The coverage registry: the thing that refuses to lie about fidelity.
 *
 * 3,863 atomic clauses spread over 1,311 distinct patterns, 893 of which occur exactly
 * once. No amount of DSL cleverness collapses that tail, so a faithful reimplementation
 * has to choose between two failure modes: quietly no-op the clauses it cannot run, or
 * refuse to field the figure. This registry chooses the second.
 *
 * The reason is not purity. A silently ignored ability produces a game that is subtly
 * wrong *everywhere it appears* - the AI learns from it, the playtester blames the dice,
 * and the bug report says "Charizard felt weak". A refusal at deck-build time is one
 * loud error with the offending clause text attached. A known gap is cheap; a hidden one
 * is expensive.
 *
 * `allowUnimplemented` exists for tests and for exploratory play, but it is off by
 * default and it records every skipped clause on the state, so a duel can never quietly
 * claim to have been played at full fidelity.
 */
import type { Clause } from '../../content/dsl/effects.js';
import type { EngineContent, FigureContent } from '../content.js';
import type { ContentFigureId, ContentPlateId } from '../ids.js';
import { clauseGaps } from './support.js';

export interface ClauseSupport {
  readonly clause: Clause;
  readonly gaps: readonly string[];
  /** Where the clause came from, for an error message a human can act on. */
  readonly origin: string;
}

export interface FigureSupport {
  readonly id: ContentFigureId;
  readonly name: string;
  readonly implemented: boolean;
  readonly clauses: readonly ClauseSupport[];
  readonly unsupported: readonly ClauseSupport[];
}

export interface PlateSupport {
  readonly id: ContentPlateId;
  readonly name: string;
  readonly implemented: boolean;
  readonly unsupported: readonly ClauseSupport[];
}

export interface CoverageTotals {
  readonly figures: number;
  readonly figuresImplemented: number;
  readonly figuresWithoutAbility: number;
  readonly clauses: number;
  readonly clausesSupported: number;
  readonly plates: number;
  readonly platesImplemented: number;
}

export interface CoverageRegistry {
  readonly figures: ReadonlyMap<ContentFigureId, FigureSupport>;
  readonly plates: ReadonlyMap<ContentPlateId, PlateSupport>;
  readonly totals: CoverageTotals;
  /** Gap reasons ranked by how many clauses they block. Drives the next increment. */
  readonly rankedGaps: readonly (readonly [string, number])[];
}

function analyseFigure(entry: FigureContent): FigureSupport {
  const clauses: ClauseSupport[] = [];
  const abilityName = entry.figure.ability?.name ?? 'no ability';
  for (const clause of entry.abilityClauses) {
    clauses.push({ clause, gaps: clauseGaps(clause), origin: `ability "${abilityName}"` });
  }
  entry.segmentClauses.forEach((segmentClauses, index) => {
    const move = entry.figure.wheel[index]?.moveName ?? `segment ${index}`;
    for (const clause of segmentClauses) {
      clauses.push({ clause, gaps: clauseGaps(clause), origin: `move "${move}"` });
    }
  });
  const unsupported = clauses.filter((c) => c.gaps.length > 0);
  return {
    id: entry.id,
    name: entry.figure.name,
    implemented: unsupported.length === 0,
    clauses,
    unsupported,
  };
}

export function buildCoverageRegistry(content: EngineContent): CoverageRegistry {
  const figures = new Map<ContentFigureId, FigureSupport>();
  const gapCounts = new Map<string, number>();
  let clauseTotal = 0;
  let clauseSupported = 0;
  let figuresImplemented = 0;
  let figuresWithoutAbility = 0;

  for (const entry of content.figures.values()) {
    const support = analyseFigure(entry);
    figures.set(entry.id, support);
    clauseTotal += support.clauses.length;
    clauseSupported += support.clauses.length - support.unsupported.length;
    if (support.implemented) figuresImplemented++;
    if (entry.figure.ability === null) figuresWithoutAbility++;
    for (const clause of support.unsupported) {
      for (const gap of clause.gaps) {
        const key = gap.startsWith('unimplemented:') ? 'unimplemented' : gap;
        gapCounts.set(key, (gapCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const plates = new Map<ContentPlateId, PlateSupport>();
  let platesImplemented = 0;
  for (const entry of content.plates.values()) {
    const unsupported = entry.clauses
      .map((clause) => ({ clause, gaps: clauseGaps(clause), origin: `plate "${entry.plate.name}"` }))
      .filter((c) => c.gaps.length > 0);
    const implemented = unsupported.length === 0;
    if (implemented) platesImplemented++;
    plates.set(entry.id, { id: entry.id, name: entry.plate.name, implemented, unsupported });
  }

  return {
    figures,
    plates,
    totals: {
      figures: figures.size,
      figuresImplemented,
      figuresWithoutAbility,
      clauses: clauseTotal,
      clausesSupported: clauseSupported,
      plates: plates.size,
      platesImplemented,
    },
    rankedGaps: [...gapCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
  };
}

export class UnimplementedContentError extends Error {
  readonly details: readonly string[];
  constructor(details: readonly string[]) {
    super(
      `${details.length} clause(s) on the requested content are not implemented:\n  ${details.join('\n  ')}\n` +
        'Pass `allowUnimplemented: true` to field them anyway; they will be skipped and recorded on the state.',
    );
    this.name = 'UnimplementedContentError';
    this.details = details;
  }
}

export function figureSupport(registry: CoverageRegistry, id: ContentFigureId): FigureSupport {
  const support = registry.figures.get(id);
  if (support === undefined) throw new UnimplementedContentError([`figure ${id} is not in the content bundle`]);
  return support;
}

/** One line per blocking clause, naming the figure, the source text and the reason. */
export function describeGaps(support: FigureSupport): string[] {
  return support.unsupported.map(
    (clause) =>
      `${support.name} (#${support.id}) ${clause.origin}: [${clause.gaps.join(', ')}] "${clause.clause.source.slice(0, 90)}"`,
  );
}

export function describePlateGaps(support: PlateSupport): string[] {
  return support.unsupported.map(
    (clause) => `${support.name} (plate #${support.id}): [${clause.gaps.join(', ')}] "${clause.clause.source.slice(0, 90)}"`,
  );
}

/** A short, honest summary line for logs and for the report at the end of a run. */
export function coverageSummary(registry: CoverageRegistry): string {
  const t = registry.totals;
  const pctFigures = ((t.figuresImplemented / Math.max(1, t.figures)) * 100).toFixed(1);
  const pctClauses = ((t.clausesSupported / Math.max(1, t.clauses)) * 100).toFixed(1);
  return (
    `figures fully implemented: ${t.figuresImplemented}/${t.figures} (${pctFigures}%), ` +
    `of which ${t.figuresWithoutAbility} carry no ability at all; ` +
    `clauses executable: ${t.clausesSupported}/${t.clauses} (${pctClauses}%); ` +
    `plates fully implemented: ${t.platesImplemented}/${t.plates}`
  );
}
