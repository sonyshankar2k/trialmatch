import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TrialMatch } from '@trialmatch/shared';
import { expect, userEvent, within } from 'storybook/test';
import { MatchCard } from './MatchPanel';

const base: TrialMatch = {
  trialId: 7,
  nctId: 'NCT99000001',
  title:
    'Once-weekly GLP-1 agonist vs placebo in adults with type 2 diabetes and obesity',
  condition: 'Type 2 diabetes',
  eligibility: 'possibly_eligible',
  score: 67,
  summary: 'No criterion rules the patient out. Check E2 by hand.',
  assessments: [
    {
      criterionId: 1,
      code: 'I1',
      type: 'inclusion',
      text: 'Type 2 diabetes for at least 6 months',
      verdict: 'met',
      reason: 'Diagnosed in 2019.',
      evidence: 'T2D diagnosed 2019',
    },
    {
      criterionId: 2,
      code: 'I2',
      type: 'inclusion',
      text: 'HbA1c between 7.0% and 10.5%',
      verdict: 'met',
      reason: 'Last HbA1c was 8.2%.',
      evidence: 'HbA1c 8.2%',
    },
    {
      criterionId: 3,
      code: 'E1',
      type: 'exclusion',
      text: 'History of pancreatitis',
      verdict: 'not_met',
      reason: 'The notes deny it.',
      evidence: 'No history of pancreatitis',
    },
    {
      criterionId: 4,
      code: 'E2',
      type: 'exclusion',
      text: 'eGFR below 30 mL/min/1.73m²',
      verdict: 'unknown',
      reason: 'No kidney function result in the profile.',
      evidence: null,
    },
  ],
};

const meta = {
  title: 'Matching/MatchCard',
  component: MatchCard,
  args: { result: base },
  decorators: [(Story) => <ul className="max-w-3xl">{Story()}</ul>],
} satisfies Meta<typeof MatchCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Green when a verdict favours eligibility, red when it rules the patient out, amber when unknown. */
export const NeedsReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Needs review')).toBeInTheDocument();
    const results = canvas
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1].textContent);
    await expect(results).toEqual(['Met', 'Met', 'Does not apply', 'Unknown']);
  },
};

export const LikelyEligible: Story = {
  args: {
    result: {
      ...base,
      eligibility: 'eligible',
      score: 100,
      summary:
        'Every criterion points towards eligibility. Confirm with the study team.',
      assessments: base.assessments.map((a) =>
        a.code === 'E2'
          ? {
              ...a,
              verdict: 'not_met',
              reason: 'eGFR is 78.',
              evidence: 'eGFR 78',
            }
          : a,
      ),
    },
  },
};

/** Ruled-out trials start collapsed; the criteria are one click away. */
export const NotEligible: Story = {
  args: {
    result: {
      ...base,
      eligibility: 'not_eligible',
      score: 25,
      summary: 'Ruled out by E1.',
      assessments: base.assessments.map((a) =>
        a.code === 'E1'
          ? {
              ...a,
              verdict: 'met',
              reason: 'Pancreatitis in 2021.',
              evidence: 'pancreatitis (2021)',
            }
          : a,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: 'Show 4 criteria' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await expect(canvas.getByRole('table')).toBeInTheDocument();
  },
};
