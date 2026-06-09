import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifest: {
    name: 'EsportsTracker (Unofficial)',
    description:
      'Track esports matches across games and protect yourself from spoilers.',
    permissions: ['storage', 'alarms', 'notifications'],
    host_permissions: [
      'https://api.pandascore.co/*',
      '*://*.youtube.com/*',
      '*://liquipedia.net/*',
    ],
  },
});
