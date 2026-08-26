# Additional Pain-Management Tele-Visits Plan Verification

## Summary

Overall readiness: **Ready**.

Verified plan:
`thoughts/shared/plans/2026-08-25-additional-pain-management-tele-visits-implementation.md`.

The plan is consistent with the current case, note, procedure, billing, quality
review, timeline, document, provider-profile, and Supabase migration patterns.
It uses an expand/migrate/contract rollout and preserves legacy routes and data
while adding care episodes, append-only encounters, telehealth follow-up notes,
procedure orders, appointment attempts, and transactional completion.

## Findings

The verification initially found and the revised plan now resolves:

- every current legacy procedure type, mixed-series backfill, nullable legacy
  visit dates, and provider-profile snapshots;
- immediate cross-table ownership constraints, least-privilege grants/RLS, and
  authenticated-only security-invoker RPCs with fixed search paths;
- a deployment-window catch-up backfill for records written after the additive
  migration and before dual-write writers deploy;
- persistent idempotency for return-start, scheduling, and completion;
- transactional procedure/vitals/appointment/order completion and locked,
  unique, immutable series numbering for both appointment and direct workflows;
- explicit rules for continuation series, linked-procedure deletion,
  follow-up-note unfinalization, unresolved work at discharge, and series closure;
- encounter/procedure billing source claims that retain the existing separate
  medical and facility invoices and make invoice replacement atomic;
- a legacy-upgrade fixture pipeline in addition to final-schema pgTAP tests;
- local-first type generation with post-deployment remote parity checks;
- a concrete server-side `ENABLE_RETURN_TELE_VISITS` gate shared by routes,
  actions, and navigation, with stricter episode guards enabled atomically;
- backward-compatible QC payload/hash handling and direct-URL gate tests.

No remaining implementation-blocking contradiction was found in the final scan.

## Missing Work

No planning work is required before implementation. The implementation itself
must still execute each phase and its verification criteria, including the
preflight anomaly checks. Any real production anomaly reported by preflight—such
as care dated after discharge, duplicate legacy procedure numbers, or duplicate
billing source/category claims—must be repaired explicitly before the feature
migrations proceed.

## Risks

- Historical-data anomalies can stop the upgrade by design.
- Phase ordering is operationally important: dual-write writers and catch-up
  migration must precede cardinality contraction.
- The rollout variable, navigation, and stricter active-episode guard must be
  enabled together to avoid a temporary write gap.
- Clinical document immutability and billing claims make some corrections
  intentionally reject rather than cascade.

These risks have concrete mitigations and verification steps in the plan.

## Suggested Changes

No further plan changes are required. During implementation, keep migration
names CLI-generated, implement one phase at a time, and do not enable the return
workflow until the upgrade fixture, pgTAP authorization/state tests, application
regressions, and manual two-episode scenario pass.

## Final Recommendation

Proceed with implementation from the verified plan. Do not collapse the phases
or relax the preflight, transaction, ownership, billing-claim, or rollout-gate
requirements for convenience.
