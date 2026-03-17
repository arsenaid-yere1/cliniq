---
date: 2026-03-16T00:00:00-07:00
researcher: Claude
git_commit: 27664a306102dc95b221196fc13e9d921acdff27
branch: main
repository: cliniq
topic: "Best email integration for ClinIQ project"
tags: [research, email, notifications, hipaa, resend, aws-ses, react-email, supabase]
status: complete
last_updated: 2026-03-16
last_updated_by: Claude
---

# Research: Best Email Integration for ClinIQ

**Date**: 2026-03-16
**Researcher**: Claude
**Git Commit**: 27664a306102dc95b221196fc13e9d921acdff27
**Branch**: main
**Repository**: cliniq

## Research Question
What would be the best email integration for this project?

## Summary

ClinIQ currently has **zero email infrastructure** — no email libraries, no sending logic, no edge functions. Email addresses are stored on patients, attorneys, and clinic settings but are never used for outbound communication. Email/fax sending of invoices and status change notifications are **explicitly deferred** in existing plans.

The key finding is that **HIPAA compliance dramatically narrows the field**. Most popular transactional email services (Resend, Postmark, SendGrid, Plunk) will not sign a Business Associate Agreement (BAA). Only **AWS SES** and **Mailgun** (enterprise) offer BAAs.

**Recommended approach**: Use **Resend + React Email** for MVP (notification-only emails with no PHI in content), with a planned swap to **AWS SES** for production HIPAA compliance. React Email templates are provider-agnostic, making this swap minimal.

## Detailed Findings

### Current State of the Codebase

#### No Email Infrastructure Exists
- No email sending library in `package.json`
- No API routes or Edge Functions for email
- No SMTP or email service environment variables in `.env.local`
- No notification system, pub/sub, or queue

#### Email Fields Stored but Unused
- `patients.email` — patient contact field
- `attorneys.email` — attorney contact field
- `clinic_settings.email` — clinic contact info

#### Explicitly Deferred Email Features
- [epic-6-story-6.1-create-invoice-from-procedure.md:64](thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md) — "Email/fax sending of invoices" listed as out-of-scope
- [case-status-transitions.md:43](thoughts/shared/plans/2026-03-14-case-status-transitions.md) — "No status change notifications/emails" as out-of-scope constraint

#### Workflow Events That Could Trigger Emails
- Case status transitions: `intake → active → pending_settlement → closed → archived`
- Invoice status transitions: `draft → issued → paid → overdue → void → uncollectible`
- Invoice issuance
- Discharge note finalization (creates PDF, marks case ready for settlement)
- Document uploads

#### Generated PDFs Available for Delivery
- Invoice PDF ([render-invoice-pdf.ts](src/lib/pdf/render-invoice-pdf.ts))
- Initial Visit Note PDF ([render-initial-visit-pdf.ts](src/lib/pdf/render-initial-visit-pdf.ts))
- Procedure Note PDF ([render-procedure-note-pdf.ts](src/lib/pdf/render-procedure-note-pdf.ts))
- Discharge Summary PDF ([render-discharge-note-pdf.ts](src/lib/pdf/render-discharge-note-pdf.ts))

---

### Email Provider Comparison

#### HIPAA Compliance Matrix

| Provider | Signs BAA | HIPAA Eligible | Notes |
|---|---|---|---|
| Resend | No | No | Explicitly no BAA |
| Postmark | No | No | "Do not recommend" for HIPAA |
| SendGrid (Twilio) | No | No | "Customers should not use for PHI" |
| Plunk (cloud) | No | No | GDPR only |
| **AWS SES** | **Yes** | **Yes** | BAA via AWS Artifact (self-service) |
| **Mailgun (Sinch)** | **Yes** (enterprise) | **Yes** | BAA on enterprise plans, custom pricing |

#### Provider Details

