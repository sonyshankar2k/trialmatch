import { useState, type KeyboardEvent } from 'react';

/** A list of short terms (conditions, medications): type and press Enter to add, × to remove. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const term = draft.trim();
    if (term && !value.some((v) => v.toLowerCase() === term.toLowerCase()))
      onChange([...value, term]);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Added">
          {value.map((term) => (
            <li
              key={term}
              className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs text-brand-700"
            >
              {term}
              <button
                type="button"
                aria-label={`Remove ${term}`}
                className="rounded-full px-1 hover:bg-brand-100"
                onClick={() => onChange(value.filter((v) => v !== term))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className="input"
        value={draft}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}
