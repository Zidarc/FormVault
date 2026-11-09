import { useRef, useState } from 'react';
import { clearFinished, enqueueFiles, enqueueText, filesFrom, retry, useJobs, type Job } from './queue';

const ACCEPT = 'image/*,.pdf,.docx,.zip,.json,.csv,.html,.htm,.txt,.md';

function JobRow({ job, onOpenInbox }: { job: Job; onOpenInbox?: () => void }) {
  return (
    <div className={`job ${job.status}`}>
      {job.thumb ? <img src={job.thumb} alt="" /> : <span className="job-icon" aria-hidden>{job.name.startsWith('“') ? '✎' : '▤'}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="job-name">{job.name}</div>
        <div className="hint" role={job.status === 'error' ? 'alert' : undefined}>
          {job.status === 'waiting' && 'Waiting…'}
          {job.status === 'working' && (
            <>
              <span className="spinner" aria-hidden /> {job.progress}
            </>
          )}
          {(job.status === 'done' || job.status === 'error') && job.result}
        </div>
      </div>
      {job.status === 'done' && !!job.found && onOpenInbox && (
        <button className="btn small" onClick={onOpenInbox}>
          Review
        </button>
      )}
      {job.status === 'error' && (
        <button className="btn small" onClick={() => retry(job.id)}>
          Try again
        </button>
      )}
    </div>
  );
}

/** One box for everything: type or paste text, paste a screenshot, or drop any files. */
export function QuickAdd({ onOpenInbox }: { onOpenInbox?: () => void }) {
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jobs = useJobs();
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error').length;

  const submitText = () => {
    if (!text.trim()) return;
    enqueueText(text);
    setText('');
  };

  return (
    <section
      className={`card quick ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = filesFrom(e.dataTransfer);
        if (files.length) enqueueFiles(files);
        else {
          const t = e.dataTransfer.getData('text/plain');
          if (t.trim()) enqueueText(t);
        }
      }}
    >
      <header className="card-h">
        <div>
          <h3>Quick add</h3>
          <p className="sub">
            Drop anything here — a resume, certificate photos, screenshots, your LinkedIn or ChatGPT export. Or paste text or a
            screenshot (Ctrl+V). FormVault works out what it is.
          </p>
        </div>
      </header>
      <textarea
        rows={4}
        value={text}
        placeholder="Paste a post, notes, a project description — or a screenshot…"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = filesFrom(e.clipboardData);
          if (files.length) {
            e.preventDefault();
            enqueueFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submitText();
          }
        }}
      />
      <div className="row">
        <button className="btn primary" disabled={!text.trim()} onClick={submitText} title="Ctrl+Enter">
          Add text
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Choose files
        </button>
        <span className="hint grow">{over ? 'Drop to add' : 'or drop files here'}</span>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            const f = [...(e.target.files ?? [])];
            e.target.value = '';
            if (f.length) enqueueFiles(f);
          }}
        />
      </div>
      {!!jobs.length && (
        <div className="jobs">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onOpenInbox={onOpenInbox} />
          ))}
          {finished > 0 && (
            <button className="btn ghost small" style={{ alignSelf: 'flex-end' }} onClick={clearFinished}>
              Clear finished
            </button>
          )}
        </div>
      )}
      <p className="hint">Images are read on your computer; only the text (minus your contact details) goes to the AI.</p>
    </section>
  );
}
