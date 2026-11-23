import { expect, test, type Page } from '@playwright/test';
import { openScreen, SCREENS } from '../support/screens';

function open(page: Page, baseURL: string | undefined, id: string) {
  const screen = SCREENS.find((entry) => entry.id === id);
  if (!screen) throw new Error(`Missing screen fixture for ${id}`);
  return openScreen(page, baseURL, screen);
}

test('login has a visible keyboard focus and follows the form reading order', async ({ page, baseURL }) => {
  await open(page, baseURL, 'login');
  const main = page.getByRole('main');
  const cancel = main.getByRole('button', { name: 'Cancelar' });
  const email = main.getByRole('textbox', { name: 'Email' });
  const password = main.getByLabel('Contraseña', { exact: true });
  const submit = main.getByRole('button', { name: 'Entrar', exact: true });

  await page.keyboard.press('Tab');
  await expect(main.getByRole('link', { name: 'FTTH·Copilot', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  await expect(email.and(page.locator(':focus-visible'))).toHaveCount(1);
  await expect(email).not.toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(password).toBeFocused();
});

test('login links to signup via Enter and exposes named registration controls', async ({ page, baseURL }) => {
  await open(page, baseURL, 'login');

  const signup = page.getByRole('link', { name: 'Crear cuenta', exact: true });
  await signup.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL('/signup');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Crear tu espacio' })).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Tu nombre', exact: true })).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Nombre de tu ISP/empresa', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeEnabled();
});

test('alerts expose the current page and support Enter and Space on the disclosure', async ({ page, baseURL }) => {
  await open(page, baseURL, 'alerts');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Alertas', exact: true })).toHaveAttribute('aria-current', 'page');
  const panel = page.getByRole('button', { name: /^Alertas de red/, expanded: true });
  const collapsed = page.getByRole('button', { name: /^Alertas de red/, expanded: false });
  const alert = page.getByText('Potencia RX crítica en PON 0/1/3');

  await panel.focus();
  await page.keyboard.press('Enter');
  await expect(collapsed).toBeFocused();
  await expect(alert).toBeHidden();

  await page.keyboard.press('Space');
  await expect(panel).toBeFocused();
  await expect(alert).toBeVisible();
});
