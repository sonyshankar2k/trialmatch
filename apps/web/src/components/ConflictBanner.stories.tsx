import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConflictBanner } from './ConflictBanner';

const meta = {
  title: 'Components/ConflictBanner',
  component: ConflictBanner,
  args: { onReload: fn(), onOverwrite: fn() },
} satisfies Meta<typeof ConflictBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Someone else saved this record',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: 'Load their version' }),
    );
    await expect(args.onReload).toHaveBeenCalledOnce();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save mine anyway' }),
    );
    await expect(args.onOverwrite).toHaveBeenCalledOnce();
  },
};
