import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Field, fieldProps } from './Field';

const meta = {
  title: 'Components/Field',
  component: Field,
  args: { id: 'nctId', label: 'NCT ID', children: null },
  render: (args) => (
    <div className="max-w-sm">
      <Field {...args}>
        <input
          className="input"
          placeholder="NCT01234567"
          {...fieldProps(args.id, args.error)}
        />
      </Field>
    </div>
  ),
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithHint: Story = { args: { hint: 'Optional until registered' } };

/** The error is announced and linked to the input for screen readers. */
export const WithError: Story = {
  args: { error: 'Format: NCT followed by 8 digits' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('NCT ID');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(
      'Format: NCT followed by 8 digits',
    );
  },
};
