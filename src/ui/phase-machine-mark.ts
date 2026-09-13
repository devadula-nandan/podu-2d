/**
 * After Mermaid paints the Phase graph, mark the live node by toggling `is-active`.
 * Keep selectors tolerant: mermaid state diagrams use `.statediagram-state` / `.node`.
 */
import { PHASES, WAITING_PHASES } from '../engine/phase-machine.js';
import type { Phase } from '../engine/state.js';

export const ACTIVE_PHASE_CLASS = 'is-active';
export const WAITING_PHASE_CLASS = 'is-waiting';
export const TERMINAL_PHASE_CLASS = 'is-terminal';

const PHASE_NODE_SELECTOR = '.statediagram-state, .stateGroup, .node';

export function isPhaseName(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

/** Match a mermaid state node to a `Phase` by data-id, id, or label text. */
export function phaseNameOf(attrs: {
  readonly id: string;
  readonly dataId: string;
  readonly text: string;
}): Phase | null {
  if (isPhaseName(attrs.dataId)) return attrs.dataId;
  if (isPhaseName(attrs.id)) return attrs.id;
  for (const phase of PHASES) {
    if (attrs.id.startsWith(`state-${phase}-`) || attrs.id.startsWith(`${phase}-`)) return phase;
  }
  const text = attrs.text.replace(/\s+/g, ' ').trim();
  return isPhaseName(text) ? text : null;
}

function decorate(el: Element, name: Phase, phase: Phase): void {
  const active = name === phase;
  el.classList.toggle(ACTIVE_PHASE_CLASS, active);
  el.classList.toggle(WAITING_PHASE_CLASS, (WAITING_PHASES as readonly Phase[]).includes(name));
  el.classList.toggle(TERMINAL_PHASE_CLASS, name === 'gameOver');
  if (active) {
    el.setAttribute('data-active-phase', phase);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else {
    el.removeAttribute('data-active-phase');
  }
}

export function markActivePhase(root: ParentNode, phase: Phase): void {
  let marked = 0;
  const nodes = root.querySelectorAll(PHASE_NODE_SELECTOR);
  for (const el of nodes) {
    const name = phaseNameOf({
      id: el.id,
      dataId: el.getAttribute('data-id') ?? '',
      text: el.textContent || '',
    });
    if (name === null) continue;
    decorate(el, name, phase);
    if (name === phase) marked += 1;
  }
  if (marked > 0) return;
  for (const label of root.querySelectorAll('text, .nodeLabel, .stateLabel, foreignObject div')) {
    const text = (label.textContent || '').replace(/\s+/g, ' ').trim();
    if (text !== phase) continue;
    const group = label.closest('g');
    if (group === null) continue;
    decorate(group, phase, phase);
  }
}
