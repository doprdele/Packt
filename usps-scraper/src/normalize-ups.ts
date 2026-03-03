import { ShipmentInfo, ShipmentStatus } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function compact(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function toIsoDate(dateLike: unknown, timeLike?: unknown): string | undefined {
  const asDate = compact(dateLike);
  const asTime = compact(timeLike);
  if (!asDate && !asTime) return undefined;

  if (asDate) {
    const parsed = Date.parse(asDate);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (asDate && /^\d{8}$/.test(asDate)) {
    const year = Number(asDate.slice(0, 4));
    const month = Number(asDate.slice(4, 6));
    const day = Number(asDate.slice(6, 8));
    const timeDigits = (asTime ?? "000000").replace(/[^0-9]/g, "");
    const hour = Number(timeDigits.slice(0, 2) || "0");
    const minute = Number(timeDigits.slice(2, 4) || "0");
    const second = Number(timeDigits.slice(4, 6) || "0");
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
  }

  if (asDate && asTime) {
    const merged = `${asDate} ${asTime}`;
    const parsed = Date.parse(merged);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return asDate ?? asTime;
}

function statusCodeFromDescription(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("deliver")) return "5";
  if (lower.includes("out for delivery")) return "4";
  if (
    lower.includes("in transit") ||
    lower.includes("departed") ||
    lower.includes("arrived") ||
    lower.includes("processed")
  ) {
    return "3";
  }
  if (
    lower.includes("label") ||
    lower.includes("manifest") ||
    lower.includes("pre-shipment")
  ) {
    return "2";
  }
  return "1";
}

function extractDescription(event: UnknownRecord): string | undefined {
  return (
    compact(event.activityScan) ??
    compact(event.description) ??
    compact(event.status) ??
    compact(event.milestone) ??
    compact(event.eventDescription) ??
    compact(event.message)
  );
}

function extractCode(event: UnknownRecord, description: string): string {
  return (
    compact(event.statusCode) ??
    compact(event.code) ??
    compact(event.type) ??
    compact(event.statusType) ??
    statusCodeFromDescription(description)
  );
}

function extractTimestamp(event: UnknownRecord): string | undefined {
  return (
    toIsoDate(event.timestamp) ??
    toIsoDate(event.dateTime) ??
    toIsoDate(event.activityDate, event.activityTime) ??
    toIsoDate(event.date, event.time) ??
    toIsoDate(event.gmtDate, event.gmtTime)
  );
}

function joinLocationParts(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((entry): entry is string => Boolean(entry));
  return filtered.length > 0 ? filtered.join(", ") : undefined;
}

function extractLocation(event: UnknownRecord): string | undefined {
  if (typeof event.location === "string") {
    return compact(event.location);
  }

  const location = asRecord(event.location);
  const address = asRecord(location?.address);
  return joinLocationParts([
    compact(address?.city) ?? compact(location?.city),
    compact(address?.stateProvince) ?? compact(location?.stateProvince),
    compact(address?.country) ?? compact(location?.country),
  ]);
}

function isLikelyEvent(entry: UnknownRecord): boolean {
  return Boolean(extractDescription(entry) && extractTimestamp(entry));
}

function collectEvents(node: unknown, sink: UnknownRecord[]): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      if (asRecord(entry)) {
        collectEvents(entry, sink);
      }
    }
    return;
  }

  const record = asRecord(node);
  if (!record) {
    return;
  }

  if (isLikelyEvent(record)) {
    sink.push(record);
  }

  for (const [key, value] of Object.entries(record)) {
    if (!value) {
      continue;
    }

    if (Array.isArray(value) && /(event|activ|progress|history|scan)/i.test(key)) {
      for (const entry of value) {
        const candidate = asRecord(entry);
        if (candidate) {
          sink.push(candidate);
        }
      }
    }

    if (typeof value === "object") {
      collectEvents(value, sink);
    }
  }
}

