import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function ImageDialog({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="image-preview-dialog"
      aria-label={`Image preview: ${name}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-preview-heading">
        <span>{name}</span>
        <button
          type="button"
          aria-label="Close image preview"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      {failed ? (
        <p role="alert">
          This image is unavailable. Close the preview and try again.
        </p>
      ) : (
        <img src={src} alt={name} onError={() => setFailed(true)} />
      )}
    </dialog>,
    document.body,
  );
}

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  return (
    <>
      <button
        type="button"
        className="image-thumbnail"
        aria-label={`Preview image: ${name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (failed) {
            setFailed(false);
            setAttempt((value) => value + 1);
          } else setOpen(true);
        }}
      >
        {failed ? (
          <span className="image-unavailable">
            {name}
            <small>Image unavailable · Click to retry</small>
          </span>
        ) : (
          <img
            key={attempt}
            src={src}
            alt={name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </button>
      {open && (
        <ImageDialog src={src} name={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
