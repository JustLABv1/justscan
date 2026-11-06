'use client';

import { FileArchive, Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Drop a file here or click to browse. `accept` is a comma-separated list of
 * extensions (".tar,.tgz"), enforced for dropped files too.
 */
export function FileDropzone({
  file,
  onFileChange,
  accept,
  title = 'Drop a file here',
  hint,
  disabled,
  'aria-label': ariaLabel,
  className,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  title?: string;
  hint?: string;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const extensions = (accept ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  function choose(next: File | undefined) {
    if (!next) return;
    if (extensions.length > 0 && !extensions.some((ext) => next.name.toLowerCase().endsWith(ext))) {
      setError(`Unsupported file type. Use ${extensions.join(', ')}.`);
      return;
    }
    setError('');
    onFileChange(next);
  }

  function browse() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={-1}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
            <FileArchive aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={file.name}>
              {file.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={browse}
            disabled={disabled}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Replace
          </button>
          <button
            type="button"
            aria-label="Remove file"
            onClick={() => {
              setError('');
              onFileChange(null);
            }}
            disabled={disabled}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label={ariaLabel ?? title}
          onClick={browse}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              browse();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) choose(event.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-colors',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
            dragging ? 'border-primary bg-primary/5' : 'border-input bg-muted/20 hover:bg-muted/40',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span
            className={cn(
              'flex size-11 items-center justify-center rounded-xl ring-1 transition-colors',
              dragging
                ? 'bg-primary/10 text-primary ring-primary/30'
                : 'bg-background text-muted-foreground ring-border'
            )}
          >
            <Upload aria-hidden className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {dragging ? 'Release to upload' : title}
            </p>
            <p className="text-xs text-muted-foreground">
              or <span className="text-foreground underline underline-offset-2">browse</span>
              {hint ? ` · ${hint}` : ''}
            </p>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
