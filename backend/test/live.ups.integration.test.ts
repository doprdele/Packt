import { describe, expect, it } from "vitest";
import { handleGet } from "../src/handlers/get";
import { sourcesRegistry } from "../src/sources";

const liveEnabled = process.env.RUN_LIVE_UPS_BACKEND_TESTS === "1";
const liveTrackingNumber =
  process.env.UPS_LIVE_TRACKING_NUMBER ?? "1Z262AY97298603378";
const liveScraperUrl = process.env.UPS_SCRAPER_URL ?? "http://127.0.0.1:8790";

(liveEnabled ? describe : describe.skip)("live UPS backend integration", () => {
  it(
    "retrieves real UPS tracking through Paqq backend source",
    async () => {
      const env = {
        UPS_SCRAPER_URL: liveScraperUrl,
        UPS_SCRAPER_TIMEOUT_MS: "60000",
        UPS_SCRAPER_TOKEN: process.env.UPS_SCRAPER_TOKEN ?? "",
      };
      sourcesRegistry.initialize(env);

      const response = await handleGet(
        new Request(
          `https://paqq.test/api/get?source=ups&trackingNumber=${encodeURIComponent(
            liveTrackingNumber
          )}`
        ),
        env
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        carrier: string;
        trackingNumber: string;
        status: { description: string };
        events: Array<{ description: string }>;
      };

      expect(payload.carrier).toBe("ups");
      expect(payload.trackingNumber.length).toBeGreaterThan(8);
      expect(payload.status.description.length).toBeGreaterThan(2);
      expect(payload.events.length).toBeGreaterThan(0);
    },
    300_000
  );
});
