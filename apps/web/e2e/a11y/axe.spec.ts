import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SCREENS, openScreen } from '../support/screens';

for (const screen of SCREENS) {
  test(`WCAG A/AA · ${screen.path}`, async ({ page, baseURL }, testInfo) => {
    await openScreen(page, baseURL, screen);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    await testInfo.attach('axe-results', {
      body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2),
      contentType: 'application/json',
    });

    const violations = result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    }));
    expect(violations).toEqual([]);
  });
}
