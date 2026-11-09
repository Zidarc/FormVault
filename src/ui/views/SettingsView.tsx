import { useEffect, useState } from 'react';
import { availableModels } from '@/lib/ai/providers';
import { DRIVE_ORIGINS, connectDrive, disconnectDrive, redirectUrl, syncDrive } from '@/lib/drive';
import { download, isLocked, mergeVaults, parseVaultFile, serialiseVault } from '@/lib/backup';
import { loadVault, saveVault, updateSettings } from '@/lib/storage';
import { emptyVault, type Settings, type Vault } from '@/lib/types';
import { Card, Field, FilePick, Status } from '../components';
import { useTask } from '../hooks';
import { KeySetup } from '../KeySetup';

export function SettingsView({ vault, settings }: { vault: Vault; settings: Settings }) {
  const [models, setModels] = useState<string[]>([]);
  const [pw, setPw] = useState('');
  const [importPw, setImportPw] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [ghToken, setGhToken] = useState(settings.githubToken ?? '');
  const backup = useTask();
  const drive = useTask();

  useEffect(() => {
    availableModels(settings).then(setModels).catch(() => setModels([]));
  }, [settings.provider, settings.keys[settings.provider]]);

  const doImport = (text: string, password?: string) =>
    backup.run(async () => {
      const inc = await parseVaultFile(text, password);
      const cur = await loadVault();
      await saveVault(mergeVaults(cur, inc));
      setPending(null);
      setImportPw('');
      return `Imported: ${inc.projects.length} projects, ${inc.hackathons.length} hackathons, ${inc.answers.length} saved answers.`;
    });

  return (
    <>
      <Card title="AI" sub="Bring your own key. Gemini's free tier is enough for most students.">
        <KeySetup settings={settings} />
        {settings.provider !== 'builtin' && (
          <label className="field">
            <span>Model</span>
            {settings.provider === 'gemini' && models.length ? (
              <select
                value={settings.models.gemini ?? ''}
                onChange={(e) => updateSettings({ models: { ...settings.models, gemini: e.target.value || undefined } })}
              >
                <option value="">Automatic (Flash-Lite, then Flash) — most free requests</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                placeholder={settings.provider === 'openai' ? 'gpt-4o-mini' : settings.provider === 'anthropic' ? 'claude-haiku-5-5' : 'automatic'}
                value={settings.models[settings.provider] ?? ''}
                onChange={(e) => updateSettings({ models: { ...settings.models, [settings.provider]: e.target.value.trim() || undefined } })}
              />
            )}
          </label>
        )}
      </Card>

      <Card title="Move your vault" sub="Export it as a file and import it on another browser or account.">
        <Field label="Password (optional — locks the file)" type="password" value={pw} onChange={setPw} />
        <div className="row">
          <button
            className="btn primary"
            onClick={() =>
              backup.run(async () => {
                download(`formvault-${new Date().toISOString().slice(0, 10)}${pw ? '-locked' : ''}.json`, await serialiseVault(vault, pw || undefined));
                return pw ? 'Exported a locked file. Keep the password safe — it cannot be recovered.' : 'Exported.';
              })
            }
          >
            Export vault
          </button>
        </div>
        <FilePick
          label="Import a vault file"
          accept=".json,application/json"
          onFiles={async ([f]) => {
            const text = await f.text();
            if (isLocked(text)) setPending(text);
            else doImport(text);
          }}
        />
        {pending && (
          <div className="row">
            <input className="grow" style={{ width: 'auto' }} type="password" placeholder="This file is locked — password" value={importPw} onChange={(e) => setImportPw(e.target.value)} />
            <button className="btn primary" onClick={() => doImport(pending, importPw)}>Unlock</button>
          </div>
        )}
        <Status {...backup} />
      </Card>

      <Card
        title="Sync with Google Drive"
        sub="Keeps your vault the same on every browser. It's saved in a hidden folder in your own Drive — FormVault has no server."
      >
        {settings.driveConnected ? (
          <>
            <p className="hint">{settings.driveLastSync ? `Last synced ${new Date(settings.driveLastSync).toLocaleString()}.` : 'Connected.'} Syncs daily.</p>
            <div className="row">
              <button className="btn primary small" disabled={drive.busy} onClick={() => drive.run(async () => `Synced at ${new Date(await syncDrive(true)).toLocaleTimeString()}.`)}>
                Sync now
              </button>
              <button className="btn ghost small" onClick={() => disconnectDrive()}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <button
              className="btn"
              disabled={drive.busy}
              onClick={async () => {
                const ok = await browser.permissions.request({ origins: DRIVE_ORIGINS });
                if (!ok) return drive.setError('FormVault needs permission to reach Google Drive.');
                drive.run(async () => {
                  await connectDrive();
                  return 'Connected and synced.';
                });
              }}
            >
              Connect Google Drive
            </button>
            <details>
              <summary className="hint">Using your own Google client ID</summary>
              <p className="hint" style={{ margin: '6px 0' }}>
                Create a free OAuth client (type “Web application”) in Google Cloud Console with this redirect URI:
                <br />
                <code style={{ overflowWrap: 'anywhere' }}>{redirectUrl()}</code>
              </p>
              <input placeholder="…apps.googleusercontent.com" value={settings.driveClientId ?? ''} onChange={(e) => updateSettings({ driveClientId: e.target.value.trim() || undefined })} />
            </details>
          </>
        )}
        <Status {...drive} />
      </Card>

      <Card title="Capture as you go" sub="Small chips on LinkedIn, AI chats and email that ask “Add to vault?”. They only read a page when you tap them.">
        <label className="row">
          <input type="checkbox" style={{ width: 'auto' }} checked={settings.chipsEnabled} onChange={(e) => updateSettings({ chipsEnabled: e.target.checked })} />
          Show “Add to vault?” chips
        </label>
      </Card>

      <Card title="Form access" sub="FormVault reads a form only when you click its icon. To rescan from the panel without clicking the icon again, allow these sites:">
        <div className="row">
          <button className="btn small" onClick={() => browser.permissions.request({ origins: ['https://docs.google.com/*'] })}>
            Always allow Google Forms
          </button>
          <button className="btn small" onClick={() => browser.permissions.request({ origins: ['<all_urls>'] })}>
            Allow all sites
          </button>
        </div>
      </Card>

      <Card title="GitHub token (optional)" sub="Without one, GitHub allows 60 requests an hour — enough for most people. A token with no scopes raises it to 5,000.">
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} type="password" placeholder="github_pat_…" value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
          <button className="btn small" onClick={() => updateSettings({ githubToken: ghToken.trim() || undefined })}>Save</button>
        </div>
      </Card>

      <Card title="Danger zone">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm('Delete everything in your vault? Export it first if you want a copy.')) return;
            await saveVault(emptyVault());
          }}
        >
          Delete my vault
        </button>
      </Card>
    </>
  );
}
