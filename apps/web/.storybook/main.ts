import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  // Reuse the app's Vite config (React, Tailwind), minus the dev-server proxy.
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    server: { ...viteConfig.server, proxy: undefined },
  }),
};

export default config;
