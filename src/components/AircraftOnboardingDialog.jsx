import { useEffect, useId, useRef, useState } from 'react';
import FirstAircraftOnboarding from './FirstAircraftOnboarding';
import './AircraftOnboardingDialog.css';

export default function AircraftOnboardingDialog({ canCreate, onCreate, onCancel, onUnauthorized }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const cancel = () => {
    if (busy) return;
    dialogRef.current.close();
    onCancel();
  };
  const create = async (values) => {
    setBusy(true);
    try { await onCreate(values); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dialogRef} className="aircraft-create-dialog" aria-labelledby={titleId}
      aria-busy={busy} onCancel={(event) => { event.preventDefault(); cancel(); }}>
      <FirstAircraftOnboarding embedded titleId={titleId} canCreate={canCreate}
        onCreate={create} onCancel={cancel} onUnauthorized={onUnauthorized} />
    </dialog>
  );
}
