# P0 implementation and acceptance checklist

The attached plan is a specification, not verification evidence. No production fixtures.

- [x] Durable schema, private grants, lease/CAS and conservative budget accounting; disposable PostgreSQL verified.
- [x] Branch discovery → details/reviews → validated extraction → deterministic brief; offline adapters/workflow/UI verified.
- [x] Bounded gap action, cache reuse, resumable steps, honest partial failures; offline fault tests verified.
- [x] Private sessions, CSRF, request validation and ownership on all routes; offline security/grant tests verified.
- [x] T01–T30 offline coverage, 41 labeled synthetic proposed extractions, browser/axe tests. Real Gemini quality check: 28 examples, 20 accepted correct claims, zero unsupported positives/invalid accepted citations; scope and critical-negative/condition gates passed.
- [x] Typecheck, lint, offline tests, database checks, browser checks, production build. Actual counts are in verification.md.
- [x] Hosted migrations/private grants, actual Maps/details/reviews/filtered-empty/web shapes, complete real local browser smoke with pause/reload/resume and second-session denial. Verification usage 6/30 reserved attempts; provider balance 250→245.
- [ ] Vercel live smoke only with authorized project access.
- [x] README, setup/deploy instructions, actual verification record, 2:40 local demo script and AI disclosure.
- [ ] Record the genuine local provider demo, inspect the actual extracted claims, and supply a usable video link.

P0 is implemented and locally verified with the real configured providers and hosted Supabase. Vercel login/project access and the narrated hackathon recording remain open. No deployed flow has been claimed.
