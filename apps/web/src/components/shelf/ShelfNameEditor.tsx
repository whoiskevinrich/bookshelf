import { useState, useRef, useEffect } from "react";
import { useUpdateShelf } from "../../hooks/useShelves";
import { ApiError } from "../../lib/api-client";
import { track } from "../../lib/analytics";
import { inputClass } from "../../lib/form-styles";
import { Button } from "../ui/Button";

interface ShelfNameEditorProps {
  shelfId: string;
  name: string;
  /** Applied to the idle name element. Caller supplies typography. */
  className?: string;
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" />
    </svg>
  );
}

export function ShelfNameEditor({ shelfId, name, className }: ShelfNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const updateMutation = useUpdateShelf();

  // Keep draft in sync if parent name changes while not editing.
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  function openEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(name);
    setError(null);
    pencilRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > 100) return;
    setError(null);
    updateMutation.mutate(
      { shelfId, name: trimmed },
      {
        onSuccess: () => {
          setEditing(false);
          track("shelf_renamed", { shelfId });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setError("You already have a shelf with this name.");
          } else {
            setEditing(false);
            setDraft(name);
            setError("Couldn't rename shelf — please try again.");
          }
        },
      },
    );
  }

  const trimmedDraft = draft.trim();
  const saveDisabled =
    !trimmedDraft || trimmedDraft.length > 100 || trimmedDraft === name || updateMutation.isPending;

  if (editing) {
    const errorId = `shelf-name-error-${shelfId}`;
    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <label htmlFor={`shelf-name-input-${shelfId}`} className="sr-only">
            Shelf name
          </label>
          <input
            id={`shelf-name-input-${shelfId}`}
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={100}
            aria-describedby={error ? errorId : undefined}
            className={`flex-1 min-w-0 text-sm ${inputClass}`}
          />
          <Button type="button" variant="app" size="sm" disabled={saveDisabled} onClick={save}>
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            aria-label="Cancel rename"
          >
            ✕
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-red-500 dark:text-red-400 text-xs mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={`truncate ${className ?? ""}`}>{name}</span>
      <button
        ref={pencilRef}
        type="button"
        onClick={openEdit}
        aria-label={`Rename shelf ${name}`}
        className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300 transition-colors"
      >
        <PencilIcon />
      </button>
    </div>
  );
}
