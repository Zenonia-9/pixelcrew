import { useEffect, useRef } from "react";

export function LogoutDialog({ account, onCancel, onConfirm }: {
  account: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="logout-confirm" role="alertdialog"
    aria-labelledby="logout-confirm-title" aria-describedby="logout-confirm-description"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <h2 id="logout-confirm-title">Log out of {account}?</h2>
    <p id="logout-confirm-description">This removes the account and its saved sign-in from PixelCrew. Your chats will stay. You’ll need to sign in again to add it back.</p>
    <div className="logout-confirm-actions">
      <button type="button" className="secondary" autoFocus onClick={onCancel}>Cancel</button>
      <button type="button" className="logout-confirm-submit" onClick={onConfirm}>Log out</button>
    </div>
  </dialog>;
}
