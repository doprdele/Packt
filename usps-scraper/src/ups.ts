import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import { normalizeUpsTracking } from "./normalize-ups.js";
import {
  persistCarrierSessionState,
  withCarrierSessionState,
} from "./session-state.js";
import type { ScrapeOptions, ShipmentInfo } from "./types.js";

const chromiumWithFlags = chromium as typeof chromium & {
  __paqqStealthApplied?: boolean;
};

if (!chromiumWithFlags.__paqqStealthApplied) {
  chromium.use(StealthPlugin());
  chromiumWithFlags.__paqqStealthApplied = true;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TRACKING_URL_BASE = "https://www.ups.com/track?loc=en_US&tracknum=";
const TRACKING_STATUS_API_URL = "https://www.ups.com/track/api/Track/GetStatus?loc=en_US";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface BrowserSession {
  context: BrowserContext;
  close: () => Promise<void>;
}

function compact(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function ensureTrackingNumber(trackingNumber: string): string {
  const normalized = trackingNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,35}$/.test(normalized)) {
    throw new Error("Invalid UPS tracking number format");
  }
  return normalized;
}

function getExecutablePath(): string | undefined {
  if (process.env.UPS_BROWSER_EXECUTABLE_PATH) {
    return process.env.UPS_BROWSER_EXECUTABLE_PATH;
  }
  if (process.env.USPS_BROWSER_EXECUTABLE_PATH) {
    return process.env.USPS_BROWSER_EXECUTABLE_PATH;
  }

  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  return undefined;
}

async function createBrowserSession(timeoutMs: number): Promise<BrowserSession> {
  const cdpEndpoint =
    compact(process.env.UPS_CDP_WS_ENDPOINT) ??
    compact(process.env.USPS_CDP_WS_ENDPOINT);

  const contextOptions = await withCarrierSessionState("ups", {
    locale: "en-US",
    timezoneId:
      process.env.UPS_TIMEZONE ??
      process.env.USPS_TIMEZONE ??
      "America/New_York",
    userAgent:
      process.env.UPS_USER_AGENT ??
      process.env.USPS_USER_AGENT ??
      DEFAULT_USER_AGENT,
    viewport: { width: 1366, height: 900 },
  } satisfies BrowserContextOptions);

  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint, {
      timeout: timeoutMs,
    });

    if (browser.contexts().length > 0) {
      const context = browser.contexts()[0];
      return {
        context,
        close: async () => {
          await persistCarrierSessionState("ups", context).catch(() => undefined);
          await browser.close();
        },
      };
    }

    const context = await browser.newContext(contextOptions);
    return {
      context,
      close: async () => {
        await persistCarrierSessionState("ups", context).catch(() => undefined);
        await context.close();
        await browser.close();
      },
    };
  }

  const browser: Browser = await chromium.launch({
    headless: process.env.UPS_HEADFUL === "1" ? false : true,
    executablePath: getExecutablePath(),
    args: [
      "--disable-blink-features=AutomationControlled",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--use-angle=default",
      "--use-gl=angle",
      "--enable-zero-copy",
      "--enable-accelerated-2d-canvas",
    ],
  });

  const context = await browser.newContext(contextOptions);
  return {
    context,
    close: async () => {
      await persistCarrierSessionState("ups", context).catch(() => undefined);
      await context.close();
      await browser.close();
    },
  };
}

async function fetchStatusPayloadViaPageApi(
  page: Page,
  trackingNumber: string
): Promise<unknown> {
  return await page.evaluate(async ({ endpoint, trackingNumber }) => {
    const xsrfCookie = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("XSRF-TOKEN="));
    const xsrfToken = xsrfCookie
      ? decodeURIComponent(xsrfCookie.slice("XSRF-TOKEN=".length))
      : undefined;

    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        ...(xsrfToken ? { "x-xsrf-token": xsrfToken } : {}),
      },
      body: JSON.stringify({
        Locale: "en_US",
        TrackingNumber: [trackingNumber],
      }),
    });

    if (!response.ok) {
      throw new Error(`UPS status API failed (${response.status})`);
    }
    return (await response.json()) as unknown;
  }, { endpoint: TRACKING_STATUS_API_URL, trackingNumber });
}

async function fetchUpsPayload(
  page: Page,
  trackingNumber: string,
  timeoutMs: number
): Promise<unknown> {
  const trackingUrl = `${TRACKING_URL_BASE}${encodeURIComponent(trackingNumber)}`;
  const selectorTimeout = Math.min(35_000, timeoutMs);
  const apiResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/track/api/Track/GetStatus") &&
      response.request().method() === "POST",
    { timeout: selectorTimeout }
  );

  await page.goto(trackingUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  await page.waitForTimeout(2000);

  try {
    const response = await apiResponsePromise;
    if (!response.ok()) {
      throw new Error(`UPS status API failed (${response.status()})`);
    }
    return await response.json();
  } catch {
    return await fetchStatusPayloadViaPageApi(page, trackingNumber);
  }
}

export async function scrapeUpsTracking(
  trackingNumber: string,
  options: ScrapeOptions = {}
): Promise<ShipmentInfo> {
  const normalizedTrackingNumber = ensureTrackingNumber(trackingNumber);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Number(process.env.UPS_SCRAPE_MAX_ATTEMPTS ?? "5"));

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await createBrowserSession(timeoutMs);

    try {
      const page = await session.context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });

      const payload = await fetchUpsPayload(page, normalizedTrackingNumber, timeoutMs);
      const trackingUrl = `${TRACKING_URL_BASE}${encodeURIComponent(
        normalizedTrackingNumber
      )}`;
      return normalizeUpsTracking(normalizedTrackingNumber, trackingUrl, payload);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("UPS scraping failed");
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    } finally {
      await session.close();
    }
  }

  throw lastError ?? new Error("UPS scraping failed");
}
