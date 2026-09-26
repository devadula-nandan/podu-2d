import { useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import type { Scene } from 'three';
import {
  makeArenaGround,
  makeBoardSlab,
  makeEntryRing,
  makeFigureSprite,
  makeGoalArrow,
  makeNodePuck,
  makeRouteBar,
} from './assets.js';
import { StageCanvas } from './StageCanvas.js';

const meta = {
  title: '3D/Meshes',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const NodePuck: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      const row = [-0.9, -0.3, 0.3, 0.9];
      const kinds = ['route', 'reach', 'battle', 'selected'] as const;
      kinds.forEach((kind, i) => {
        const puck = makeNodePuck(kind);
        puck.position.set(row[i] ?? 0, 0.04, 0);
        scene.add(puck);
      });
    }, []);
    return <StageCanvas build={build} camera={[0, 2.4, 3.2]} height={360} />;
  },
};

export const EntryRing: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      const puck = makeNodePuck('route');
      puck.position.set(0, 0.04, 0);
      const ring = makeEntryRing();
      ring.position.set(0, 0.04, 0);
      scene.add(puck, ring);
    }, []);
    return <StageCanvas build={build} camera={[0, 2.2, 2.8]} height={360} />;
  },
};

export const RouteBar: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      scene.add(makeRouteBar(-1.1, 0, 1.1, 0, 0.04));
      scene.add(makeRouteBar(0, -0.8, 0, 0.8, 0.04, 'reach'));
    }, []);
    return <StageCanvas build={build} camera={[0, 2.6, 3.4]} height={360} />;
  },
};

export const GoalArrow: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      const blue = makeGoalArrow(1);
      blue.position.set(-0.7, 0.04, 0);
      const red = makeGoalArrow(-1);
      red.position.set(0.7, 0.04, 0);
      scene.add(blue, red);
    }, []);
    return <StageCanvas build={build} camera={[0, 2.4, 3]} height={360} />;
  },
};

export const FigureSprite: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      const idle = makeFigureSprite(null);
      idle.position.set(-0.4, 0, 0);
      const picked = makeFigureSprite(null, true);
      picked.position.set(0.4, 0, 0);
      scene.add(idle, picked);
    }, []);
    return <StageCanvas build={build} camera={[0, 1.6, 2.4]} height={360} />;
  },
};

export const BoardSlab: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      scene.add(makeBoardSlab('dark'));
    }, []);
    return <StageCanvas build={build} camera={[0, 6, 7]} height={480} />;
  },
};

export const ArenaGround: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
    }, []);
    return <StageCanvas build={build} camera={[0, 8, 6]} height={480} />;
  },
};

export const BoardSlabDay: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('light'));
      scene.add(makeBoardSlab('light'));
    }, []);
    return <StageCanvas build={build} camera={[0, 6, 7]} height={480} />;
  },
};

export const PuckKinds: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      (['route', 'reach', 'battle', 'selected'] as const).forEach((kind, i) => {
        const puck = makeNodePuck(kind, 0.16);
        puck.position.set(-1.2 + i * 0.8, 0.04, 0);
        scene.add(puck);
      });
    }, []);
    return <StageCanvas build={build} camera={[0, 2.8, 3.6]} height={360} />;
  },
};
