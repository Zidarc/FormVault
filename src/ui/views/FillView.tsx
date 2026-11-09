import { useCallback, useEffect, useRef, useState } from 'react';
import { NoAccessError, activeTab, fillTab, focusField, readTab, scanTab } from '@/lib/fill/client';
import { draftForm, rewrite, siteOf, writeFromEntry, type Draft, type RewriteKind } from '@/lib/fill/draft';
import { learnFromForm, type LearnResult } from '@/lib/fill/learn';
import { checklistText } from '@/lib/fill/pick';
import type { ScanResult } from '@/lib/fill/types';
import { wordCount } from '@/lib/text';
import type { Settings, Vault } from '@/lib/types';
import { Empty, Status } from '../components';

const ORIGIN_PILL: Record<Draft['origin'], string> = {
  profile: 'ok', memory: 'ok', adapted: 'ok', ai: '', pick: '', checklist: '', none: 'warn', skip: 'warn',
};

function DraftCard({
  d,
  onChange,
  vault,
  settings,
  tabId,
}: {
  d: Draft;
  onChange: (p: Partial<Draft>) => void;
  vault: Vault;
  settings: Settings;
  tabId: number | null;
}) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const f = d.field;
  const long = f.kind === 'textarea' || f.kind === 'contenteditable' || !!f.wordLimit || String(d.answer).length > 80;
  const words = typeof d.answer === 'string' ? wordCount(d.answer) : 0;
  const over = f.wordLimit ? words > f.wordLimit : f.charLimit ? String(d.answer).length > f.charLimit : false;

  const doRewrite = async (k: RewriteKind) => {
    setBusy(k);
    setErr('');
    try {
      onChange({ answer: await rewrite(d, k, vault, settings), approved: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const choose = async (id: string) => {
    setBusy('pick');
    setErr('');
    try {
      const text = await writeFromEntry(d, id, vault, settings);
      onChange({ answer: text, original: text, sources: [id], approved: true, pick: d.pick && { ...d.pick, chosen: id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="item" style={d.approved ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="item-h">
        <button
          className="btn ghost"
          style={{ padding: 0, textAlign: 'left', color: 'var(--ink)', fontWeight: 600 }}
          title="Show this field on the page"
          onClick={() => tabId != null && focusField(tabId, f)}
        >
          {f.question || '(no label)'}
          {f.required && <span style={{ color: 'var(--err)' }}> *</span>}
        </button>
        {d.origin !== 'skip' && (
          <label className="row" style={{ gap: 4, flex: 'none' }} title="Fill this answer">
            <input type="checkbox" style={{ width: 'auto' }} checked={d.approved} onChange={(e) => onChange({ approved: e.target.checked })} />
            <span className="hint">Use</span>
          </label>
        )}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className={`pill ${ORIGIN_PILL[d.origin]}`}>{d.label}</span>
        {f.wordLimit && (
          <span className={`pill ${over ? 'warn' : ''}`}>
            {words}/{f.wordLimit} words
          </span>
        )}
      </div>

      {d.pick && !d.pick.chosen && (
        <div className="list">
          {d.pick.candidates.map((c) => (
            <button key={c.id} className="item btn" style={{ textAlign: 'left', fontWeight: 400 }} disabled={!!busy} onClick={() => choose(c.id)}>
              <b>{c.title}</b>
              {c.sub && <span className="hint">{c.sub}</span>}
            </button>
          ))}
        </div>
      )}

      {d.checklist && (
        <div className="stack" style={{ gap: 4 }}>
          {d.checklist.items.map((it) => (
            <label key={it.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={it.checked}
                onChange={(e) => {
                  const items = d.checklist!.items.map((x) => (x.id === it.id ? { ...x, checked: e.target.checked } : x));
                  const ids = items.filter((x) => x.checked).map((x) => x.id);
                  onChange({ checklist: { ...d.checklist!, items }, answer: checklistText(vault, d.checklist!.section, ids), sources: ids });
                }}
              />
              {it.label}
            </label>
          ))}
        </div>
      )}

      {d.origin !== 'skip' && (!d.pick || d.pick.chosen) && (
        <>
          {f.kind === 'checkbox' && f.options ? (
            <div className="stack" style={{ gap: 4 }}>
              {f.options.map((o) => {
                const cur = Array.isArray(d.answer) ? d.answer : [];
                return (
                  <label key={o} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={cur.includes(o)}
                      onChange={(e) => onChange({ answer: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o), approved: true })}
                    />
                    {o}
                  </label>
                );
              })}
            </div>
          ) : (f.kind === 'select' || f.kind === 'radio') && f.options ? (
            <select value={String(d.answer)} onChange={(e) => onChange({ answer: e.target.value, approved: !!e.target.value })}>
              <option value="">— choose —</option>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : long ? (
            <textarea rows={Math.min(10, Math.max(3, Math.ceil(String(d.answer).length / 60)))} value={String(d.answer)} onChange={(e) => onChange({ answer: e.target.value, approved: true })} />
          ) : (
            <input value={String(d.answer)} onChange={(e) => onChange({ answer: e.target.value, approved: true })} />
          )}
          {long && typeof d.answer === 'string' && d.answer && (
            <div className="row" style={{ gap: 4 }}>
              {(['shorter', 'longer', 'formal', 'numbers'] as RewriteKind[]).map((k) => (
                <button key={k} className="btn small" disabled={!!busy} onClick={() => doRewrite(k)}>
                  {busy === k ? '…' : k === 'formal' ? 'More formal' : k === 'numbers' ? 'Add numbers' : k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
              {d.pick?.chosen && (
                <button className="btn small ghost" onClick={() => onChange({ pick: { ...d.pick!, chosen: undefined }, answer: '', approved: false })}>
                  Pick another
                </button>
              )}
            </div>
          )}
        </>
      )}
      {busy === 'pick' && <Status busy progress="Writing from your pick…" />}
      {err && <Status error={err} />}
    </div>
  );
}

export function FillView({ vault, settings, onOpenSettings }: { vault: Vault; settings: Settings; onOpenSettings: () => void }) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [needsAccess, setNeedsAccess] = useState(false);
  const [changed, setChanged] = useState(false);
  const [result, setResult] = useState<{ filled: number; failed: string[]; learn?: LearnResult } | null>(null);
  const vaultRef = useRef(vault);
  vaultRef.current = vault;

  const hasKey = !!settings.keys[settings.provider] || settings.provider === 'builtin';

  const run = useCallback(
    async (id?: number) => {
      setError('');
      setResult(null);
      setChanged(false);
      setNeedsAccess(false);
      const tid = id ?? (await activeTab())?.id;
      if (tid == null) return;
      setTabId(tid);
      try {
        setBusy('Reading the form…');
        const s = await scanTab(tid);
        setScan(s);
        if (!s.fields.length) {
          setDrafts([]);
          return;
        }
        if (!hasKey) {
          setError('Add your free AI key in Settings to draft answers. Profile fields still work.');
        }
        const d = await draftForm(s, vaultRef.current, settings, setBusy, { noAi: !hasKey }).catch(async (e) => {
          setError(e instanceof Error ? e.message : String(e));
          // AI failed (limit, network…) — still show profile fills and saved answers
          return draftForm(s, vaultRef.current, settings, undefined, { noAi: true });
        });
        setDrafts(d);
      } catch (e) {
        if (e instanceof NoAccessError) setNeedsAccess(true);
        else setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy('');
      }
    },
    [settings, hasKey],
  );

  // Icon click → the background asks us to scan.
  useEffect(() => {
    const check = async () => {
      const { scanRequest } = (await browser.storage.session.get('scanRequest')) as { scanRequest?: { tabId: number; at: number; blocked?: boolean } };
      if (scanRequest && Date.now() - scanRequest.at < 30_000) {
        await browser.storage.session.remove('scanRequest');
        if (scanRequest.blocked) setError("FormVault can't read this page (browser pages and the add-on store are off-limits).");
        else run(scanRequest.tabId);
      }
    };
    check();
    const l = (changes: Record<string, unknown>, area: string) => area === 'session' && 'scanRequest' in changes && check();
    browser.storage.onChanged.addListener(l);
    const m = (msg: any) => {
      if (msg?.type === 'fv:pageChanged') setChanged(true);
    };
    browser.runtime.onMessage.addListener(m);
    return () => {
      browser.storage.onChanged.removeListener(l);
      browser.runtime.onMessage.removeListener(m);
    };
  }, [run]);

  const update = (i: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const approved = drafts.filter((d) => d.approved && d.origin !== 'skip' && (Array.isArray(d.answer) ? d.answer.length : String(d.answer).trim()));

  const fill = async () => {
    if (tabId == null || !scan) return;
    setBusy('Filling…');
    setError('');
    try {
      const outcomes = await fillTab(
        tabId,
        approved.map((d) => ({ id: d.field.id, frameId: d.field.frameId, value: d.answer })),
      );
      const failed = outcomes.filter((o) => !o.ok).map((o) => {
        const d = approved.find((x) => x.field.id === o.id);
        return `${d?.field.question ?? o.id}: ${o.reason ?? 'could not fill'}`;
      });
      setResult({ filled: outcomes.filter((o) => o.ok).length, failed });
      setBusy('Learning from your answers…');
      const typed = await readTab(tabId, drafts.map((d) => d.field)).catch(() => ({}));
      const learn = await learnFromForm(approved, siteOf(scan), settings, typed);
      setResult({ filled: outcomes.filter((o) => o.ok).length, failed, learn });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="row">
        <div className="grow">
          <h2>{scan ? scan.title || 'This form' : 'Fill a form'}</h2>
          {scan && <p className="hint">{scan.fields.length} fields found{scan.isGoogleForm ? ' · Google Form' : ''}</p>}
        </div>
        <button className="btn" disabled={!!busy} onClick={() => run()}>
          {scan ? 'Rescan' : 'Scan this page'}
        </button>
      </div>

      {changed && (
        <div className="msg busy">
          The form changed (next page?). <button className="btn small" onClick={() => run(tabId ?? undefined)}>Rescan</button>
        </div>
      )}
      {needsAccess && (
        <div className="card">
          <p>
            <b>Click the FormVault icon</b> in the toolbar while you're on the form (or press <kbd>Alt+Shift+F</kbd>). FormVault only reads a page when you
            ask it to.
          </p>
          <button className="btn small" onClick={onOpenSettings}>Always allow some sites…</button>
        </div>
      )}
      <Status busy={!!busy} progress={busy} error={error} />
      {!hasKey && !busy && (
        <p className="msg err">
          No AI key yet. <button className="btn small" onClick={onOpenSettings}>Add a free key</button>
        </p>
      )}

      {!scan && !busy && !needsAccess && (
        <Empty>
          <p><b>Open a form, then click the FormVault icon.</b></p>
          <p className="hint" style={{ marginTop: 6 }}>Answers come from your vault. You review everything before it goes into the page, and FormVault never presses Submit.</p>
        </Empty>
      )}
      {scan && !scan.fields.length && !busy && <Empty>No form fields found on this page.</Empty>}

      {result && (
        <div className="card">
          <p className="msg ok">
            Filled {result.filled} field{result.filled === 1 ? '' : 's'}. Check the page and press Submit yourself.
          </p>
          {result.failed.map((f) => (
            <p key={f} className="msg err">{f}</p>
          ))}
          {result.learn && (
            <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
              {result.learn.saved > 0 && <li>Saved {result.learn.saved} answer{result.learn.saved === 1 ? '' : 's'} for next time.</li>}
              {result.learn.newRules.map((r) => (
                <li key={r}>Learned: “{r}”</li>
              ))}
              {result.learn.profileUpdates + result.learn.inboxFinds > 0 && <li>New facts from this form are waiting in your Inbox.</li>}
            </ul>
          )}
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div className="row">
            <span className="hint grow">{approved.length} of {drafts.length} ready</span>
            <button className="btn small" onClick={() => setDrafts((ds) => ds.map((d) => (d.origin === 'skip' || d.pick && !d.pick.chosen ? d : { ...d, approved: !!(Array.isArray(d.answer) ? d.answer.length : String(d.answer).trim()) })))}>
              Use all
            </button>
          </div>
          <div className="list">
            {drafts.map((d, i) => (
              <DraftCard key={d.field.frameId + ':' + d.field.id} d={d} onChange={(p) => update(i, p)} vault={vault} settings={settings} tabId={tabId} />
            ))}
          </div>
          <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '8px 0' }}>
            <button className="btn primary" style={{ width: '100%' }} disabled={!approved.length || !!busy} onClick={fill}>
              Fill {approved.length} answer{approved.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
