import { fetchAircrafts } from './aircraftService.js';
export const SIM_ID='96d849aa-2827-4aa3-b02b-6671577444a7';
export function canCorrectIdentity(aircraft) {
  return aircraft?.aircraft_id===SIM_ID && aircraft.rol==='OWNER' && aircraft.identityCorrectionAvailable===true;
}
export async function loadIdentityReview(aircraftId,{load=fetchAircrafts}={}) {
  const aircrafts=await load();const aircraft=aircrafts.find(a=>a.aircraft_id===aircraftId);
  if (!canCorrectIdentity(aircraft) || !aircraft.identityCorrectionSnapshot) throw new Error('La identidad cambió o la corrección no está habilitada. Actualizá la aeronave.');
  return {aircrafts,snapshot:aircraft.identityCorrectionSnapshot};
}
export async function correctIdentityAndReadback(aircraftId,expected,{request=fetch,load=fetchAircrafts}={}) {
  if(aircraftId!==SIM_ID)throw new Error('Aeronave no autorizada.');
  const response=await request('/api/aircraft',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    action:'correct-pending-aircraft-identity',aircraftId,manufacturer:'Piper',model:'PA-34 Seneca',serialNumber:null,
    reason:'Corrección de identidad ficticia en Neon TEST.',expected,
  })});
  const data=await response.json();
  if(response.status===401)throw Object.assign(new Error('Tu sesión expiró.'),{code:'UNAUTHORIZED'});
  if(!response.ok||!data?.ok)throw new Error(data?.error||'No se pudo corregir la identidad.');
  const aircrafts=await load();const aircraft=aircrafts.find(a=>a.aircraft_id===aircraftId);
  if(aircraft?.fabricante!=='Piper'||aircraft?.modelo!=='PA-34 Seneca'||aircraft?.identityCorrectionSnapshot?.serialNumber!==null) {
    throw new Error('La operación respondió, pero no se pudo verificar la lectura. Actualizá antes de continuar.');
  }
  return {aircrafts,aircraft};
}
