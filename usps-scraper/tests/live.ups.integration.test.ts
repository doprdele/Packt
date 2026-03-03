import { describe, expect, it } from "vitest";
import { scrapeUpsTracking } from "../src/ups.js";

const liveEnabled = process.env.RUN_LIVE_UPS_TESTS === "1";
const liveTrackingNumber =
  process.env.UPS_LIVE_TRACKING_NUMBER ?? "1Z262AY97298603378";

(liveEnabled ? describe : describe.skip)("live UPS integration", () => {
  it(
    "retrieves real UPS tracking data",
    async () => {
      let result: Awaited<ReturnType<typeof scrapeUpsTracking>> | undefined;
      let lastError: unknown;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await scrapeUpsTracking(liveTrackingNumber, {
            timeoutMs: 45_000,
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!result) {
        throw lastError;
      }

      expect(result.carrier).toBe("ups");
      expect(result.trackingNumber.length).toBeGreaterThan(8);
      expect(result.trackingUrl).toContain("ups.com/track");
      expect(result.status.description.length).toBeGreaterThan(2);
      expect(result.events.length).toBeGreaterThan(0);
    },
    300_000
  );
});
