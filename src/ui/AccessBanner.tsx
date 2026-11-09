import { useEffect, useState } from 'react';

// Firefox lets people switch off an MV3 add-on's site access. Without it, AI calls and syncs fail
// with confusing network errors, so check up front and offer a one-click fix.
const REQUIRED = [
  'https://generativelanguage.googleapis.com/*',
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.github.com/*',
  'https://raw.githubusercontent.com/*',
  'https://devpost.com/*',
];

export function AccessBanner() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const check = () => browser.permissions.contains({ origins: REQUIRED }).then((ok) => setMissing(!ok)).catch(() => {});
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, []);
  if (!missing) return null;
  return (
    <div className="msg err row">
      <span className="grow">FormVault can't reach the AI, GitHub or Devpost yet.</span>
      <button className="btn small primary" onClick={() => browser.permissions.request({ origins: REQUIRED })}>
        Allow
      </button>
    </div>
  );
}
