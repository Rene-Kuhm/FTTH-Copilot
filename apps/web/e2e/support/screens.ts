import { expect, type Page } from '@playwright/test';
import { installDeterministicEnvironment, mockAppApis } from './fixtures';

interface Screen {
  id: string;
  path: string;
  heading?: string;
  signedIn?: boolean;
  ready?: (page: Page) => Promise<void>;
}

export const SCREENS: readonly Screen[] = [
  { id: 'landing', path: '/' },
  {
    id: 'login',
    path: '/login',
    heading: 'Iniciar sesión',
    ready: async (page) => {
      await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    },
  },
  {
    id: 'signup',
    path: '/signup',
    heading: 'Crear tu espacio',
    ready: async (page) => {
      await expect(page.getByRole('textbox', { name: 'Nombre de tu ISP/empresa' })).toBeVisible();
    },
  },
  { id: 'docs', path: '/docs', heading: 'Documentación para ISPs' },
  {
    id: 'copilot',
    path: '/app',
    heading: 'Copilot de red',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByRole('textbox', { name: 'Pregunta para el Copilot' })).toBeEnabled();
      await expect(page.getByText('operador.demo@example.com')).toBeVisible();
      await expect(page.getByText('Estado PON 0/1/3 Norte')).toBeVisible();
      await expect(page.getByText('Potencia RX crítica en PON 0/1/3')).toBeVisible();
    },
  },
  {
    id: 'dashboard',
    path: '/dashboard',
    heading: 'Tablero de red',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByText('OLT Cabecera Norte', { exact: true })).toBeVisible();
      await expect(page.getByText('Atenuación óptica en puerto PON 0/1/3')).toBeVisible();
      await expect(page.getByText('Degradación gradual de RX en ONU-018')).toBeVisible();
      await expect(page.getByText('99.94%')).toBeVisible();
      await expect(page.getByText('203.0.113.25')).toBeVisible();
      await expect(page.getByTestId('topology-impact-accordion')).toHaveCount(2);
      await expect(page.getByTestId('feedback-button-confirmed-inc-demo-0001')).toBeEnabled();
      await expect(page.getByTestId('feedback-button-confirmed-inc-demo-0002')).toBeEnabled();
    },
  },
  {
    id: 'metrics',
    path: '/dashboard/metrics',
    heading: 'Métricas',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByText('Scraping activo', { exact: true })).toBeVisible();
      await expect(page.getByText('SLA OK', { exact: true })).toBeVisible();
      await expect(page.getByText('reconectando', { exact: true })).toBeVisible();
    },
  },
  {
    id: 'laya',
    path: '/dashboard/laya',
    heading: 'Panel de métricas — Laya',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByText('OPTICAL_FAULT', { exact: true }).first()).toBeVisible();
    },
  },
  {
    id: 'alerts',
    path: '/alerts',
    heading: 'Alertas de red',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByText('Potencia RX crítica en PON 0/1/3')).toBeVisible();
    },
  },
  {
    id: 'plans',
    path: '/plans',
    heading: 'Planos y relevamientos',
    signedIn: true,
    ready: async (page) => {
      await expect(page.getByText('Sin planos cargados')).toBeVisible();
    },
  },
];

export async function openScreen(page: Page, baseURL: string | undefined, screen: Screen) {
  if (!baseURL) throw new Error('The a11y/visual suite requires a baseURL');

  await installDeterministicEnvironment(page);
  await mockAppApis(page, baseURL, screen.signedIn === true);

  // /docs is a public UI page routed through auth middleware, but uses no signed-in fixtures.
  if (screen.signedIn || screen.id === 'docs') {
    await page.context().addCookies([{ name: '__test_bypass', value: 'true', url: baseURL }]);
  }

  await page.goto(screen.path);
  await expect(page).toHaveURL(new URL(screen.path, baseURL).href);
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(main.getByRole('heading', { level: 1, name: screen.heading, exact: true })).toBeVisible();
  if (screen.signedIn) {
    await expect(page.getByText('NOC Demo Operator', { exact: true })).toBeVisible();
  }
  await screen.ready?.(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
