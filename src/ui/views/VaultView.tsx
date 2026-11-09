import { useEffect, useState } from 'react';
import { nowIso, uid } from '@/lib/ids';
import { relink, titleOf } from '@/lib/inbox';
import { updateVault } from '@/lib/storage';
import type { AnyEntry, Profile, SectionKey, Vault } from '@/lib/types';
import { Empty, Field, Tags } from '../components';
import { FIELD_LABELS } from './InboxView';

type Kind = 'text' | 'long' | 'tags' | 'project';
const SCHEMA: Record<SectionKey, [string, Kind][]> = {
  projects: [
    ['title', 'text'], ['role', 'text'], ['startDate', 'text'], ['endDate', 'text'], ['tech', 'tags'],
    ['summary', 'long'], ['problem', 'long'], ['built', 'long'], ['result', 'long'], ['links', 'tags'], ['description', 'long'],
  ],
  hackathons: [
    ['name', 'text'], ['organiser', 'text'], ['date', 'text'], ['team', 'tags'], ['projectId', 'project'],
    ['result', 'text'], ['postUrl', 'text'],
  ],
  experience: [['organisation', 'text'], ['role', 'text'], ['startDate', 'text'], ['endDate', 'text'], ['description', 'long']],
  achievements: [['title', 'text'], ['issuer', 'text'], ['date', 'text'], ['link', 'text'], ['description', 'long']],
};

const PROFILE_FIELDS: (keyof Profile)[] = [
  'name', 'email', 'phone', 'cnic', 'university', 'degree', 'rollNo', 'cgpa', 'graduationYear',
  'linkedin', 'github', 'portfolio', 'city', 'country',
];

const SECTIONS: { id: SectionKey | 'profile' | 'skills' | 'memory'; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'projects', label: 'Projects' },
  { id: 'hackathons', label: 'Hackathons' },
  { id: 'experience', label: 'Experience' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Answers & style' },
];

