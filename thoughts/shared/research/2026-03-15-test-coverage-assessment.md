---
date: 2026-03-15T21:44:32Z
researcher: Claude
git_commit: c75921a94dbd8ef945af44c78637c5add9207349
branch: main
repository: cliniq
topic: "Test Coverage Assessment"
tags: [research, testing, coverage, quality]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude
---

# Research: Test Coverage Assessment

**Date**: 2026-03-15T21:44:32Z
**Researcher**: Claude
**Git Commit**: c75921a94dbd8ef945af44c78637c5add9207349
**Branch**: main
**Repository**: cliniq

## Research Question
Does the project have enough test coverage?

## Summary

The project currently has **zero test coverage**. No testing framework is installed, no test files exist, no test scripts are configured, and no CI/CD pipeline runs tests. The codebase contains **181 source files** across server actions, components, validation schemas, AI extraction logic, PDF generation, and Supabase integration — none of which have any automated tests.

## Detailed Findings

### Testing Infrastructure — None Present
- No test runner installed (no Jest, Vitest, Playwright, Cypress, or Testing Library)
- No test configuration files (`jest.config.*`, `vitest.config.*`, etc.)
- No `test` script in `package.json`
- No CI/CD pipeline (no `.github/workflows/` directory)
- No test setup files (`setupTests.*`, `globalSetup.*`)

### Source File Inventory (181 files, 0% tested)

| Category | File Count | Description |
|---|---|---|
| App Router Pages/Layouts | 23 | Routes, page components, layouts |
| Server Actions | 22 | Data mutations (CRUD, status changes, AI calls) |
| Clinical Components | 21 | Extraction forms, reviews, lists |
| shadcn/ui Primitives | 25 | Third-party UI primitives (typically not tested) |
| Patient/Case Components | 11 | Wizard, tables, case overview |
| Settings Components | 7 | Clinic/provider config forms |
| Validation Schemas (Zod) | 17 | Form and data validation |
| Claude AI Integrations | 10 | Extraction and generation prompts |
| PDF Templates/Renderers | 8 | react-pdf document generation |
| Billing Components | 6 | Invoice and billing UI |
| Document Components | 6 | Upload, preview, PDF viewer |
| Procedure Components | 4 | Procedure recording and notes |
| Supabase Setup | 4 | Client, server, middleware, DB types |
| Constants | 2 | Status enums and transitions |
| Other (hooks, types, utils, middleware) | 5 | Shared utilities |

### Code Quality Tooling in Place
- **ESLint** with `eslint-config-next` — linting only
- **TypeScript** — static type checking via `tsconfig.json`
- **Zod schemas** — runtime validation on form inputs and server actions

## Code References
- [package.json](package.json) — no test dependencies or scripts
- [src/actions/](src/actions/) — 22 server action files with no test coverage
- [src/lib/validations/](src/lib/validations/) — 17 Zod schemas with no unit tests
- [src/lib/claude/](src/lib/claude/) — 10 AI integration files with no tests
- [src/lib/constants/case-status.ts](src/lib/constants/case-status.ts) — status transition logic with no tests

## Open Questions
- What level of test coverage is desired for MVP vs. production?
- Which testing framework is preferred (Vitest is the most common choice for Next.js 15)?
- Should E2E tests (Playwright) be prioritized alongside unit tests?
- Are AI extraction modules testable without mocking the Anthropic API?
