---
title: Paqq
description: "Self-hosted package tracking for homelabs with USPS, UniUni, and UPS support."
---

# Paqq

Self-hosted, multi-carrier package tracking built for homelabs and personal infrastructure.

[GitHub Repository](https://github.com/doprdele/paqq) | [Issues](https://github.com/doprdele/paqq/issues) | [Discussions](https://github.com/doprdele/paqq/discussions)

![Paqq Logo](https://raw.githubusercontent.com/doprdele/paqq/main/frontend/logo.svg)

## What Paqq Does

- Track packages across **USPS**, **UniUni**, **UPS**, and more carriers.
- Use **Playwright stealth/CDP scraping** where carrier APIs are restrictive.
- Add package tracking asynchronously so UI interactions stay fast.
- Persist watch targets and poll in the background until delivery.
- Send notifications on tracking changes with **Apprise** integration.
- Run fully self-hosted with `docker compose`.

## Why Use Paqq

Paqq is optimized for users who want package tracking control in a self-hosted stack:

- Homelab-ready deployment model
- Docker-first architecture
- API + scraper separation
- Credentials configurable from the app settings UI
- OIDC-friendly deployment options for private environments

## Quick Start

```bash
git clone https://github.com/doprdele/paqq.git
cd paqq
docker compose up -d --build
```

Endpoints:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8787`
- Scraper service: `http://localhost:8790`

## Core Features

### Carrier and Tracking Features

- USPS scraping service with Playwright-stealth
- UniUni scraping integration and normalization
- UPS reverse-engineered tracking integration
- Unified normalized tracking schema and event timeline

### Self-Hosted Features

- Persistent scheduler state
- Background polling and retries
- Notification hooks through Apprise URLs
- Settings APIs for carrier credentials and notification controls

## Tech Stack

- Frontend: static app (PWA-enabled)
- Backend: TypeScript API and scheduler
- Scrapers: Node.js + Playwright-extra + stealth plugin
- Deployment: Docker Compose (plus optional OrbStack/Traefik workflows)

## SEO Keywords

Self-hosted package tracker, parcel tracking, shipment tracking, USPS tracker, UPS tracker, UniUni tracker, homelab app, Docker tracking app, Playwright scraping tracker.

## License and Attribution

Paqq is a forked project with preserved upstream attribution and notices.

- License files: [LICENSE](https://github.com/doprdele/paqq/blob/main/LICENSE), [LICENSE-AGPL-3.0.txt](https://github.com/doprdele/paqq/blob/main/LICENSE-AGPL-3.0.txt)
- Notices: [NOTICE.md](https://github.com/doprdele/paqq/blob/main/NOTICE.md)
- Trademark policy: [TRADEMARKS.md](https://github.com/doprdele/paqq/blob/main/TRADEMARKS.md)
