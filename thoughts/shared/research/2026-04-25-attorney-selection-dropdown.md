---
date: 2026-04-25T20:54:44Z
researcher: arsenaid
git_commit: c3bf3e3e03cdf30270429fc8261aa690bce5b1d5
branch: main
repository: cliniq
topic: "Attorney selection dropdown in case new/edit UI"
tags: [research, codebase, attorney-select, patient-wizard, case-edit, react-hook-form]
status: complete
last_updated: 2026-04-25
last_updated_by: arsenaid
---

# Research: Attorney selection dropdown in case new/edit UI

**Date**: 2026-04-25T20:54:44Z
**Researcher**: arsenaid
**Git Commit**: c3bf3e3e03cdf30270429fc8261aa690bce5b1d5
**Branch**: main
**Repository**: cliniq

## Research Question
Document how the attorney selection dropdown works in the case new/edit UI — components involved, data flow, state management, and connections.

Note: in this codebase, "case" is modeled under the `patients/` domain. Case create lives in the patient wizard; case edit lives in `case-overview-edit-dialog`.

## Summary
`AttorneySelect` ([src/components/attorneys/attorney-select.tsx](src/components/attorneys/attorney-select.tsx)) is a controlled dropdown built on Shadcn's `Select` primitive. It self-loads attorneys via a module-level cached promise calling the `listAttorneys` server action, and embeds an inline "Add New Attorney" dialog. It is consumed identically by:

- **Case create** — inside `WizardStepDetails` ([src/components/patients/wizard-step-details.tsx](src/components/patients/wizard-step-details.tsx)) of `PatientWizard`
- **Case edit** — inside `CaseOverviewEditDialog` ([src/components/patients/case-overview-edit-dialog.tsx](src/components/patients/case-overview-edit-dialog.tsx)) launched from `CaseOverview`

Both consumers wire it as a `react-hook-form` controlled field bound to `attorney_id`.

## Detailed Findings

### Dropdown component — `AttorneySelect`

[src/components/attorneys/attorney-select.tsx](src/components/attorneys/attorney-select.tsx)

