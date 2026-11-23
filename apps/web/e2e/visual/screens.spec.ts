import { expect, test } from '@playwright/test';
import { SCREENS, openScreen } from '../support/screens';

for (const screen of SCREENS) {
  test(`captura · ${screen.path}`, async ({ page, baseURL }) => {
    await openScreen(page, baseURL, screen);

    await expect(page).toHaveScreenshot(`${screen.id}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.001,
    });
  });
}
