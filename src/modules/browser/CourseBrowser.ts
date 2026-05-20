import { Browser, BrowserContext, chromium, Page } from "playwright";
import { getFrontendMastersCredentials } from "../../config/credentials.js";
import { delay } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export interface CourseBrowserConfig {
  headless: boolean;
}

const LOGIN_URL = "https://frontendmasters.com/login/";

export class CourseBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly config: CourseBrowserConfig) {}

  async start(): Promise<void> {
    if (this.config.headless) {
      logger.warn(
        "Headless mode may prevent login if the site shows a CAPTCHA.",
      );
    }

    this.browser = await chromium.launch({
      headless: this.config.headless,
    });
    this.context = await this.browser.newContext();

    const page = await this.context.newPage();
    await this.navigateToLogin(page);
    await this.login(page);
    await page.close();
  }

  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("Browser not started. Call start() first.");
    }

    return this.context.newPage();
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      // Ignore close errors
    }

    this.context = null;
    this.browser = null;
  }

  private async navigateToLogin(page: Page): Promise<void> {
    while (true) {
      const response = await page.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
      });

      if (response?.status() === 429) {
        logger.warn(
          "Rate limited (429) on login page, waiting 10 seconds before retry...",
        );
        await delay(10_000);
        continue;
      }

      return;
    }
  }

  private async login(page: Page): Promise<void> {
    const { username, password } = getFrontendMastersCredentials();

    logger.info("Logging in with credentials from .env");

    const emailField = page.locator(
      'input[type="email"], input[name="email"], input[name="username"]',
    );
    const passwordField = page.locator('input[type="password"]');
    const submitButton = page.locator(
      'button[type="submit"], input[type="submit"]',
    );

    await emailField.waitFor({ state: "visible", timeout: 30_000 });
    await emailField.fill(username);
    await passwordField.fill(password);
    await submitButton.click();

    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 60_000,
    });
    logger.info("Login complete");
  }
}
