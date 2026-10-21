import { ownershipDate, ownershipStatus } from '../utils/ownershipPresentation';

export default function AircraftOwnershipSummary({ configured, interests }) {
  const available = Array.isArray(interests);
  return <section className="settings-ownership-status" aria-label="Titularidad legal">
    <p>La titularidad legal es independiente del acceso OWNER y de las opciones del formulario.</p>
    {!available ? <p role="status">{configured === true ? 'Titularidad configurada. El detalle no está disponible para esta sesión.' : configured === false ? 'Titularidad legal pendiente.' : 'Titularidad legal no disponible en esta fuente.'}</p>
      : !interests.length ? <p role="status">Todavía no hay titulares legales configurados.</p>
      : <div className="ownership-interest-list">{interests.map((interest) => <article key={interest.ownershipInterestId} className="ownership-interest">
        <header><strong>{interest.name || 'Titular sin nombre disponible'}</strong><span>{new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(interest.share)} %</span></header>
        <div className="ownership-interest-meta"><span>{interest.partyType === 'ORGANIZATION' ? 'Organización' : 'Persona'}</span><span>{ownershipStatus(interest)}</span></div>
        <dl><div><dt>Desde</dt><dd>{ownershipDate(interest.effectiveFrom)}</dd></div><div><dt>Hasta</dt><dd>{ownershipDate(interest.effectiveTo)}</dd></div></dl>
      </article>)}</div>}
  </section>;
}
