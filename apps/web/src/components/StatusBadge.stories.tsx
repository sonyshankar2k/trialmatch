import type { Meta, StoryObj } from '@storybook/react-vite';
import { TRIAL_STATUSES } from '@trialmatch/shared';
import { StatusBadge } from './StatusBadge';

const meta = {
  title: 'Components/StatusBadge',
  component: StatusBadge,
  args: { status: 'recruiting' },
  argTypes: { status: { control: 'select', options: TRIAL_STATUSES } },
} satisfies Meta<typeof StatusBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Recruiting: Story = {};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {TRIAL_STATUSES.map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};
