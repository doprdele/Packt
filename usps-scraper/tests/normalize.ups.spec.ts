import { describe, expect, it } from "vitest";
import { normalizeUpsTracking } from "../src/normalize-ups.js";

describe("normalizeUpsTracking", () => {
  it("maps UPS status payload into Paqq shipment shape", () => {
    const payload = {
      trackDetails: [
        {
          trackingNumber: "1Z262AY97298603378",
          packageStatus: [
            {
              type: "D",
              description: "Delivered",
              date: "20260301",
              time: "153000",
              location: {
                address: {
                  city: "Belmont",
                  stateProvince: "MA",
                  country: "US",
                },
              },
            },
          ],
          shipmentProgressActivities: [
            {
              statusCode: "I",
              description: "On the way",
              date: "20260229",
              time: "101500",
              location: {
                address: {
                  city: "Secaucus",
                  stateProvince: "NJ",
                  country: "US",
                },
              },
            },
            {
              statusCode: "D",
              description: "Delivered",
              date: "20260301",
              time: "153000",
              location: {
                address: {
                  city: "Belmont",
                  stateProvince: "MA",
                  country: "US",
                },
              },
            },
          ],
        },
      ],
    };

    const result = normalizeUpsTracking(
      "1Z262AY97298603378",
      "https://www.ups.com/track?loc=en_US&tracknum=1Z262AY97298603378",
      payload
    );

    expect(result.carrier).toBe("ups");
    expect(result.trackingNumber).toBe("1Z262AY97298603378");
    expect(result.status.code).toBe("D");
    expect(result.status.description).toContain("Delivered");
    expect(result.events.length).toBeGreaterThan(1);
    expect(result.events[0].timestamp).toMatch(/2026-03-01T/);
  });

  it("throws when payload has no usable events", () => {
    expect(() =>
      normalizeUpsTracking(
        "1Z262AY97298603378",
        "https://www.ups.com/track?loc=en_US&tracknum=1Z262AY97298603378",
        {}
      )
    ).toThrow("UPS response did not contain any usable events");
  });
});
