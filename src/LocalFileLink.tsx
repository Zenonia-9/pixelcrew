import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { LocalFileReference } from "../shared/file-links";
import { editorFileUri } from "../shared/file-links";

function FileDialog({
  url,
  file,
  onClose,
}: {
  url: string;
  file: LocalFileReference;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<{ path: string; text: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "File could not be opened.");
        setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      previous?.focus();
    };
  }, [url]);
  useEffect(() => {
    if (data && file.line)
      dialog.current
        ?.querySelector(`[data-line="${file.line}"]`)
        ?.scrollIntoView({ block: "center" });
  }, [data, file.line]);
  return createPortal(
    <dialog
      ref={dialog}
      className="file-preview-dialog"
      aria-label={`File preview: ${file.path.split(/[\\/]/).at(-1)}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <strong>{file.path.split(/[\\/]/).at(-1)}</strong>
          <small>
            {data?.path || file.path}
            {file.line ? ` · line ${file.line}` : ""}
          </small>
        </div>
        {data && (
          <a
            className="secondary file-editor-link"
            href={editorFileUri(data.path, file.line)}
          >
            Open in VS Code
          </a>
        )}
        <button type="button" aria-label="Close file preview" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Opening file…</p>
      ) : (
        <pre className="file-preview-code">
          {data.text.split("\n").map((text, index) => (
            <span
              key={index}
              data-line={index + 1}
              className={file.line === index + 1 ? "highlighted" : ""}
            >
              <i aria-hidden="true">{index + 1}</i>
              {text || " "}
            </span>
          ))}
        </pre>
      )}
    </dialog>,
    document.body,
  );
}
export function LocalFileLink({
  chatId,
  file,
  children,
}: {
  chatId: string;
  file: LocalFileReference;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const url = `/api/chats/${encodeURIComponent(chatId)}/file?path=${encodeURIComponent(file.path)}`;
  return (
    <>
      <a
        className="local-file-link"
        href={url}
        title={`Open ${file.path}${file.line ? `:${file.line}` : ""}`}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && (
        <FileDialog url={url} file={file} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
