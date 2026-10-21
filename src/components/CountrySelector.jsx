import { useEffect, useId, useRef, useState } from 'react';
import { COUNTRIES, searchCountries } from '../utils/countries';
import './CountrySelector.css';

export default function CountrySelector({ value, onChange, disabled, error }) {
  const id = useId();
  const listRef = useRef(null);
  const selected = COUNTRIES.find((country) => country.code === value);
  const [query, setQuery] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = searchCountries(query ?? '');
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, query]);
  const choose = (code) => { onChange(code); setQuery(null); setOpen(false); setActive(0); };
  return (
    <div className={`country-picker ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>País</label>
      <div className="country-picker-control">
        <input id={id} role="combobox" autoComplete="off" aria-autocomplete="list"
          aria-expanded={open} aria-controls={`${id}-list`} aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-activedescendant={open && results[active] ? `${id}-${results[active].code}` : undefined}
          placeholder="Buscar país" disabled={disabled} value={query ?? selected?.name ?? value ?? ''}
          onFocus={() => { setQuery(''); setOpen(true); setActive(0); }}
          onBlur={() => { setOpen(false); setQuery(null); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(null); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              setActive((index) => !open ? 0 : Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            }
            if (event.key === 'Enter' && open) { event.preventDefault(); if (results[active]) choose(results[active].code); }
          }} />
        {value && !disabled ? <button type="button" aria-label="Quitar país" onClick={() => choose('')}>×</button> : null}
      </div>
      {open ? <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Países" className="country-picker-list">
        {results.map((country, index) => <li key={country.code} id={`${id}-${country.code}`}
          role="option" data-active={active === index} aria-selected={value === country.code} className={active === index ? 'is-active' : ''}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(country.code)}>
          {country.name}<small>{country.code}</small>
        </li>)}
        {!results.length ? <li role="presentation">Sin resultados</li> : null}
      </ul> : null}
      {error ? <small id={`${id}-error`}>{error}</small> : null}
    </div>
  );
}
