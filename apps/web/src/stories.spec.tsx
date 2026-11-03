/**
 * Every Storybook story is also a test: rendered in jsdom, its play function
 * (the interaction) is run, and the result is checked with axe for
 * accessibility problems. Adding a story adds a test.
 */
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentType } from 'react';
import preview from '../.storybook/preview';

setProjectAnnotations(preview);

type ComposedStory = ComponentType & {
  storyName?: string;
  play?: (ctx: { canvasElement: HTMLElement }) => Promise<void>;
};

const modules = import.meta.glob<Record<string, unknown>>(
  './**/*.stories.tsx',
  { eager: true },
);

for (const [file, module] of Object.entries(modules)) {
  describe(file.replace('./', ''), () => {
    const stories = composeStories(module as never) as Record<
      string,
      ComposedStory
    >;
    for (const [name, Story] of Object.entries(stories)) {
      it(`${name}: renders, plays and has no accessibility violations`, async () => {
        const { container } = render(<Story />);
        await Story.play?.({ canvasElement: container });
        const results = await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or colours
        });
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  });
}
