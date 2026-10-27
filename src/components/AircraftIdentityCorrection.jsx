import { useRef, useState } from 'react';
import { canCorrectIdentity, loadIdentityReview, correctIdentityAndReadback } from '../services/aircraftIdentityService';
export default function AircraftIdentityCorrection({aircraft,onReadback,onUnauthorized}) {
  const [snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const guard=useRef(false);
  if(!canCorrectIdentity(aircraft))return null;
  const run=async(confirm)=>{
    if(guard.current)return;guard.current=true;setBusy(true);setError('');
    try {
      if(confirm){const result=await correctIdentityAndReadback(aircraft.aircraft_id,snapshot);onReadback(result.aircrafts);setSnapshot(null);}
      else {const review=await loadIdentityReview(aircraft.aircraft_id);setSnapshot(review.snapshot);}
    } catch(e){if(e.code==='UNAUTHORIZED')onUnauthorized?.();else setError(e.message);}
    finally{guard.current=false;setBusy(false);}
  };
  return <section className="aircraft-configuration-onboarding" aria-label="Identidad de prueba LV-SIM">
    <p className="dashboard-eyebrow">LV-SIM · Entorno de prueba</p>
    <h2>Corregir identidad de prueba</h2>
    <p>Cessna C182 → Piper PA-34 Seneca. La serie quedará desconocida y se conservará la evidencia anterior.</p>
    {snapshot ? <div className="aircraft-configuration-confirmation">
      <strong>Confirmá el cambio</strong>
      <p>{snapshot.manufacturer} {snapshot.model} · Serie actual: {snapshot.serialNumber ?? 'Desconocida'}</p>
      <p>Piper PA-34 Seneca · Serie: Desconocida</p>
      <button className="form-action-button is-primary" type="button" disabled={busy} onClick={()=>run(true)}>Confirmar corrección de identidad</button>
      <button className="form-action-button" type="button" disabled={busy} onClick={()=>setSnapshot(null)}>Cancelar</button>
    </div> : <button className="form-action-button" type="button" disabled={busy} onClick={()=>run(false)}>Revisar identidad</button>}
    {busy ? <p role="status">Verificando identidad…</p> : null}
    {error ? <p role="alert" className="flight-form-message is-error">{error}</p> : null}
  </section>;
}
