import { useEffect, useState } from 'react';
import { inboxSummary } from '@/lib/inbox';
import { importChats } from '@/lib/import/chats';
import { syncDevpost } from '@/lib/import/devpost';
import { syncGitHub } from '@/lib/import/github';
import { importLinkedIn } from '@/lib/import/linkedin';
import { googleDocId, importCertificates, importResumeDocx, importResumePdf, syncResumeDoc } from '@/lib/import/resume';
import { updateSettings } from '@/lib/storage';
import type { Vault } from '@/lib/types';
import { Card, FilePick, Status } from '../components';
import { QuickAdd } from '../QuickAdd';
import { useSettings, useTask } from '../hooks';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const found = (n: number) => (n ? `Found ${plural(n, 'thing')} — check your Inbox.` : 'Nothing new found.');

export function ImportView({ vault, onOpenInbox }: { vault: Vault; onOpenInbox?: () => void }) {
  const settings = useSettings();
  const li = useTask();
  const chats = useTask();
  const resume = useTask();
  const gh = useTask();
  const dp = useTask();
  const certs = useTask();
  const [ghUser, setGhUser] = useState('');
  const [dpUser, setDpUser] = useState('');
  const [docUrl, setDocUrl] = useState('');

  useEffect(() => {
    if (!settings) return;
    setGhUser((x) => x || settings.githubUser || '');
    setDpUser((x) => x || settings.devpostUser || '');
    setDocUrl((x) => x || settings.resumeDocUrl || '');
  }, [settings]);

  const summary = inboxSummary(vault);
  const anyBusy = [li, chats, resume, gh, dp, certs].some((t) => t.busy);

  return (
    <>
      {summary && (
        <div className="card" style={{ background: 'var(--accent-soft)' }}>
          <div className="row">
            <div className="grow">
              <b>Waiting in your Inbox:</b> {summary}
            </div>
            {onOpenInbox && (
              <button className="btn primary small" onClick={onOpenInbox}>
                Review
              </button>
            )}
          </div>
        </div>
      )}

      <QuickAdd onOpenInbox={onOpenInbox} />

      <h2 className="section-h">Or connect a source</h2>

      <Card
        title="LinkedIn"
        sub={
          <>
            Upload your data export (.zip).{' '}
            <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer">
              Get it here
            </a>{' '}
            — choose "Download larger data archive" to include your posts.
          </>
        }
      >
        <FilePick
          label="Upload LinkedIn export"
          accept=".zip,.csv"
          disabled={li.busy}
          onFiles={([f]) =>
            li.run(async (p) => {
              const r = await importLinkedIn(f, p);
              return `${found(r.structured + r.fromPosts)} (${plural(r.postsSent, 'post')} read by AI.)`;
            })
          }
        />
        <Status {...li} />
      </Card>

      <Card
        title="AI chats"
        sub={
          <>
            Upload an export from{' '}
            <a href="https://chatgpt.com/#settings/DataControls" target="_blank" rel="noreferrer">ChatGPT</a>,{' '}
            <a href="https://claude.ai/settings/data-privacy-controls" target="_blank" rel="noreferrer">Claude</a> or{' '}
            <a href="https://takeout.google.com/" target="_blank" rel="noreferrer">Gemini (Google Takeout → My Activity)</a>.
            Only chats about your own work are read.
          </>
        }
      >
        <FilePick
          label="Upload chat export"
          accept=".zip,.json,.html"
          disabled={chats.busy}
          onFiles={([f]) =>
            chats.run(async (p) => {
              const r = await importChats(f, p);
              return `${plural(r.convos, 'chat')}, ${r.relevant} about your work. ${found(r.found)}`;
            })
          }
        />
        <Status {...chats} />
      </Card>

      <Card title="Resume" sub="Upload a PDF or Word file (scans are fine), or link a Google Doc — FormVault re-reads the doc when it changes.">
        <FilePick
          label="Upload resume"
          accept="application/pdf,.docx"
          disabled={resume.busy}
          onFiles={([f]) =>
            resume.run(async (p) => found(/.docx$/i.test(f.name) ? await importResumeDocx(f, p) : await importResumePdf(f, p)))
          }
        />
        <div className="row">
          <input
            className="grow"
            style={{ width: 'auto' }}
            placeholder="https://docs.google.com/document/d/…"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
          />
          <button
            className="btn"
            disabled={!googleDocId(docUrl) || resume.busy}
            onClick={async () => {
              // Must be the first await: permission prompts need the click gesture.
              const ok = await browser.permissions.request({ origins: ['https://docs.google.com/*'] });
              if (!ok) return resume.setError('FormVault needs permission to read docs.google.com to link your resume.');
              resume.run(async (p) => {
                await updateSettings({ resumeDocUrl: docUrl.trim(), resumeDocHash: undefined });
                const n = await syncResumeDoc(p, true);
                return found(n ?? 0);
              });
            }}
          >
            Link
          </button>
        </div>
        <Status {...resume} />
      </Card>

      <Card
        title="GitHub"
        sub={
          <>
            Your public repos sync automatically once a day.
            {settings?.lastSync?.github && <> Last sync {new Date(settings.lastSync.github).toLocaleString()}.</>}
          </>
        }
      >
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} placeholder="GitHub username" value={ghUser} onChange={(e) => setGhUser(e.target.value)} />
          <button
            className="btn"
            disabled={!ghUser.trim() || gh.busy}
            onClick={() =>
              gh.run(async (p) => {
                const first = settings?.githubUser !== ghUser.trim();
                await updateSettings({ githubUser: ghUser.trim() });
                return found(await syncGitHub(p, first));
              })
            }
          >
            Sync
          </button>
        </div>
        <Status {...gh} />
      </Card>

      <Card title="Devpost" sub="Paste your profile link. New hackathons and projects are picked up automatically.">
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} placeholder="https://devpost.com/your-name" value={dpUser} onChange={(e) => setDpUser(e.target.value)} />
          <button
            className="btn"
            disabled={!dpUser.trim() || dp.busy}
            onClick={() =>
              dp.run(async (p) => {
                await updateSettings({ devpostUser: dpUser.trim() });
                return found(await syncDevpost(p));
              })
            }
          >
            Sync
          </button>
        </div>
        <Status {...dp} />
      </Card>

      <Card title="Certificates" sub="Upload PDFs or photos of certificates and awards.">
        <FilePick
          label="Upload certificates"
          accept="application/pdf,image/*"
          multiple
          disabled={certs.busy}
          onFiles={(f) => certs.run(async (p) => found(await importCertificates(f, p)))}
        />
        <Status {...certs} />
      </Card>

      {anyBusy && <p className="hint">You can keep using the panel — imports keep running.</p>}
    </>
  );
}
