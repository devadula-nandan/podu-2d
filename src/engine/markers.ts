/**
 * The marker registry.
 *
 * Markers are an *open* set - the clause corpus contains at least 19 named kinds with a
 * long tail appearing once or twice - so they cannot be a union type. But "open" must
 * not mean "anything goes": a typo in a marker name would otherwise create a brand new
 * marker that nothing ever reads, which is precisely the class of silent wrongness this
 * project is trying to avoid. So markers are string ids resolved against this registry,
 * and an unknown id throws.
 *
 * Adding a marker is one line here. That is deliberately cheap, and deliberately not
 * free.
 */
import type { MarkerId } from '../content/dsl/primitives.js';
import { marker } from '../content/dsl/primitives.js';

export interface MarkerDefinition {
  readonly id: MarkerId;
  /** Whether the marker carries a magnitude (Wait 3, MP -2) or is a bare flag. */
  readonly valued: boolean;
  /** Human-readable, for the rules inspector. */
  readonly label: string;
  /**
   * MP modifiers are the one marker family the movement rules read directly, so they
   * are flagged rather than string-matched at the call site.
   */
  readonly modifiesMp: boolean;
  /** Symbiont: the opposing player MP-moves this figure. */
  readonly opposingPlayerMp: boolean;
  /** Symbiont: tagging this figure removes the marker. */
  readonly removedByTag: boolean;
}

function define(
  id: string,
  label: string,
  opts: { valued?: boolean; modifiesMp?: boolean; opposingPlayerMp?: boolean; removedByTag?: boolean } = {},
): MarkerDefinition {
  return {
    id: marker(id),
    label,
    valued: opts.valued ?? false,
    modifiesMp: opts.modifiesMp ?? false,
    opposingPlayerMp: opts.opposingPlayerMp ?? false,
    removedByTag: opts.removedByTag ?? false,
  };
}

/**
 * `wait` is registered here for completeness but is *not* stored in the marker slot -
 * it is its own state layer with its own lifetime, and a figure can carry both a Wait
 * and a marker at once. Routing it through `attachMarker` in the DSL and out to the
 * wait counter in the reducer is what keeps the corpus's vocabulary and the engine's
 * three-layer model from having to agree on where it lives.
 */
export const MARKER_DEFINITIONS: readonly MarkerDefinition[] = [
  define('wait', 'Wait', { valued: true }),
  define('mpModifier', 'MP modifier', { valued: true, modifiesMp: true }),
  define('cracked', 'Cracked'),
  define('curse', 'Curse'),
  define('photon', 'Photon'),
  define('finalSong', 'Final Song'),
  define('branded', 'Branded'),
  define('imprisoned', 'Imprisoned'),
  define('pumpkin', 'Pumpkin'),
  define('clingingGas', 'Clinging Gas'),
  define('weakArmor', 'Weak Armor'),
  define('symbiont', 'Symbiont', { opposingPlayerMp: true, removedByTag: true }),
  define('full', 'Full'),
  define('disguise', 'Disguise'),
  define('forestMischief', 'Forest Mischief'),
  define('lockOn', 'Lock-On'),
  define('charge', 'Charge', { valued: true }),
  define('mummy', 'Mummy'),
  define('slime', 'Slime'),
  define('alchemy', 'Alchemy'),
];

const BY_ID = new Map<string, MarkerDefinition>(MARKER_DEFINITIONS.map((d) => [d.id, d]));

const ALIASES = new Map<string, string>(
  MARKER_DEFINITIONS.flatMap((definition) => {
    const kebab = definition.id.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    return kebab === definition.id ? [] : [[kebab, definition.id] as const];
  }),
);

/** Resolve kebab-case compiler leftovers to the camelCase registry id. */
export function canonicalMarker(id: string): MarkerId {
  return marker(ALIASES.get(id) ?? id);
}

export class UnknownMarkerError extends Error {
  constructor(id: string) {
    super(
      `unknown marker "${id}". Markers are an open set but not an unchecked one - ` +
        `add it to MARKER_DEFINITIONS in src/engine/markers.ts rather than letting it through.`,
    );
    this.name = 'UnknownMarkerError';
  }
}

export function markerDefinition(id: MarkerId): MarkerDefinition {
  const found = BY_ID.get(id);
  if (found === undefined) throw new UnknownMarkerError(id);
  return found;
}

export function isKnownMarker(id: string): boolean {
  return BY_ID.has(id) || ALIASES.has(id);
}

export const WAIT_MARKER = marker('wait');
export const MP_MODIFIER_MARKER = marker('mpModifier');
