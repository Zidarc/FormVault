import { defineConfig } from 'wxt';

// One codebase → Firefox (first test target), Chrome, Edge, Brave.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'FormVault',
    description:
      'Your projects, hackathons and achievements in one private vault — then fill any form from it.',
    permissions: [
      'storage',
      'unlimitedStorage',
      'activeTab',
      'scripting',
      'contextMenus',
      'alarms',
      ...(browser === 'firefox' ? [] : ['sidePanel']),
    ],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://api.github.com/*',
      'https://raw.githubusercontent.com/*',
      'https://devpost.com/*',
    ],
    optional_host_permissions: ['https://docs.google.com/*', 'https://www.googleapis.com/*', '<all_urls>'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Open FormVault and scan this form',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'formvault@zidarc.dev',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  }),
});
