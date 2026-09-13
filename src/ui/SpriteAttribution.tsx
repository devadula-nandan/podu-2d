interface Props {
  readonly className?: string;
}

export function SpriteAttribution({ className }: Props) {
  return (
    <p className={className} data-testid="sprite-attribution">
      Official artwork from{' '}
      <a href="https://github.com/PokeAPI/sprites" target="_blank" rel="noreferrer">
        PokeAPI
      </a>{' '}
      (Nintendo / The Pokémon Company IP; not open-source). See ATTRIBUTION.md.
    </p>
  );
}
