import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { RegistryPreview } from '@trialmatch/shared';
import { StudyPreview } from './StudyPreview';

const base: RegistryPreview = {
  nctId: 'NCT90000001',
  trial: {
    nctId: 'NCT90000001',
    title:
      'Exercise-induced asthma in adolescents: airway inflammation markers',
    condition: 'Exercise Induced Asthma, Asthma in Children',
    phase: 'Not applicable',
    status: 'recruiting',
    sponsor: 'University Hospital Example',
    summary: null,
    minAge: 12,
    maxAge: 24,
    sex: 'all',
    criteria: [
      { type: 'inclusion', text: 'For EIA patients: written agreement' },
      { type: 'inclusion', text: 'For EIA patients: age >=12 and <= 24' },
      {
        type: 'inclusion',
        text: 'For EIA patients: known exercise induced asthma',
      },
      {
        type: 'exclusion',
        text: 'For EIA patients: chronic asthma with systemic cortisone therapy',
      },
      { type: 'exclusion', text: 'For EIA patients: pregnancy' },
    ],
  },
  lastUpdated: '2026-10-14',
  sourceCriteriaText:
    'For EIA patients\n\nInclusion Criteria:\n\n* written agreement\n* age \\>=12 and \\<= 24\n* known exercise induced asthma\n\nExclusion Criteria:\n\n* chronic asthma with systemic cortisone therapy\n* pregnancy',
  warnings: [],
  importedTrialId: null,
};
const makePreview = (o: Partial<RegistryPreview> = {}) => ({ ...base, ...o });

const meta = {
  title: 'Registry/StudyPreview',
  component: StudyPreview,
  args: { preview: makePreview(), onImport: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StudyPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToImport: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Import trial' }));
    await expect(args.onImport).toHaveBeenCalledOnce();
  },
};

export const WithWarnings: Story = {
  args: {
    preview: makePreview({
      warnings: [
        'Minimum age is 6 Months on ClinicalTrials.gov; TrialMatch stores whole years, so it was imported as 0.',
        'The eligibility text has no "Inclusion/Exclusion Criteria" headings, so every item was imported as an inclusion criterion. Check for exclusions before matching.',
      ],
    }),
  },
};

export const AlreadyImported: Story = {
  args: { preview: makePreview({ importedTrialId: 12 }) },
};

export const Importing: Story = {
  args: { importing: true },
};

export const ImportFailed: Story = {
  args: { error: "ClinicalTrials.gov didn't respond. Try again in a minute." },
};
