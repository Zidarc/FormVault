import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

const require = createRequire(import.meta.url);
const pkgDir = (p: string) => dirname(require.resolve(`${p}/package.json`));

// Local OCR (Tesseract): bundled so it works offline and nothing loads from a CDN.
// SIMD + LSTM only — every browser we target supports WebAssembly SIMD.
const OCR_FILES = [
  { from: join(pkgDir('tesseract.js'), 'dist/worker.min.js'), to: 'ocr/worker.min.js' },
  { from: join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), to: 'ocr/tesseract-core-simd-lstm.wasm.js' },
  { from: join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), to: 'ocr/eng.traineddata.gz' },
];

// One codebase → Firefox (first test target), Chrome, Edge, Brave.
export default defineConfig({
  srcDir: 'src',
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const f of OCR_FILES) files.push({ absoluteSrc: f.from, relativeDest: f.to });
    },
  },
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
      'identity',
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
    // WebAssembly for the OCR engine; everything else stays the MV3 default.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    action: { default_title: 'FormVault — fill this form' },
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
