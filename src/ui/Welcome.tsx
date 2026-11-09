import { useState } from 'react';
import { updateSettings } from '@/lib/storage';
import { useSettings, useVault } from './hooks';
import { KeySetup } from './KeySetup';
import { ImportView } from './views/ImportView';
import { InboxView } from './views/InboxView';
import { VaultView } from './views/VaultView';

/** Under three minutes from install to a usable vault, with no technical words on screen. */
export function Welcome() {
  const settings = useSettings();
  const vault = useVault();
  const [how, setHow] = useState<'import' | 'type' | null>(null);
  if (!settings || !vault) return null;
  const keyOk = !!settings.keys[settings.provider] || settings.provider === 'builtin';
  const count = vault.projects.length + vault.hackathons.length + vault.experience.length + vault.achievements.length;

  const openPanel = () => {
    const b = browser as any;
    if (b.sidebarAction) b.sidebarAction.open();
    else b.sidePanel?.open({ windowId: -2 /* current window */ }).catch?.(() => {});
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 16px 80px' }}>
      <div className="row" style={{ marginBottom: 24 }}>
        <img src="/icon/96.png" alt="" width={48} height={48} />
        <div>
          <h1 style={{ fontSize: 26 }}>Welcome to FormVault</h1>
          <p className="sub">Your projects and hackathons in one place — then any form fills itself.</p>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <section className="card">
          <h2>1. Get your free AI key</h2>
          <p className="sub">It's free and takes three clicks. No credit card.</p>
          <KeySetup settings={settings} big />
        </section>

        <section className="card" style={{ opacity: keyOk ? 1 : 0.6 }}>
          <h2>2. Fill your vault</h2>
          <p className="sub">Pick any — you can add more later.</p>
          <div className="row">
            <button className="btn" aria-pressed={how === 'import'} onClick={() => setHow('import')}>
              Paste or import (LinkedIn, chats, resume, GitHub)
            </button>
            <button className="btn" aria-pressed={how === 'type'} onClick={() => setHow('type')}>
              Type it in
            </button>
          </div>
        </section>

        {how === 'import' && (
          <>
            <ImportView vault={vault} />
            {vault.inbox.length > 0 && (
              <section className="card">
                <h2>Check what FormVault found</h2>
                <p className="sub">Tick what's right. Nothing enters your vault without your OK.</p>
                <InboxView vault={vault} />
              </section>
            )}
          </>
        )}
        {how === 'type' && <VaultView vault={vault} />}

        <section className="card" style={{ opacity: count || keyOk ? 1 : 0.6 }}>
          <h2>3. Done</h2>
          {count > 0 && (
            <p>
              Your vault has <b>{vault.projects.length} projects</b>, <b>{vault.hackathons.length} hackathons</b> and{' '}
              <b>{vault.achievements.length} awards</b>.
            </p>
          )}
          <p>
            Next time you see a form, click the <img src="/icon/16.png" alt="FormVault" style={{ verticalAlign: 'middle' }} /> icon in
            your toolbar (or press <kbd>Alt+Shift+F</kbd>). If you don't see it, pin it from the puzzle-piece menu.
          </p>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                openPanel();
                updateSettings({ onboarded: true });
              }}
            >
              Open FormVault
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
