import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { TagInput } from './TagInput';

function Controlled({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="max-w-md">
      <label htmlFor="conditions" className="label">
        Conditions
      </label>
      <TagInput
        id="conditions"
        value={value}
        onChange={setValue}
        placeholder="e.g. Type 2 diabetes"
      />
    </div>
  );
}

const meta = {
  title: 'Components/TagInput',
  component: Controlled,
  args: { initial: [] },
} satisfies Meta<typeof Controlled>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithTerms: Story = {
  args: { initial: ['Type 2 diabetes', 'Hypertension'] },
};

/** Enter adds, duplicates are ignored (any case), × removes. */
export const AddAndRemove: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Conditions');
    await userEvent.type(input, 'Asthma{Enter}asthma{Enter}COPD{Enter}');
    await expect(
      canvas
        .getAllByRole('listitem')
        .map((li) => li.textContent?.replace('×', '')),
    ).toEqual(['Asthma', 'COPD']);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Remove Asthma' }),
    );
    await expect(canvas.queryByText('Asthma')).toBeNull();
  },
};
