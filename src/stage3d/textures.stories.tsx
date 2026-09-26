import type { Meta, StoryObj } from '@storybook/react';
import { createArenaFloorTexture, createArenaRoughnessTexture } from './arenaTexture.js';
import { createPlateCardTexture } from './plateCard.js';
import { TextureCard } from './TextureCard.js';
import { createWoodBumpTexture, createWoodTexture } from './woodTexture.js';

const meta = {
  title: '3D/Textures',
  parameters: { layout: 'centered', backgrounds: { default: 'arena' } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const ArenaFloorNight: Story = {
  render: () => <TextureCard label="Arena floor · night" make={() => createArenaFloorTexture(768, 'dark')} />,
};

export const ArenaFloorDay: Story = {
  render: () => <TextureCard label="Arena floor · day" make={() => createArenaFloorTexture(768, 'light')} />,
};

export const ArenaRoughness: Story = {
  render: () => <TextureCard label="Arena roughness" make={() => createArenaRoughnessTexture(640)} />,
};

export const WoodNight: Story = {
  render: () => <TextureCard label="Board wood · night" make={() => createWoodTexture(768, 'dark')} />,
};

export const WoodDay: Story = {
  render: () => <TextureCard label="Board wood · day" make={() => createWoodTexture(768, 'light')} />,
};

export const WoodBump: Story = {
  render: () => <TextureCard label="Board wood bump" make={() => createWoodBumpTexture(512)} />,
};

export const PlateCardStack: Story = {
  render: () => (
    <TextureCard size={220} label="Plate · floor stack" make={() => createPlateCardTexture('X Attack', 2, 'EX', false)} />
  ),
};

export const PlateCardHand: Story = {
  render: () => (
    <TextureCard
      size={240}
      label="Plate · open hand"
      make={() =>
        createPlateCardTexture('Double Chance', 2, 'EX', false, 'Spin again once. Your turn ends.', true)
      }
    />
  ),
};

export const Atlas: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 220px)', gap: 16, padding: 16 }}>
      <TextureCard size={220} label="Arena floor · night" make={() => createArenaFloorTexture(640, 'dark')} />
      <TextureCard size={220} label="Arena floor · day" make={() => createArenaFloorTexture(640, 'light')} />
      <TextureCard size={220} label="Arena roughness" make={() => createArenaRoughnessTexture(512)} />
      <TextureCard size={220} label="Board wood · night" make={() => createWoodTexture(640, 'dark')} />
      <TextureCard size={220} label="Board wood · day" make={() => createWoodTexture(640, 'light')} />
      <TextureCard size={220} label="Board wood bump" make={() => createWoodBumpTexture(512)} />
      <TextureCard size={220} label="Plate · stack" make={() => createPlateCardTexture('X Attack', 2, 'EX', false)} />
      <TextureCard
        size={220}
        label="Plate · hand"
        make={() => createPlateCardTexture('Double Chance', 2, 'EX', false, 'Spin again once.', true)}
      />
      <TextureCard size={220} label="Plate · used" make={() => createPlateCardTexture('Full Heal', 2, 'UC', true)} />
    </div>
  ),
};
