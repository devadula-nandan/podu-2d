import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'arena',
      values: [
        { name: 'arena', value: '#1a0e0a' },
        { name: 'night', value: '#0b1016' },
        { name: 'paper', value: '#f4efe4' },
      ],
    },
  },
};

export default preview;
