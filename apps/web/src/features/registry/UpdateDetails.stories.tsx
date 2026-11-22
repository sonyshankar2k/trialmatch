import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TrialUpdate } from '@trialmatch/shared';
import { expect, fn, userEvent, within } from 'storybook/test';
import { UpdateDetails } from './RegistryUpdate';

const update: TrialUpdate = {
  id: 5,
  revision: 1,
  trialVersion: 1,
  trialId: 7,
  nctId: 'NCT90000001',
  registryLastUpdated: '2026-11-19',
  fields: [
    {
      field: 'status',
      current: 'recruiting',
      registry: 'active_not_recruiting',
    },
    { field: 'minAge', current: 18, registry: 16 },
    {
      field: 'sponsor',
      current: null,
      registry: 'University Hospital Example',
    },
  ],
  criteria: {
    added: [{ type: 'exclusion', text: 'Pregnancy or breastfeeding' }],
    removed: [
      { type: 'inclusion', text: 'Uses an inhaled steroid', inTrial: true },
    ],
  },
  warnings: [
    'The minimum age was given in months (192 months); rounded to 16 years.',
  ],
  status: 'pending',
  detectedAt: '2026-11-20T06:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

/** Week 8: a registry change waiting for a decision, next to what TrialMatch has. */
const meta = {
  title: 'Registry/UpdateDetails',
  component: UpdateDetails,
  args: { update, onApply: fn(), onKeep: fn() },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof UpdateDetails>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('row', { name: /Minimum age/ }),
    ).toHaveTextContent('18 years16 years');
    await expect(
      canvas.getByRole('row', { name: /Sponsor/ }),
    ).toHaveTextContent('None');
    await userEvent.click(canvas.getByRole('button', { name: 'Apply update' }));
    await expect(args.onApply).toHaveBeenCalledOnce();
  },
};

/** Applying waits until the form's own edits are saved or discarded. */
export const WithUnsavedEdits: Story = {
  args: { unsavedChanges: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Apply update' }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole('button', { name: 'Keep current version' }),
    ).toBeEnabled();
  },
};

/** A criterion the registry removed was reworded here: Apply waits for a confirmation. */
export const WithRewordedCriterion: Story = {
  args: {
    update: {
      ...update,
      criteria: {
        added: [{ type: 'inclusion', text: 'Aged 16 or over' }],
        removed: [
          { type: 'inclusion', text: 'Aged 18 or over', inTrial: false },
        ],
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const apply = canvas.getByRole('button', { name: 'Apply update' });
    await expect(apply).toBeDisabled();
    await userEvent.click(canvas.getByRole('checkbox'));
    await userEvent.click(apply);
    await expect(args.onApply).toHaveBeenCalledWith(true);
  },
};
