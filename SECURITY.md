# Security Policy

## Supported Versions

Security updates are applied to the latest state of the `main` branch.

| Version / Branch | Supported |
| --- | --- |
| `main` (`1.0.x`) | Yes |

## Security Design Overview

CivicLead Engine is designed as a **local-first, single-operator** application. Key implemented protections include:

- **Loopback Network Binding**: Defaults to `HOST=127.0.0.1` so the unauthenticated API is not exposed on LAN/WAN interfaces unless explicitly configured.
- **SSRF & DNS Rebinding Defenses (`server/security.ts`)**: Public domain validation (`isValidPublicDomain`), private/reserved/metadata IP rejection across IPv4 and IPv6 (`isPrivateOrReservedIp`), pre-request DNS resolution (`assertSafePublicUrl`), redirect-hop re-validation (`safeFetchHtml`), and bounded 2 MB response streaming.
- **Secret Masking**: API keys are masked in `GET`/`PUT /api/settings` responses (`••••••••xxxx`) and replaced with placeholder masks in browser `localStorage`. Local database (`./data/civiclead.db`) and `user-settings.json` files use restrictive POSIX file modes (`0700`/`0600`) when supported by the filesystem.
- **CSRF, Headers & Rate Limiting**: Mutating `/api/*` endpoints enforce `Origin`/`Referer` host checks (`csrfOriginGuardMiddleware`), HTTP security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `COOP`/`CORP`, and production CSP), `1mb` JSON payload caps, and per-IP rate limiting on expensive endpoints.
- **Spreadsheet & Input Hardening**: CSV exports escape formula-leading prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) per CWE-1236, `PATCH /api/leads/:id` whitelists mutable fields, and external links are restricted to `http://` and `https://`.

> **Note:** CivicLead Engine is intended to run locally on a trusted workstation. If you choose to host it on a shared server or expose `HOST=0.0.0.0`, place it behind an authenticated reverse proxy with TLS and configure `APP_URL` accordingly.

## Reporting a Vulnerability

If you discover a security vulnerability in CivicLead Engine, **please do not open a public GitHub issue**.

Instead, report it privately so it can be investigated and patched before public disclosure:

1. Use GitHub's **Private Vulnerability Reporting** ("Security" tab -> "Advisories" -> "Report a vulnerability") on `danielharderpi-png/civiclead`, **or**
2. Contact the maintainer directly via email: **danielharder.pi@gmail.com** with `[SECURITY] CivicLead` in the subject line.

Please include:
- A description of the vulnerability and potential impact.
- Exact steps or a minimal proof-of-concept to reproduce the issue.
- The affected file(s), endpoint(s), or configuration.

You can expect an acknowledgment within 72 hours and updates as a fix is developed and verified.
