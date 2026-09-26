import { useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import type { Scene } from 'three';
import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { makeArenaGround, makeBoardSlab, makeNodePuck } from './assets.js';
import { StageCanvas } from './StageCanvas.js';

const meta = {
  title: '3D/Lights',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Hemisphere + warm key + cool fill from `addDuelLights`. */
export const DuelRig: Story = {
  render: () => {
    const build = useCallback((scene: Scene) => {
      scene.add(makeArenaGround('dark'));
      scene.add(makeBoardSlab('dark'));
      const ball = new Mesh(new SphereGeometry(0.38, 32, 24), new MeshStandardMaterial({
        color: 0xf4efe4,
        roughness: 0.35,
        metalness: 0.15,
      }));
      ball.position.set(0, 0.55, 0);
      scene.add(ball);
      const puck = makeNodePuck('selected');
      puck.position.set(0.9, 0.04, 0.4);
      scene.add(puck);
    }, []);
    return <StageCanvas build={build} camera={[0, 4.2, 5.2]} height={560} />;
  },
};
