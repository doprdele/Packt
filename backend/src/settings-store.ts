import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applySettingsPatch,
  defaultPaqqSettings,
  parsePersistedSettings,
  type PaqqSettings,
  type RuntimeEnv,
} from "./settings-schema";

function readEnvWithLegacyPrefix(
  env: RuntimeEnv,
  key: string
): string | undefined {
  if (typeof env[key] === "string") {
    return env[key];
  }

  const legacyKey = key.replace(/^PAQQ_/, "PACKT_");
  if (legacyKey !== key && typeof env[legacyKey] === "string") {
    return env[legacyKey];
  }

  return undefined;
}

export class RuntimeSettingsStore {
  private readonly settingsFile: string;
  private state: PaqqSettings = defaultPaqqSettings();
  private loadPromise: Promise<void> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly env: RuntimeEnv) {
    this.settingsFile =
      readEnvWithLegacyPrefix(env, "PAQQ_SETTINGS_FILE") ??
      "/app/data/paqq-settings.json";
  }

  getSettingsFile(): string {
    return this.settingsFile;
  }

  async getSettings(): Promise<PaqqSettings> {
    await this.ensureLoaded();
    return this.cloneSettings();
  }

  async updateSettings(patch: unknown): Promise<PaqqSettings> {
    await this.ensureLoaded();
    this.state = applySettingsPatch(this.state, patch);
    await this.queueSave();
    return this.cloneSettings();
  }

  private cloneSettings(): PaqqSettings {
    return {
      version: 1,
      notifications: {
        enabled: this.state.notifications.enabled,
        appriseUrls: [...this.state.notifications.appriseUrls],
        notifyOnStatusChange: this.state.notifications.notifyOnStatusChange,
        notifyOnDelivered: this.state.notifications.notifyOnDelivered,
      },
      carriers: Object.fromEntries(
        Object.entries(this.state.carriers).map(([carrier, values]) => [
          carrier,
          { ...values },
        ])
      ),
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadSettings();
    }
    await this.loadPromise;
  }

  private async loadSettings(): Promise<void> {
    try {
      const content = await readFile(this.settingsFile, "utf8");
      const parsed = JSON.parse(content);
      this.state = parsePersistedSettings(parsed);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== "ENOENT") {
        throw error;
      }
      await this.queueSave();
    }
  }

  private queueSave(): Promise<void> {
    const next = this.saveQueue
      .catch(() => undefined)
      .then(async () => this.saveSettings());
    this.saveQueue = next;
    return next;
  }

  private async saveSettings(): Promise<void> {
    await mkdir(dirname(this.settingsFile), { recursive: true });
    await writeFile(this.settingsFile, JSON.stringify(this.state, null, 2), "utf8");
  }
}
