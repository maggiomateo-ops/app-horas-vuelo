import { useId, useState } from 'react';
import { getSettingsPages } from '../utils/settingsNavigation';

export default function SettingsNavigation({ items, activePage, onSelect }) {
  const [collapsed, setCollapsed] = useState(() => new Set(['configuration', 'dashboards']));
  const navId = useId();
  const toggle = (id) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const renderItems = (nodes) => nodes.map((item) => (
    <li key={item.id}>
      {item.children ? (
        <>
          <div className="settings-nav-group">
            {item.page ? (
              <button type="button" aria-current={activePage === item.id ? 'page' : undefined}
                onClick={() => onSelect(item.id)}>{item.label}</button>
            ) : <span>{item.label}</span>}
            <button type="button" className="settings-nav-disclosure"
              aria-label={`${collapsed.has(item.id) ? 'Expandir' : 'Contraer'} ${item.label}`}
              aria-expanded={!collapsed.has(item.id)} aria-controls={`${navId}-${item.id}`}
              onClick={() => toggle(item.id)}><span aria-hidden="true">{collapsed.has(item.id) ? '+' : '−'}</span></button>
          </div>
          <ul id={`${navId}-${item.id}`} hidden={collapsed.has(item.id)}>{renderItems(item.children)}</ul>
        </>
      ) : (
        <button type="button" aria-current={activePage === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}>{item.label}</button>
      )}
    </li>
  ));
  return (
    <>
      <label className="settings-mobile-category">
        <span>Sección</span>
        <select value={activePage} onChange={(event) => onSelect(event.target.value)}>
          {items.map((item) => (
            <optgroup key={item.id} label={item.label}>
              {getSettingsPages([item]).map((page) => (
                <option key={page.id} value={page.id}>{page.path.slice(1).map((part) => part.label).join(' › ') || page.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav className="settings-tree" aria-label="Secciones de Settings"><ul>{renderItems(items)}</ul></nav>
    </>
  );
}
