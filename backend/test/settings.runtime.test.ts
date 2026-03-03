import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";
import { handleRequest } from "../src/app";
import { defaultPaqqSettings, type PaqqSettings } from "../src/settings-schema";

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

async function createMockScraperServer(
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    body: string,
    requests: CapturedRequest[]
  ) => void
): Promise<{ baseUrl: string; close: () => Promise<void>; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body,
    });
    handler(req, res, body, requests);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

class FakeSettingsService {
  constructor(private state: PaqqSettings) {}

  async getSettings(): Promise<PaqqSettings> {
    return JSON.parse(JSON.stringify(this.state)) as PaqqSettings;
  }

  async updateSettings(patch: any): Promise<PaqqSettings> {
    this.state = {
      ...this.state,
      ...patch,
      notifications: {
        ...this.state.notifications,
        ...(patch.notifications || {}),
      },
      carriers: {
        ...this.state.carriers,
        ...(patch.carriers || {}),
      },
    };
    return this.getSettings();
  }
}

const serversToClose: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (serversToClose.length > 0) {
    const close = serversToClose.pop();
    if (close) {
      await close();
    }
  }
});

describe("settings runtime wiring", () => {
  it("applies carrier credentials from settings when resolving /api/get", async () => {
    const server = await createMockScraperServer((req, res) => {
      if (req.url !== "/track/ups") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      expect(req.headers["x-ups-scraper-token"]).toBe("token-from-settings");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          trackingNumber: "1Z262AY97298603378",
          trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1Z262AY97298603378",
          carrier: "ups",
          status: {
            code: "3",
            description: "On the way",
            timestamp: "2026-03-02T12:42:00.000Z",
          },
          events: [
            {
              code: "3",
              description: "On the way",
              timestamp: "2026-03-02T12:42:00.000Z",
            },
          ],
        })
      );
    });
    serversToClose.push(server.close);

    const settings = new FakeSettingsService({
      ...defaultPaqqSettings(),
      carriers: {
        ups: {
          scraperToken: "token-from-settings",
        },
      },
    });

    const response = await handleRequest(
      new Request(
        "https://paqq.test/api/get?source=ups&trackingNumber=1Z262AY97298603378"
      ),
      {
        UPS_SCRAPER_URL: server.baseUrl,
        UPS_SCRAPER_TIMEOUT_MS: "60000",
      },
      { settings }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { carrier: string };
    expect(payload.carrier).toBe("ups");
  });

  it("supports GET/PUT settings endpoint in node runtime", async () => {
    const settings = new FakeSettingsService(defaultPaqqSettings());

    const getResponse = await handleRequest(
      new Request("https://paqq.test/api/settings"),
      {},
      { settings }
    );
    expect(getResponse.status).toBe(200);

    const putResponse = await handleRequest(
      new Request("https://paqq.test/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          notifications: {
            enabled: true,
            appriseUrls: ["discord://token@123/456"],
          },
        }),
      }),
      {},
      { settings }
    );
    expect(putResponse.status).toBe(200);
    const payload = (await putResponse.json()) as PaqqSettings;
    expect(payload.notifications.enabled).toBe(true);
    expect(payload.notifications.appriseUrls).toHaveLength(1);
  });
});