**Resend** — Best DX, no HIPAA
- Pricing: Free 3,000/month, Pro $20/month for 50K
- Built alongside React Email by the same team — native integration
- First-class Supabase integration (documented on both sides)
- Works perfectly in Next.js Server Actions and Vercel serverless
- Cannot be used if PHI flows through email content
- [resend.com/pricing](https://resend.com/pricing)

**React Email** — Template library, provider-agnostic
- Not a delivery service — a component library for building email HTML with React
- Works with ALL providers via `render()` to HTML string
- Supports Tailwind CSS in emails via `<Tailwind>` component
- **Use this regardless of which provider you pick**
- [react.email](https://react.email)

**Supabase Edge Functions** — Architecture pattern, not a provider
- Database Webhooks → Edge Function → Email API is the right pattern for ClinIQ
- Triggers on row changes (case status, invoice status)
- Supabase Auth Hook support for custom auth emails (magic links, OTP)
- The Edge Function calls whichever provider you choose
- [supabase.com/docs/guides/functions/examples/send-emails](https://supabase.com/docs/guides/functions/examples/send-emails)

**Postmark** — Best deliverability, no HIPAA
- Pricing: Free 100/month, Basic $15/month for 10K
- Separates IP pools for transactional vs. broadcast (gold standard for deliverability)
- Explicitly not HIPAA compliant, will not execute BAAs
- [postmarkapp.com/pricing](https://postmarkapp.com/pricing)

**SendGrid** — Not recommended
- No free tier (removed May 2025), Essentials $19.95/month
- Not HIPAA compliant despite conflicting third-party reports
- DX inferior to Resend, more complex dashboard
- [sendgrid.com/en-us/pricing](https://sendgrid.com/en-us/pricing)

**AWS SES** — HIPAA compliant, most complex setup
- Pricing: $0.10 per 1,000 emails, free tier 3,000/month for 12 months
- Signs BAA via AWS Artifact (self-service)
- Requires AWS account, IAM config, domain verification, sandbox approval
- Heavier SDK but works in Vercel serverless and Supabase Edge Functions
- Budget extra setup time vs. Resend
- [aws.amazon.com/ses/pricing](https://aws.amazon.com/ses/pricing/)

**Plunk** — Open source, not recommended
- Free 1,000/month, $0.001/email after
- Built on AWS SES, AGPL-3.0 self-hosted option
- No HIPAA on cloud product, self-hosted adds operational burden
- [useplunk.com/pricing](https://www.useplunk.com/pricing)

---

### Recommended Architecture

#### MVP Phase (Resend + React Email)

```
Case status update (DB row change)
  → Supabase Database Webhook
  → Supabase Edge Function
  → Resend API
  → React Email template rendered → recipient
```

**Constraint**: PHI must never appear in email body, subject, or attachments. Emails are notification-only: "Case PI-2026-0042 status updated — log in to view details." Documents delivered via authenticated in-app downloads only.

**Packages to add**:
- `resend` — email delivery SDK
- `@react-email/components` — template components
- `@react-email/render` — server-side rendering

#### Production Phase (AWS SES + React Email)

Same React Email templates, swap the send call from Resend to AWS SES `SendEmailCommand`. Use a thin adapter/wrapper around the send function to make the swap minimal.

**Additional packages**:
- `@aws-sdk/client-ses` — AWS SES SDK v3

**Why this works**: React Email's `render()` produces an HTML string that any provider accepts. The template code is 100% reusable across providers.

---

### Key Decision: PHI Scope

The most important decision for email integration is not which provider to use — it's **whether PHI will ever flow through email**:

- **Notification-only emails** (no PHI in body/subject/attachments): Resend is safe, no BAA needed
- **Emails containing medical data, documents, or patient details**: AWS SES or Mailgun with BAA required

This decision should involve legal counsel and determines whether the Resend → AWS SES migration is a "nice to have" or a hard requirement.

## Code References
- [package.json](package.json) — no email libraries currently installed
- [.env.local](.env.local) — no email service credentials
- [src/actions/billing.ts:423](src/actions/billing.ts#L423) — `generateInvoicePdf` returns base64 (potential email attachment)
- [src/actions/invoice-status.ts:70](src/actions/invoice-status.ts#L70) — `issueInvoice` (potential email trigger)
- [src/actions/case-status.ts](src/actions/case-status.ts) — case status transitions (potential email triggers)
- [src/actions/discharge-notes.ts:422](src/actions/discharge-notes.ts#L422) — `finalizeDischargeNote` (potential email trigger)
- [src/lib/pdf/render-invoice-pdf.ts](src/lib/pdf/render-invoice-pdf.ts) — invoice PDF generation
- [src/lib/validations/patient.ts:13](src/lib/validations/patient.ts#L13) — patient email field
- [src/lib/validations/attorney.ts:8](src/lib/validations/attorney.ts#L8) — attorney email field
- [src/lib/validations/settings.ts:12](src/lib/validations/settings.ts#L12) — clinic email field

## Architecture Documentation
- All data mutations use Server Actions (no API routes) — email sending would follow this pattern or use Supabase Edge Functions
- Supabase is configured with anon key only (no service role key) — Edge Functions would need their own credentials
- PDF rendering uses `@react-pdf/renderer` server-side, returning Buffer/base64 — compatible with email attachment workflows
- Auth uses Supabase email/password — custom auth emails could use the Supabase Auth Hook pattern

## Historical Context (from thoughts/)
- [thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md:64](thoughts/shared/plans/2026-03-12-epic-6-story-6.1-create-invoice-from-procedure.md) — Email/fax invoice sending explicitly deferred as out of scope
- [thoughts/shared/plans/2026-03-14-case-status-transitions.md:43](thoughts/shared/plans/2026-03-14-case-status-transitions.md) — Status change notifications explicitly excluded
- [thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md:218](thoughts/shared/research/2026-03-05-epic-1-patient-case-management-design.md) — "Provider review notification" mentioned as pipeline step but never planned

## Related Research
- No prior email/notification research exists in thoughts/shared/research/

## Open Questions
1. **PHI scope decision** — Will emails ever contain medical data, or strictly notification-only? This determines whether a BAA-capable provider is required from day one.
2. **Resend HIPAA roadmap** — Resend has no documented path to BAA support. If this changes, the calculus shifts entirely.
3. **Mailgun enterprise pricing** — BAA is only on enterprise plans with custom pricing. May not be practical at MVP stage.
4. **Auth email customization** — Should Supabase's default auth emails be replaced with branded React Email templates via the Auth Hook pattern?
5. **Fax integration** — Invoice delivery plans mention "email/fax" — fax is a separate integration (e.g., Twilio Fax, SRFax) not covered here.
