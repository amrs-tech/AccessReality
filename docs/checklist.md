# P0 implementation and acceptance checklist

The attached plan is a specification, not verification evidence. No production fixtures.

- [x] Durable schema, private grants, lease/CAS and conservative budget accounting; disposable PostgreSQL verified.
- [x] Branch discovery → details/reviews → validated extraction → deterministic brief; offline adapters/workflow/UI verified.
- [x] Bounded gap action, cache reuse, resumable steps, honest partial failures; offline fault tests verified.
- [x] Private sessions, CSRF, request validation and ownership on all routes; offline security/grant tests verified.
- [x] T01–T30 offline coverage, at least 24 labeled synthetic proposed extractions, browser/axe tests. Real-model quality is pending.
- [x] Typecheck, lint, offline tests, database checks, browser checks, production build. Actual counts are in verification.md.
- [ ] Live provider shapes/local smoke only with credentials; ≤30 verification attempts.
- [ ] Vercel live smoke only with authorized project access.
- [x] README, setup/deploy instructions, actual verification record, 2:40 local demo script and AI disclosure.
- [ ] Record the genuine local provider demo, inspect the actual extracted claims, and supply a usable video link.

P0 is implemented and offline verified. Credential-dependent release gates remain open; fixture browser checks do not establish a live application investigation or deployment.
