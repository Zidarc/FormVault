import { useState } from 'react';
import { SECTION_LABELS, applyInboxItem, dismissInboxItem, titleOf } from '@/lib/inbox';
import { updateVault } from '@/lib/storage';
import type { InboxItem, SectionKey, Vault } from '@/lib/types';
import { Empty, Field, Tags } from '../components';

export const FIELD_LABELS: Record<string, string> = {
  title: 'Title', name: 'Name', organisation: 'Organisation', role: 'Role', startDate: 'Start', endDate: 'End',
  date: 'Date', tech: 'Tech', problem: 'Problem', built: 'What I built', result: 'Result', links: 'Links',
  summary: 'Summary', description: 'Description', organiser: 'Organiser', team: 'Team', projectTitle: 'Project',
  postUrl: 'Post', issuer: 'Issuer', link: 'Link', email: 'Email', phone: 'Phone', cnic: 'CNIC',
  university: 'University', degree: 'Degree', rollNo: 'Roll no', cgpa: 'CGPA', graduationYear: 'Graduation',
  linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio', city: 'City', country: 'Country',
  languages: 'Languages', frameworks: 'Frameworks', tools: 'Tools',
};
const LONG = new Set(['description', 'problem', 'built', 'summary', 'result']);

function itemTitle(v: Vault, i: InboxItem): string {
  if (i.section === 'profile') return 'Your details';
  if (i.section === 'skills') return 'New skills';
  if (i.op === 'update' && i.targetId) {
    const t = (v[i.section as SectionKey] as any[]).find((e) => e.id === i.targetId);
    if (t) return titleOf(i.section as SectionKey, t);
  }
  return titleOf(i.section as SectionKey, i.data as any) || 'Untitled';
}

const show = (x: unknown) => (Array.isArray(x) ? x.join(', ') : String(x ?? ''));

function InboxCard({ vault, item }: { vault: Vault; item: InboxItem }) {
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<Record<string, any>>(item.data);
  const isUpdate = item.op === 'update';

  return (
    <div className="item">
      <div className="item-h">
        <div>
          <div className="row" style={{ gap: 6 }}>
            <span className={`pill ${isUpdate ? 'warn' : ''}`}>
              {isUpdate ? 'Update' : 'New'} {SECTION_LABELS[item.section].toLowerCase()}
            </span>
          </div>
          <h3 style={{ marginTop: 4 }}>{itemTitle(vault, item)}</h3>
        </div>
      </div>

      {editing ? (
        <div className="stack">
          {Object.entries(data).map(([k, val]) =>
            Array.isArray(val) ? (
              <label key={k} className="field">
                <span>{FIELD_LABELS[k] ?? k}</span>
                <Tags value={val} onChange={(x) => setData({ ...data, [k]: x })} />
              </label>
            ) : (
              <Field key={k} label={FIELD_LABELS[k] ?? k} long={LONG.has(k)} value={val} onChange={(x) => setData({ ...data, [k]: x })} />
            ),
          )}
        </div>
      ) : (
        <dl className="kv">
          {Object.entries(item.data).map(([k, val]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{FIELD_LABELS[k] ?? k}</dt>
              <dd>
                {item.before?.[k] != null && (
                  <>
                    <span className="change-old">{show(item.before[k])}</span> →{' '}
                  </>
                )}
                {isUpdate && Array.isArray(val) && <>add </>}
                {show(val).slice(0, 400)}
                {show(val).length > 400 && '…'}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="hint">From {item.sources.map((s) => s.label ?? s.kind).join(' · ')}</p>
      <div className="row">
        <button
          className="btn primary small"
          onClick={() => updateVault((v) => applyInboxItem(v, item.id, editing ? data : undefined))}
        >
          {isUpdate ? 'Apply' : 'Add to vault'}
        </button>
        <button className="btn small" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel edit' : 'Edit'}
        </button>
        <button className="btn ghost small" onClick={() => updateVault((v) => dismissInboxItem(v, item.id))}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function InboxView({ vault, onImport }: { vault: Vault; onImport?: () => void }) {
  const [filter, setFilter] = useState<InboxItem['section'] | 'all'>('all');
  const items = vault.inbox.filter((i) => filter === 'all' || i.section === filter);
  const sections = [...new Set(vault.inbox.map((i) => i.section))];

  if (!vault.inbox.length)
    return (
      <Empty>
        <p><b>Your Inbox is empty.</b></p>
        <p className="hint" style={{ marginTop: 6 }}>New finds from your imports and chips land here for a quick OK.</p>
        {onImport && (
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onImport}>
            Import something
          </button>
        )}
      </Empty>
    );

  return (
    <>
      <div className="row">
        <select style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All ({vault.inbox.length})</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABELS[s]} ({vault.inbox.filter((i) => i.section === s).length})
            </option>
          ))}
        </select>
        <span className="grow" />
        <button
          className="btn small"
          onClick={() =>
            updateVault((v) => {
              // Projects first so hackathons can link to them
              const order = ['profile', 'skills', 'projects', 'experience', 'achievements', 'hackathons'];
              const ids = items
                .slice()
                .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
                .map((i) => i.id);
              for (const id of ids) applyInboxItem(v, id);
            })
          }
        >
          Approve all{filter !== 'all' ? ' shown' : ''}
        </button>
      </div>
      <div className="list">
        {items.map((i) => (
          <InboxCard key={i.id} vault={vault} item={i} />
        ))}
      </div>
    </>
  );
}
