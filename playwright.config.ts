import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/';

export default defineConfig({
  testDir: './e2e',
  // Die Suiten teilen sich eine IndexedDB pro Browser-Kontext und setzen sie
  // gezielt zurueck - parallel wuerden sie sich gegenseitig die Daten wegziehen.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Die App ist explizit fuer einhaendige Handynutzung gebaut; alles
      // Interessante (Safe-Area, Nav-Umbruch, Tastatur) zeigt sich erst hier.
      name: 'iPhone 13',
      use: { ...devices['iPhone 13'] },
    },
    {
      // Engster Fall: hier brach die sechsspaltige Navigation frueher um.
      name: 'iPhone SE',
      use: { ...devices['iPhone SE'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
