import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // wxt bundles its own Vite version; the plugin works, only the types differ
  plugins: [WxtVitest() as any],
});