function ProfileEditor({ vault }: { vault: Vault }) {
  const [p, setP] = useState<Profile>(vault.profile);
  const [extraKey, setExtraKey] = useState('');
  useEffect(() => setP(vault.profile), [vault.profile]);
  const dirty = JSON.stringify(p) !== JSON.stringify(vault.profile);
  return (
    <div className="card">
      <p className="sub">Filled into forms directly — never sent to the AI.</p>
      <div className="grid2">
        {PROFILE_FIELDS.map((k) => (
          <Field key={k} label={FIELD_LABELS[k] ?? k} value={p[k] as string} onChange={(x) => setP({ ...p, [k]: x })} />
        ))}
      </div>
      <details>
        <summary>Other details ({Object.keys(p.extra ?? {}).length})</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {Object.entries(p.extra ?? {}).map(([k, val]) => (
            <div className="row" key={k}>
              <div className="grow">
                <Field label={k} value={val} onChange={(x) => setP({ ...p, extra: { ...p.extra, [k]: x } })} />
              </div>
              <button
                className="btn ghost small"
                onClick={() => {
                  const e = { ...p.extra };
                  delete e[k];
                  setP({ ...p, extra: e });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="row">
            <input className="grow" style={{ width: 'auto' }} placeholder="e.g. T-shirt size" value={extraKey} onChange={(e) => setExtraKey(e.target.value)} />
            <button
              className="btn small"
              disabled={!extraKey.trim()}
              onClick={() => {
                setP({ ...p, extra: { ...p.extra, [extraKey.trim()]: '' } });
                setExtraKey('');
              }}
            >
              Add field
            </button>
          </div>
        </div>
      </details>
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={() => updateVault((v) => void (v.profile = p))}>
          Save
        </button>
        {dirty && <button className="btn ghost" onClick={() => setP(vault.profile)}>Undo</button>}
      </div>
    </div>
  );
}

function EntryEditor({ vault, section, entry, onClose }: { vault: Vault; section: SectionKey; entry: AnyEntry; onClose: () => void }) {
  const [d, setD] = useState<Record<string, any>>(entry);
  const isNew = !(vault[section] as AnyEntry[]).some((e) => e.id === entry.id);
  return (
    <div className="stack">
      {SCHEMA[section].map(([k, kind]) =>
        kind === 'tags' ? (
          <label key={k} className="field">
            <span>{FIELD_LABELS[k]}</span>
            <Tags value={d[k] ?? []} onChange={(x) => setD({ ...d, [k]: x })} />
          </label>
        ) : kind === 'project' ? (
          <label key={k} className="field">
            <span>Project built</span>
            <select value={d.projectId ?? ''} onChange={(e) => setD({ ...d, projectId: e.target.value || undefined })}>
              <option value="">{d.projectTitle ? `(${d.projectTitle} — not in vault yet)` : '— none —'}</option>
              {vault.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </label>
        ) : (
          <Field key={k} label={FIELD_LABELS[k]} long={kind === 'long'} value={d[k]} onChange={(x) => setD({ ...d, [k]: x })} />
        ),
      )}
      <div className="row">
        <button
          className="btn primary"
          onClick={async () => {
            await updateVault((v) => {
              const list = v[section] as AnyEntry[];
              const next = { ...d, updatedAt: nowIso() } as AnyEntry;
              const i = list.findIndex((e) => e.id === entry.id);
              if (i >= 0) list[i] = next;
              else list.unshift(next);
              relink(v);
            });
            onClose();
          }}
        >
          Save
        </button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <span className="grow" />
        {!isNew && (
          <button
            className="btn ghost danger"
            onClick={async () => {
              if (!confirm('Delete this entry?')) return;
              await updateVault((v) => {
                (v as any)[section] = (v[section] as AnyEntry[]).filter((e) => e.id !== entry.id);
                if (section === 'projects') for (const h of v.hackathons) if (h.projectId === entry.id) h.projectId = undefined;
              });
              onClose();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function blank(section: SectionKey): AnyEntry {
  const base = { id: uid(section.slice(0, 2) + '_'), updatedAt: nowIso(), sources: [{ kind: 'manual' as const, at: nowIso() }] };
  switch (section) {
    case 'projects': return { ...base, title: '', tech: [], links: [] };
    case 'hackathons': return { ...base, name: '', team: [] };
    case 'experience': return { ...base, organisation: '' };
    case 'achievements': return { ...base, title: '' };
  }
}

function subline(vault: Vault, section: SectionKey, e: any): string {
  if (section === 'projects') return [e.startDate, e.tech?.slice(0, 4).join(', ')].filter(Boolean).join(' · ');
  if (section === 'hackathons') {
    const p = vault.projects.find((x) => x.id === e.projectId)?.title ?? e.projectTitle;
    return [e.date, e.result, p && `built ${p}`].filter(Boolean).join(' · ');
  }
  if (section === 'experience') return [e.startDate, e.endDate].filter(Boolean).join(' – ');
  return [e.issuer, e.date].filter(Boolean).join(' · ');
}

function ListEditor({ vault, section }: { vault: Vault; section: SectionKey }) {
  const [open, setOpen] = useState<AnyEntry | null>(null);
  const list = vault[section] as AnyEntry[];
  return (
    <div className="stack">
      <div className="row">
        <span className="hint grow">{list.length} saved</span>
        <button className="btn small" onClick={() => setOpen(blank(section))}>+ Add</button>
      </div>
      {open && !list.some((e) => e.id === open.id) && (
        <div className="item"><EntryEditor vault={vault} section={section} entry={open} onClose={() => setOpen(null)} /></div>
      )}
      {!list.length && !open && <Empty>Nothing here yet. Import something, or add one by hand.</Empty>}
      <div className="list">
        {list.map((e) => (
          <div className="item" key={e.id}>
            {open?.id === e.id ? (
              <EntryEditor vault={vault} section={section} entry={e} onClose={() => setOpen(null)} />
            ) : (
              <div className="item-h" style={{ cursor: 'pointer' }} onClick={() => setOpen(e)}>
                <div>
                  <h3>{titleOf(section, e as any) || 'Untitled'}</h3>
                  <p className="hint">{subline(vault, section, e)}</p>
                </div>
                <span className="hint">Edit</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsEditor({ vault }: { vault: Vault }) {
  return (
    <div className="card">
      {(['languages', 'frameworks', 'tools'] as const).map((k) => (
        <label key={k} className="field">
          <span>{FIELD_LABELS[k]}</span>
          <Tags value={vault.skills[k]} onChange={(x) => updateVault((v) => void (v.skills[k] = x))} />
        </label>
      ))}
    </div>
  );
}

function MemoryEditor({ vault }: { vault: Vault }) {
  const [rule, setRule] = useState('');
  const { draftsShown, draftsAcceptedUnedited } = vault.stats;
  return (
    <>
      <div className="card">
        <h3>Writing style</h3>
        <p className="sub">Learned from your edits. Every draft follows these.</p>
        {vault.style.map((r) => (
          <div className="row" key={r.id}>
            <span className="grow">• {r.rule}</span>
            <button className="btn ghost small" onClick={() => updateVault((v) => void (v.style = v.style.filter((x) => x.id !== r.id)))}>Remove</button>
          </div>
        ))}
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} placeholder='e.g. "first person, no buzzwords"' value={rule} onChange={(e) => setRule(e.target.value)} />
          <button
            className="btn small"
            disabled={!rule.trim()}
            onClick={() => {
              updateVault((v) => void v.style.push({ id: uid('st_'), rule: rule.trim(), createdAt: nowIso() }));
              setRule('');
            }}
          >
            Add rule
          </button>
        </div>
        {draftsShown > 0 && (
          <p className="hint">
            {Math.round((100 * draftsAcceptedUnedited) / draftsShown)}% of drafts accepted without edits ({draftsAcceptedUnedited}/{draftsShown}).
          </p>
        )}
      </div>
      <div className="card">
        <h3>Answer memory</h3>
        <p className="sub">Approved answers, reused on similar questions.</p>
        {!vault.answers.length && <p className="hint">Nothing yet — answers you approve on forms appear here.</p>}
        {vault.answers
          .slice()
          .reverse()
          .map((a) => (
            <details key={a.id} className="item">
              <summary>
                {a.question.slice(0, 90)} <span className="hint">· {a.site}</span>
              </summary>
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{a.text}</p>
              <div className="row">
                <span className="hint grow">
                  {a.wordLimit ? `${a.wordLimit}-word limit · ` : ''}
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
                <button className="btn ghost small danger" onClick={() => updateVault((v) => void (v.answers = v.answers.filter((x) => x.id !== a.id)))}>
                  Forget
                </button>
              </div>
            </details>
          ))}
      </div>
    </>
  );
}

export function VaultView({ vault }: { vault: Vault }) {
  const [sec, setSec] = useState<(typeof SECTIONS)[number]['id']>('projects');
  const counts = [
    [vault.projects.length, 'project'],
    [vault.hackathons.length, 'hackathon'],
    [vault.experience.length, 'role'],
    [vault.achievements.length, 'award'],
  ] as const;
  return (
    <>
      <div className="found">
        {counts.map(([n, w]) => (
          <span key={w} className="pill">{n} {w}{n === 1 ? '' : 's'}</span>
        ))}
      </div>
      <select value={sec} onChange={(e) => setSec(e.target.value as any)}>
        {SECTIONS.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      {sec === 'profile' && <ProfileEditor vault={vault} />}
      {sec === 'skills' && <SkillsEditor vault={vault} />}
      {sec === 'memory' && <MemoryEditor vault={vault} />}
      {sec !== 'profile' && sec !== 'skills' && sec !== 'memory' && <ListEditor key={sec} vault={vault} section={sec} />}
    </>
  );
}
