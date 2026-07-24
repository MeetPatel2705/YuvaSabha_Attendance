import { useMemo, useRef, useState } from 'react';

export default function MemberSearchSelect({ members, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, query]);

  const selected = members.find((m) => m.id === value);

  function select(member) {
    onChange(member.id);
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) select(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="member-select">
      <div className="member-select-input-wrap">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder || 'Search your name...'}
          value={open ? query : selected?.name || query}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setActiveIndex(-1);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {selected && !open && (
          <button
            type="button"
            className="member-select-clear"
            aria-label="Clear selection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="member-select-list">
          {filtered.length === 0 && <li className="member-select-empty">No matches</li>}
          {filtered.map((m, i) => (
            <li
              key={m.id}
              className={i === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(m)}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
