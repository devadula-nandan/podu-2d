import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

/** Project Pages is `/podu-2d/`; Storybook lives under `/podu-2d/storybook/`. */
const pagesStorybookBase =
  process.env.GITHUB_PAGES === 'true' ? '/podu-2d/storybook/' : undefined;

const config: StorybookConfig = {
  stories: ['../src/stage3d/**/*.stories.tsx'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    if (pagesStorybookBase === undefined) return config;
    return mergeConfig(config, { base: pagesStorybookBase });
  },
};

export default config;
