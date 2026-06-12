import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  // WXT has no dedicated Preact module; the documented setup is the official
  // Preact Vite preset, which wires JSX to Preact for the build.
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: 'EsportsTracker (Unofficial)',
    description:
      'Track esports matches across games and protect yourself from spoilers.',
    permissions: ['storage', 'alarms', 'notifications'],
    host_permissions: ['https://api.pandascore.co/*'],
  },
});
