import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Pagination } from './Pagination';

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  args: { page: 1, pageSize: 20, total: 57, onPage: fn() },
} satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstPage: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('1–20 of 57')).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: 'Previous' }),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await expect(args.onPage).toHaveBeenCalledWith(2);
  },
};

export const LastPage: Story = {
  args: { page: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('41–57 of 57')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeDisabled();
  },
};
