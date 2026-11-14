# Contributing to CivicLead Engine

Thank you for contributing to CivicLead Engine!

## Local Development Setup

### Prerequisites
- Node.js `>= 22.5.0`
- npm

### Getting Started

```bash
git clone https://github.com/danielharderpi-png/civiclead.git
cd civiclead
npm install
npm run dev
```

The development server listens on `http://127.0.0.1:3000` by default.

## Development Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Express API + Vite dev middleware via `tsx server.ts` |
| `npm run lint` | Run TypeScript typechecking (`tsc --noEmit`) |
| `npm run build` | Build production frontend bundle to `dist/` (`vite build`) |
| `npm start` | Run the server in production mode (`node server.ts`) |

## Coding & Security Guidelines

- **TypeScript Strictness**: Ensure `npm run lint` (`tsc --noEmit`) passes with zero errors before opening a pull request.
- **Zero Fabricated Contacts**: Never add fallback logic that synthesizes or guesses email addresses (e.g., `info@domain.com`). Only real extracted or operator-entered addresses are allowed.
- **Plain-Text Deliverability**: Keep email generation and RFC 2822 draft building strictly `text/plain` with zero HTML or Markdown.
- **Security First**:
  - Any new outbound HTTP fetch taking user-supplied or discovered URLs must validate targets via `assertSafePublicUrl` or `safeFetchHtml` in `server/security.ts`.
  - Never expose raw API keys in API responses or browser `localStorage`.
  - Keep `user-settings.json`, `.env`, and `./data/*.db` untracked and never commit credentials or scraped lead data.

## Pull Request Process

1. Fork the repository and create a feature branch from `main` (e.g., `feat/my-improvement` or `fix/issue-name`).
2. Make focused, well-scoped changes.
3. Run `npm run lint` and `npm run build` locally and verify both succeed.
4. Open a Pull Request using the PR template describing what changed, why, and how it was tested.
