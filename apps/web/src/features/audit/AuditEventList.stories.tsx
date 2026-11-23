import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { AuditEventList } from './AuditEventList';
import { makeEvent, sampleHistory } from './audit-fixtures';

/** Week 9: a record's history, newest first. Free-text notes are never shown. */
const meta = {
  title: 'Audit/AuditEventList',
  component: AuditEventList,
  args: { events: sampleHistory },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof AuditEventList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PatientHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('listitem').length).toBeGreaterThan(3);
    await expect(
      canvas.getByText('Notes changed (text not recorded)'),
    ).toBeInTheDocument();
  },
};

/** A registry Apply and an event with no signed-in user. */
export const TrialHistory: Story = {
  args: {
    events: [
      makeEvent({
        id: 2,
        action: 'registry.apply',
        entityType: 'trial',
        entityId: 7,
        label: 'Breathing exercises for moderate asthma',
        patientId: null,
        trialId: 7,
        changes: [
          { field: 'status', from: 'recruiting', to: 'completed' },
          {
            field: 'criteria',
            from: ['I: Adults with moderate asthma'],
            to: ['I: Adults with moderate asthma', 'E: Pregnancy'],
          },
        ],
      }),
      makeEvent({
        id: 1,
        action: 'trial.import',
        actor: null,
        entityType: 'trial',
        entityId: 7,
        label: 'Breathing exercises for moderate asthma',
        patientId: null,
        trialId: 7,
        changes: [],
      }),
    ],
  },
};

export const Empty: Story = { args: { events: [] } };
