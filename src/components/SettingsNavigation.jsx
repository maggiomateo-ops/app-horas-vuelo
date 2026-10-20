import { getSettingsSections } from '../utils/settingsNavigation';

export default function SettingsNavigation({ items, activeSection, onSelect }) {
  const button = (item) => (
    <button type="button" aria-current={activeSection === item.id ? 'page' : undefined}
      onClick={() => onSelect(item.id)}>{item.label}</button>
  );
  return (
    <>
      <label className="settings-mobile-category">
        <span>Sección</span>
        <select value={activeSection} onChange={(event) => onSelect(event.target.value)}>
          {items.map((item) => item.children ? (
            <optgroup key={item.id} label={item.label}>
              {getSettingsSections([item]).map((section) => (
                <option key={section.id} value={section.id}>{section.label}</option>
              ))}
            </optgroup>
          ) : <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <nav className="settings-sidebar" aria-label="Secciones de Settings">
        <ul>{items.map((item) => (
          <li key={item.id}>
            {item.children ? (
              <>
                <p className="settings-sidebar-heading">{item.label}</p>
                <ul>{item.children.map((section) => <li key={section.id}>{button(section)}</li>)}</ul>
              </>
            ) : button(item)}
          </li>
        ))}</ul>
      </nav>
    </>
  );
}
