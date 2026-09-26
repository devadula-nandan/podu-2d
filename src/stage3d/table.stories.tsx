import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { figureUid } from '../engine/index.js';
import { EMPTY_HIGHLIGHTS, storyFigure, storyNode } from './fixtures.js';
import { TablePreview } from './TablePreview.js';

const meta = {
  title: '3D/Table',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const EmptyField: Story = {
  render: () => {
    const scene = useMemo(
      () => ({
        figures: [],
        spriteUrlOf: () => null,
        highlights: EMPTY_HIGHLIGHTS,
        flip: false,
      }),
      [],
    );
    return <TablePreview scene={scene} />;
  },
};

export const ReachHighlight: Story = {
  render: () => {
    const scene = useMemo(
      () => ({
        figures: [storyFigure(1, 0, 'r4c3')],
        spriteUrlOf: () => null,
        highlights: {
          ...EMPTY_HIGHLIGHTS,
          selectedUid: figureUid(1),
          selectedNode: storyNode('r4c3'),
          reachable: new Set(['r4c2', 'r4c4', 'r3c0', 'r4c1', 'r4c5']),
        },
        flip: false,
      }),
      [],
    );
    return <TablePreview scene={scene} />;
  },
};

export const Occupied: Story = {
  render: () => {
    const scene = useMemo(
      () => ({
        figures: [
          storyFigure(1, 0, 'r4c3'),
          storyFigure(2, 0, 'r4c1'),
          storyFigure(3, 1, 'r0c3'),
          storyFigure(4, 1, 'i0c1'),
        ],
        spriteUrlOf: () => null,
        highlights: {
          ...EMPTY_HIGHLIGHTS,
          selectedUid: figureUid(1),
          selectedNode: storyNode('r4c3'),
          battleNodes: new Set(['r4c3', 'i2c1']),
        },
        flip: false,
      }),
      [],
    );
    return <TablePreview scene={scene} />;
  },
};

export const Flipped: Story = {
  render: () => {
    const scene = useMemo(
      () => ({
        figures: [storyFigure(1, 1, 'r4c3')],
        spriteUrlOf: () => null,
        highlights: EMPTY_HIGHLIGHTS,
        flip: true,
      }),
      [],
    );
    return <TablePreview scene={scene} />;
  },
};
