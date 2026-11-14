## Summary
Briefly describe what this PR changes and why.

## Type of Change
- [ ] Security hardening
- [ ] Bug fix
- [ ] Feature / enhancement
- [ ] Documentation

## Checklist
- [ ] `npm run lint` (`tsc --noEmit`) passes with zero errors
- [ ] `npm run build` (`vite build`) completes cleanly
- [ ] No hardcoded API keys, `.env`, or local SQLite database files included
- [ ] Outbound requests use `assertSafePublicUrl` / `safeFetchHtml` where applicable