- Named export `AttorneySelect` ([attorney-select.tsx:39](src/components/attorneys/attorney-select.tsx#L39)).
- Props ([attorney-select.tsx:23-27](src/components/attorneys/attorney-select.tsx#L23-L27)):
  - `value: string` — selected attorney UUID (controlled).
  - `onChange: (value: string) => void`.
  - `initialAttorneys?: Attorney[]` — optional pre-fetched list.
- Local `Attorney` interface ([attorney-select.tsx:16-21](src/components/attorneys/attorney-select.tsx#L16-L21)) is a hand-written subset (`id`, `first_name`, `last_name`, `firm_name`); does not import from `database.ts`.
- Module-level singleton fetch ([attorney-select.tsx:30-37](src/components/attorneys/attorney-select.tsx#L30-L37)): `initialLoadPromise` cached at module scope; `getInitialAttorneys()` calls `listAttorneys()` once per page lifecycle and stores the promise.
- `use(getInitialAttorneys())` at [attorney-select.tsx:40](src/components/attorneys/attorney-select.tsx#L40) suspends component when no `initialAttorneys` prop given.
- Local state ([attorney-select.tsx:41-42](src/components/attorneys/attorney-select.tsx#L41-L42)):
  - `attorneys` — displayed list.
  - `showAddDialog` — toggles inline create dialog.
- UI primitive: Shadcn `Select` / `SelectTrigger` / `SelectContent` / `SelectItem` ([attorney-select.tsx:7](src/components/attorneys/attorney-select.tsx#L7), render at [attorney-select.tsx:52-64](src/components/attorneys/attorney-select.tsx#L52-L64)). Each option renders `"{last_name}, {first_name}"` plus optional `" — {firm_name}"` ([attorney-select.tsx:58-61](src/components/attorneys/attorney-select.tsx#L58-L61)). Not a Combobox; no search/filter input.
- Inline create:
  - `Plus` `Button` opens dialog ([attorney-select.tsx:65](src/components/attorneys/attorney-select.tsx#L65)).
  - `Dialog` renders `AttorneyForm` with `embedded` prop ([attorney-select.tsx:74](src/components/attorneys/attorney-select.tsx#L74)).
  - `handleAttorneyCreated` ([attorney-select.tsx:44-48](src/components/attorneys/attorney-select.tsx#L44-L48)) appends to local `attorneys` state, calls `onChange(attorney.id)` to auto-select, closes dialog. Module-cached promise is not invalidated.

### Server action — `listAttorneys`

[src/actions/attorneys.ts](src/actions/attorneys.ts)

- `listAttorneys(search?: string)` at [actions/attorneys.ts:96-118](src/actions/attorneys.ts#L96-L118):
  - Supabase server client query against `attorneys` table.
  - `select('*')`, filter `deleted_at IS NULL`, order by `last_name ASC` ([actions/attorneys.ts:99-103](src/actions/attorneys.ts#L99-L103)).
  - Optional ilike search on `first_name`, `last_name`, `firm_name` ([actions/attorneys.ts:105-109](src/actions/attorneys.ts#L105-L109)). `AttorneySelect` never passes `search`.
  - Returns `{ data: Attorney[] }` or `{ error, data: [] }`.
- `createAttorney` ([actions/attorneys.ts:7-33](src/actions/attorneys.ts#L7-L33)) used by inline `AttorneyForm`. Validates with `attorneySchema`; sets `created_by_user_id` / `updated_by_user_id` from `supabase.auth.getUser()`. Calls `revalidatePath('/attorneys')` ([actions/attorneys.ts:31](src/actions/attorneys.ts#L31)) — does not revalidate patient/case paths.

### Validation schema

[src/lib/validations/attorney.ts](src/lib/validations/attorney.ts)

- `attorneySchema` Zod object ([validations/attorney.ts:3](src/lib/validations/attorney.ts#L3)).
- `AttorneyFormValues` type ([validations/attorney.ts:18](src/lib/validations/attorney.ts#L18)).
- Required: `first_name`, `last_name`. Optional: `firm_name`, `phone`, `email` (validates email or empty), `fax`, `address_line1`, `address_line2`, `city`, `state`, `zip_code`, `notes` ([validations/attorney.ts:4-16](src/lib/validations/attorney.ts#L4-L16)).
- Used by `AttorneyForm` inside the inline create dialog. Not used for selection (selection passes only a UUID string).

### Database row type

[src/types/database.ts](src/types/database.ts)

- `attorneys` table Row at [types/database.ts:42-62](src/types/database.ts#L42-L62) includes all schema fields plus `id`, `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`, `deleted_at`.

### Case create flow — `PatientWizard` + `WizardStepDetails`

[src/components/patients/patient-wizard.tsx](src/components/patients/patient-wizard.tsx)

- Exports `PatientWizard` ([patient-wizard.tsx:46](src/components/patients/patient-wizard.tsx#L46)).
- RHF setup ([patient-wizard.tsx:54-73](src/components/patients/patient-wizard.tsx#L54-L73)): `useForm<CreatePatientCaseValues>` with `zodResolver(createPatientCaseSchema)`, mode `'onBlur'`. Default `attorney_id: ''` ([patient-wizard.tsx:69](src/components/patients/patient-wizard.tsx#L69)).
- Step field validation map ([patient-wizard.tsx:30-34](src/components/patients/patient-wizard.tsx#L30-L34)): `attorney_id` is in `STEP_FIELDS[1]` ([patient-wizard.tsx:32](src/components/patients/patient-wizard.tsx#L32)). `form.trigger(['attorney_id', ...])` runs on "Next" before advancing ([patient-wizard.tsx:79](src/components/patients/patient-wizard.tsx#L79)).
- Wraps steps in `<FormProvider {...form}>` ([patient-wizard.tsx:178](src/components/patients/patient-wizard.tsx#L178)).
- Renders `<WizardStepDetails goToStep={goToStep} />` when `currentStep === 1` ([patient-wizard.tsx:186](src/components/patients/patient-wizard.tsx#L186)).
- Submit calls `createPatientCase(form.getValues())` ([patient-wizard.tsx:105-125](src/components/patients/patient-wizard.tsx#L105-L125)); `attorney_id` travels in values object as-is.

[src/components/patients/wizard-step-details.tsx](src/components/patients/wizard-step-details.tsx)

- Exports `WizardStepDetails` ([wizard-step-details.tsx:21](src/components/patients/wizard-step-details.tsx#L21)).
- Calls `useFormContext<CreatePatientCaseValues>()` ([wizard-step-details.tsx:22](src/components/patients/wizard-step-details.tsx#L22)) to consume `FormProvider` from wizard.
- Attorney field wiring ([wizard-step-details.tsx:193-208](src/components/patients/wizard-step-details.tsx#L193-L208)):
  ```tsx
  <FormField
    control={form.control}
    name="attorney_id"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Attorney</FormLabel>
        <FormControl>
          <AttorneySelect
            value={field.value ?? ''}
            onChange={field.onChange}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
  ```
- No `initialAttorneys` prop — `AttorneySelect` uses its own module-level fetch.
- Imports `AttorneySelect` from `@/components/attorneys/attorney-select` ([wizard-step-details.tsx:17](src/components/patients/wizard-step-details.tsx#L17)).

### Case edit flow — `CaseOverview` + `CaseOverviewEditDialog`

[src/components/patients/case-overview.tsx](src/components/patients/case-overview.tsx)

- Exports `CaseOverview` ([case-overview.tsx:73](src/components/patients/case-overview.tsx#L73)).
- Read-only attorney display via joined `caseData.attorney` object ([case-overview.tsx:44-48](src/components/patients/case-overview.tsx#L44-L48), render at [case-overview.tsx:295-311](src/components/patients/case-overview.tsx#L295-L311)).
- "Edit" button opens dialog ([case-overview.tsx:218-221](src/components/patients/case-overview.tsx#L218-L221)). Renders `CaseOverviewEditDialog` and passes `caseDetails.attorney_id = caseData.attorney_id` ([case-overview.tsx:316-330](src/components/patients/case-overview.tsx#L316-L330)).

[src/components/patients/case-overview-edit-dialog.tsx](src/components/patients/case-overview-edit-dialog.tsx)

- Exports `CaseOverviewEditDialog` ([case-overview-edit-dialog.tsx:59](src/components/patients/case-overview-edit-dialog.tsx#L59)).
- Props ([case-overview-edit-dialog.tsx:30-57](src/components/patients/case-overview-edit-dialog.tsx#L30-L57)): includes `caseDetails.attorney_id: string | null`.
- Own RHF instance (not shared context). `combinedSchema = editPatientSchema.merge(editCaseSchema)` ([case-overview-edit-dialog.tsx:27](src/components/patients/case-overview-edit-dialog.tsx#L27)). Default `attorney_id: caseDetails.attorney_id ?? ''` ([case-overview-edit-dialog.tsx:87](src/components/patients/case-overview-edit-dialog.tsx#L87)) pre-populates dropdown.
- Attorney field wiring ([case-overview-edit-dialog.tsx:355-367](src/components/patients/case-overview-edit-dialog.tsx#L355-L367)) — same pattern as wizard: `value={field.value ?? ''}` + `onChange={field.onChange}`. No `initialAttorneys` prop.
- `handleSave` ([case-overview-edit-dialog.tsx:93-138](src/components/patients/case-overview-edit-dialog.tsx#L93-L138)): calls `updateCase(caseId, caseData)` in parallel with `updatePatient`. `caseData.attorney_id = values.attorney_id` ([case-overview-edit-dialog.tsx:115](src/components/patients/case-overview-edit-dialog.tsx#L115)).
- Imports `AttorneySelect` from `@/components/attorneys/attorney-select` ([case-overview-edit-dialog.tsx:23](src/components/patients/case-overview-edit-dialog.tsx#L23)).

## Code References

- `src/components/attorneys/attorney-select.tsx:30-37` — module-level singleton promise cache for attorney list.
- `src/components/attorneys/attorney-select.tsx:40` — `use()` hook suspends on the fetch promise.
- `src/components/attorneys/attorney-select.tsx:44-48` — inline-created attorney appended to local state and auto-selected.
- `src/components/attorneys/attorney-select.tsx:52-64` — Shadcn `Select` render with formatted option labels.
- `src/actions/attorneys.ts:96-118` — `listAttorneys` server action queries `attorneys` table filtered by `deleted_at IS NULL`.
- `src/components/patients/patient-wizard.tsx:69` — RHF default `attorney_id: ''`.
- `src/components/patients/patient-wizard.tsx:32` — `attorney_id` registered in `STEP_FIELDS[1]` for step validation.
- `src/components/patients/wizard-step-details.tsx:193-208` — attorney `FormField` wiring in case-create wizard.
- `src/components/patients/case-overview-edit-dialog.tsx:87` — RHF default initialised from saved `attorney_id`.
- `src/components/patients/case-overview-edit-dialog.tsx:355-367` — attorney `FormField` wiring in case-edit dialog.
- `src/components/patients/case-overview-edit-dialog.tsx:115` — `attorney_id` written through `updateCase`.

## Architecture Documentation

### Data flow — case create
1. `PatientWizard` initialises RHF with `attorney_id: ''` ([patient-wizard.tsx:69](src/components/patients/patient-wizard.tsx#L69)).
2. Step 1 renders `WizardStepDetails` ([patient-wizard.tsx:186](src/components/patients/patient-wizard.tsx#L186)).
3. `WizardStepDetails` mounts `AttorneySelect` with RHF `field.value` / `field.onChange` ([wizard-step-details.tsx:200-203](src/components/patients/wizard-step-details.tsx#L200-L203)).
4. `AttorneySelect` calls `getInitialAttorneys()` → `listAttorneys()` → Supabase `attorneys` table.
5. User picks attorney → Shadcn `Select.onValueChange` → `onChange(id)` → `field.onChange(id)` → RHF stores UUID.
6. "Next" triggers `form.trigger(['attorney_id', ...])` ([patient-wizard.tsx:79](src/components/patients/patient-wizard.tsx#L79)).
7. Submit: `createPatientCase({ ..., attorney_id })` ([patient-wizard.tsx:109](src/components/patients/patient-wizard.tsx#L109)).

### Data flow — case edit
1. `CaseOverview` passes `caseData.attorney_id` to `CaseOverviewEditDialog` ([case-overview.tsx:326](src/components/patients/case-overview.tsx#L326)).
2. Edit dialog initialises RHF with `attorney_id: caseDetails.attorney_id ?? ''` ([case-overview-edit-dialog.tsx:87](src/components/patients/case-overview-edit-dialog.tsx#L87)).
3. `AttorneySelect` mounts inside dialog. Reuses module-cached promise if wizard already fetched in same session.
4. Pre-populated UUID renders selected attorney in `Select`.
5. Change → `field.onChange(newId)` → RHF state updates.
6. `form.handleSubmit(handleSave)` → `updateCase(caseId, { attorney_id, ... })` ([case-overview-edit-dialog.tsx:111-123](src/components/patients/case-overview-edit-dialog.tsx#L111-L123)).

### Import graph

```
case-overview.tsx
  └── case-overview-edit-dialog.tsx
        └── attorney-select.tsx
              ├── actions/attorneys.ts  (listAttorneys)
              └── attorneys/attorney-form.tsx  (inline create)

patient-wizard.tsx
  └── wizard-step-details.tsx
        └── attorney-select.tsx
              └── (same as above)
```

### Patterns observed
- **Controlled component:** `AttorneySelect` keeps no internal selection state; RHF is sole source of truth for the `attorney_id` UUID.
- **Module-level promise singleton:** at most one `listAttorneys` call per page lifecycle, shared across wizard and edit dialog instances ([attorney-select.tsx:30](src/components/attorneys/attorney-select.tsx#L30)).
- **React `use()` for async client data:** suspends on the fetch promise instead of `useEffect` ([attorney-select.tsx:40](src/components/attorneys/attorney-select.tsx#L40)).
- **Optimistic local-state append on inline create:** new attorney pushed into local `attorneys` state ([attorney-select.tsx:45](src/components/attorneys/attorney-select.tsx#L45)); module-cached promise not invalidated.
- **Soft-delete filtering:** `deleted_at IS NULL` filter on `listAttorneys` ([actions/attorneys.ts:102](src/actions/attorneys.ts#L102)).
- **No search/filter UI:** `Select` primitive used (not `Combobox`); `search` parameter on `listAttorneys` exists but unused by the dropdown.
- **Identical wiring in both consumers:** `<AttorneySelect value={field.value ?? ''} onChange={field.onChange} />` repeated verbatim in wizard step and edit dialog.

## Related Research
None located in `thoughts/shared/research/` covering attorney selection.

## Open Questions
- User mentioned "fix" in the prompt but did not describe a symptom. Specific bug or behavioural complaint to address is unspecified — research documents current state only; targeted fix would require user describing the failure mode (e.g., dropdown not pre-populating on edit, list stale after creating attorney elsewhere, validation behaviour, etc.).
