import { useRef, useState, type ReactNode } from 'react';

export function Status({ busy, progress, error, done }: { busy?: boolean; progress?: string; error?: string; done?: string }) {
  if (error) return <p className="msg err" role="alert">{error}</p>;
  if (busy) return <p className="msg busy"><span className="spinner" aria-hidden /> {progress || 'Working…'}</p>;
  if (done) return <p className="msg ok">{done}</p>;
  return null;
}

export function Card({ title, sub, children, right }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-h">
        <div>
          <h3>{title}</h3>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function FilePick({
  label,
  accept,
  multiple,
  onFiles,
  disabled,
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  onFiles: (f: File[]) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles([...e.dataTransfer.files]);
      }}
    >
      <button className="btn" disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <span className="hint">or drop it here</span>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = '';
          if (f.length) onFiles(f);
        }}
      />
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  long,
  placeholder,
  type,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  long?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {long ? (
        <textarea value={value ?? ''} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type={type ?? 'text'} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function Tags({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  return (
    <div className="tags">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder ?? 'Add…'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
