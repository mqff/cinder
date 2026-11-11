import { useEffect, useId, useRef, type ReactNode } from "react";
import { Glyph } from "./Glyph";

export function AppDialog({
  title,
  onClose,
  children,
  closeDisabled = false
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={heading}>{title}</h2>
        <button aria-label="Close dialog" disabled={closeDisabled} onClick={onClose}>
          <Glyph name="close" />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