function dedupeEvents(events: ShipmentStatus[]): ShipmentStatus[] {
  const seen = new Set<string>();
  const deduped: ShipmentStatus[] = [];
  for (const event of events) {
    const key = `${event.code}|${event.description}|${event.timestamp}|${event.location ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function normalizeEvent(event: UnknownRecord): ShipmentStatus | null {
  const description = extractDescription(event);
  const timestamp = extractTimestamp(event);

  if (!description || !timestamp) {
    return null;
  }

  return {
    code: extractCode(event, description),
    description,
    timestamp,
    location: extractLocation(event),
  };
}

function sortEvents(events: ShipmentStatus[]): ShipmentStatus[] {
  return [...events].sort((left, right) => {
    const l = Date.parse(left.timestamp);
    const r = Date.parse(right.timestamp);
    if (!Number.isNaN(l) && !Number.isNaN(r)) {
      return r - l;
    }
    return right.timestamp.localeCompare(left.timestamp);
  });
}

function resolveTopStatus(
  payload: UnknownRecord,
  fallbackEvent: ShipmentStatus
): ShipmentStatus {
  const trackDetails = Array.isArray(payload.trackDetails)
    ? asRecord(payload.trackDetails[0])
    : undefined;

  const packageStatus = trackDetails
    ? Array.isArray(trackDetails.packageStatus)
      ? asRecord(trackDetails.packageStatus[0])
      : asRecord(trackDetails.packageStatus)
    : undefined;
  const currentStatus = trackDetails ? asRecord(trackDetails.currentStatus) : undefined;
  const statusRecord = packageStatus ?? currentStatus ?? asRecord(payload.status);

  const description =
    (statusRecord ? extractDescription(statusRecord) : undefined) ??
    fallbackEvent.description;
  const code =
    (statusRecord ? extractCode(statusRecord, description) : undefined) ??
    statusCodeFromDescription(description);
  const timestamp =
    (statusRecord ? extractTimestamp(statusRecord) : undefined) ??
    fallbackEvent.timestamp;
  const location =
    (statusRecord ? extractLocation(statusRecord) : undefined) ??
    fallbackEvent.location;

  return {
    code,
    description,
    timestamp,
    location,
  };
}

function resolveTrackingNumber(payload: UnknownRecord, fallback: string): string {
  const trackDetails = Array.isArray(payload.trackDetails)
    ? asRecord(payload.trackDetails[0])
    : undefined;
  const packageDetails = trackDetails ? asRecord(trackDetails.packageDetails) : undefined;
  return (
    compact(packageDetails?.trackingNumber) ??
    compact(trackDetails?.trackingNumber) ??
    compact(payload.trackingNumber) ??
    fallback
  );
}

function resolveEstimatedDelivery(payload: UnknownRecord): string | undefined {
  const trackDetails = Array.isArray(payload.trackDetails)
    ? asRecord(payload.trackDetails[0])
    : undefined;
  const packageDetails = trackDetails ? asRecord(trackDetails.packageDetails) : undefined;
  return (
    toIsoDate(packageDetails?.deliveryDate) ??
    toIsoDate(trackDetails?.deliveryDate) ??
    toIsoDate(payload.estimatedDelivery)
  );
}

export function normalizeUpsTracking(
  trackingNumber: string,
  trackingUrl: string,
  payload: unknown
): ShipmentInfo {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("UPS response was not an object");
  }

  const rawEvents: UnknownRecord[] = [];
  collectEvents(record, rawEvents);

  const events = dedupeEvents(
    sortEvents(
      rawEvents
        .map((event) => normalizeEvent(event))
        .filter((event): event is ShipmentStatus => event !== null)
    )
  );

  if (events.length === 0) {
    throw new Error("UPS response did not contain any usable events");
  }

  const latestEvent = events[0];
  const status = resolveTopStatus(record, latestEvent);

  return {
    trackingNumber: resolveTrackingNumber(record, trackingNumber),
    trackingUrl,
    carrier: "ups",
    status,
    estimatedDelivery: resolveEstimatedDelivery(record),
    events,
  };
}
