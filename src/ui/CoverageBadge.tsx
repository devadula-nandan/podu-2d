interface Props {
  readonly implemented: boolean;
  readonly kind: 'figure' | 'plate';
  readonly title?: string;
}

/** Implemented vs gap. Text is the signal; colour is decoration. */
export function CoverageBadge({ implemented, kind, title }: Props) {
  const label = implemented ? 'implemented' : 'gap';
  return (
    <span
      className={implemented ? 'badge ok' : 'badge bad'}
      data-testid="coverage-badge"
      data-coverage={implemented ? 'implemented' : 'gap'}
      data-kind={kind}
      title={title ?? (implemented ? 'Every compiled clause is implemented' : 'Coverage registry gap')}
    >
      {label}
    </span>
  );
}
