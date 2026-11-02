import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TagInput } from './TagInput';

function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TagInput id="t" value={value} onChange={setValue} />
      <output>{JSON.stringify(value)}</output>
    </>
  );
}

describe('TagInput', () => {
  it('adds on Enter or comma, skips duplicates, removes with × or Backspace', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'Asthma{Enter}');
    await user.type(input, 'Obesity,');
    await user.type(input, 'asthma{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(
      '["Asthma","Obesity"]',
    );

    await user.click(screen.getByRole('button', { name: 'Remove Asthma' }));
    expect(screen.getByRole('status')).toHaveTextContent('["Obesity"]');

    await user.type(input, '{Backspace}');
    expect(screen.getByRole('status')).toHaveTextContent('[]');
  });
});
