import { useEffect, useId, useRef, useState } from 'react';

export interface ListboxOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Listbox<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  testId,
  className,
}: {
  readonly value: T;
  readonly options: readonly ListboxOption<T>[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  const pick = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={`listbox${className !== undefined ? ` ${className}` : ''}`} ref={rootRef}>
      <select
        className="visually-hidden"
        data-testid={testId}
        disabled={disabled}
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value === '' ? 'all' : option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="listbox-btn"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!disabled) setOpen(true);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span>{selected?.label ?? ''}</span>
      </button>
      {open ? (
        <ul
          id={listId}
          className="listbox-panel"
          role="listbox"
          onKeyDown={(event) => {
            const index = options.findIndex((option) => option.value === value);
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              const next = options[Math.min(options.length - 1, index + 1)];
              if (next !== undefined) onChange(next.value);
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              const next = options[Math.max(0, index - 1)];
              if (next !== undefined) onChange(next.value);
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          {options.map((option) => (
            <li key={option.value === '' ? 'all' : option.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="listbox-option"
                data-selected={option.value === value ? '1' : '0'}
                onClick={() => {
                  pick(option.value);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
