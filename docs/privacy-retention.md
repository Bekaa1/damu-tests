# Participant privacy and retention

## Effective policy in this release

- Employee assessment data expires **three calendar months from `Membership.createdAt`**, using UTC and clamping an absent day to the destination month's last day. The exact boundary is inclusive. For example, `2026-11-30T10:15:30.123Z` expires at `2027-02-28T10:15:30.123Z`; the equivalent leap-year deadline is February 29.
- Assessment and pilot participants are covered. Synthetic fixtures may follow the same rule; a label does not permit indefinite retention or external processing.
- Login, consent renewal, answers and retakes do not restart the deadline. Organization `retentionDays` is not an override for this policy.
- Staff roles and platform administrators are not automatically erased. For a shared user, only the expired membership's organization data is erased; remaining memberships, credentials, sessions and other-organization records survive.
- Demo-only credentials (`User.demoOnly`) can access only organizations explicitly marked `dataMode: synthetic`. AccessGuard enforces this on the selected organization/header even for platform administrators, and `participant()` independently rejects a demo-only caller in real scope. A demo-only account always needs an active synthetic membership and receives that membership's actual role, never global superadmin; `requireRole` independently rejects its platform bypass even if both flags are accidentally true. Isolation does not delete old memberships/history; existing users default to `demoOnly: false`.
- General assessment consent is `assessment-2026-11-21-retention` (Russian/Kazakh). It names the period, registration anchor, UTC/month-end rule and no-renewal rule. It does not authorize or imply an external processing service. Pilot consent/version and its voluntary/employer-permission rules remain unchanged.
- This is implementation of the owner's approved product policy, not a legal opinion or a claim of separate institutional approval.

## Public contracts

`packages/core/data-policy.ts`:

```ts
participantDeletionDate(createdAt: Date | string): Date
participantDataExpired(
  member: { role: string; createdAt: Date | string } | null | undefined,
  organization: { purpose?: string; dataMode?: string } | null | undefined,
  now?: Date,
): boolean
externalAiAllowed(organization?: { purpose?: string; dataMode?: string } | null): boolean
```

The role-only expiry helper cannot discover platform-administrator status. API callers with user information must additionally exclude `user.platformAdmin`; the access guard, participant lookup and erasure service do so. A missing member/organization is not an expiry authorization and must still fail the caller's normal access checks.

`externalAiAllowed` is **false for every organization**, including synthetic/demo/pilot, missing organizations and all environment/settings combinations. There is no enable environment variable or new administrator override. A future provider change needs separate documented approval and tests. Policy responses use `status: disabled_by_policy`, `code: external_ai_disabled` and the exported Russian explanation. Classic AI queue/manual/regenerate and pre-policy queued/retry workers deny before reading result snapshots, provider credentials, budgets or making a provider fetch. An existing completed historical report is not regenerated or relabelled as a new completion.

General erasure exports in `apps/api/src/pilot-retention.ts`:

- `eraseExpiredParticipant(id, now?)`
- `sweepParticipantRetention(now?)` → `{deleted, failed}`
- `startParticipantRetention()` → interval handle (startup sweep, then every minute; non-overlapping)
- `eraseParticipantData(organizationId, id, now?)` for explicitly authorized administrative withdrawal

Legacy `pilotDeletionDate`, `pilotDataExpired`, `eraseExpiredPilotParticipant`, `sweepPilotRetention`, `startPilotRetention` remain compatible; purpose-sensitive pilot APIs are still **pilot-only**, not renamed general policies. `clearExpiredParticipantCache(storage, now?)` is the general browser-storage entry point; `clearExpiredPilotCache` remains the pilot compatibility wrapper.

## Erasure and failure behavior

1. Resolve and validate the employee, organization and platform-admin exclusion. Persist a tenant/user/role-scoped block before touching storage.
2. Lock the global user and scoped membership in a transaction; re-read eligibility and tenant/user identity. This also serializes deletion of shared accounts.
3. Delete this participant's S3 objects **before any database evidence/reference deletion**. A failure leaves the durable block and all file references for retry. Partially removed S3 objects can be deleted again safely.
4. Remove answers/results/attempts/assignments, observations, AI/final reports, participant groups and consensus, file references, affected frozen norms, and generated reports linked through membership, participant IDs, snapshot/content or file IDs. Generated report artifact bytes cascade from their parent report. SQL migrations also define consensus FKs beyond what older Prisma schema versions expose; do not infer an orphan from the schema alone.
5. Remove identifier/name/email/file-related audit entries within this organization; unrelated organization records survive. The erasure receipt has no subject/actor identifier or PII. If no membership remains, remove verification and global user auth records; sessions/accounts cascade. Shared global auth records are not revoked.
6. Failed subjects retry on the next sweep; value-based batch pagination prevents failed early candidates from starving later subjects. Exact calendar eligibility is rechecked after the coarse scan filter.

S3 success followed by transaction failure is safe to retry: references are retained until commit and object deletes are idempotent. The persisted block prevents new requests; in-flight writers must also coordinate with the membership lock before committing personal data (see integration below). Physical cleanup is asynchronous and cannot be promised at the millisecond boundary; access denies immediately at expiry and failures are retried rather than concealed.

## Backups and restoration

`scripts/backup-production.py` reads the earliest three-calendar-month deadline across **all employee memberships**, excluding platform administrators; it no longer filters to pilot organizations. UTC is explicit in the SQL session. The manifest deadline is the earlier of seven days and that subject deadline. An already-expired subject blocks creation before `pg_dump`. Manifest-first writing also covers incomplete dumps.

Expiry still deletes only the two explicitly registered archive filenames, checks directory/manifest/target symlinks and traversal, and never recursively deletes directories. This script does not copy S3 objects or establish restore acceptance. Every exported/off-site copy must carry and enforce the same deadline; no unmanaged copy is permitted to outlive it.

**Release gate:** old pilot-only manifests do not establish compliance for real assessment data already inside those archives. Inventory and retire legacy/unregistered/off-site archives under an operator-approved plan; do not simply assert their older manifests are sufficient. Validate an unexpired local restore and the storage/reference cleanup before enabling retrospective production cleanup. After a restore, run retention before granting access. No production command was run for this local implementation.

## Integrated boundaries and release gates

The following boundaries are integrated in this branch. Their local acceptance is separate from publication and production activation; the production conditions below remain open until explicitly authorized and verified.

- Controller `/me` and consent audit: use `participantDeletionDate` for all employee memberships (except platform administrators), not only pilot. Return the exact deletion deadline and external-AI policy status. Preserve the existing persisted consent version, full text, SHA-256 text hash and acceptance timestamp.
- Participant lists/aggregates that bypass `participant()` must exclude expired subjects server-side; checking only the caller in AccessGuard is not a target-record filter. Filter demo-only organization choices to synthetic scope as well.
- Attempt capture and background submission/scoring: expose `dataDeletionAt` for all employees and reject expired/missing participants on background writes; do not disable deterministic scoring merely because external AI is denied.
- Generated-report queue/manual/regenerate/retry workers and reads/downloads: check the current policy before **every** provider call and current participant eligibility before capture/persistence/read (including all members of saved team snapshots). Keep `generationMode: data` and local data PDF creation available. A policy-denied AI job must never masquerade as a completed generated report.
- Browser: invoke `clearExpiredParticipantCache` before offline restoration and at the deadline while open. Raw answer/presence keys for expired cached assignments are actually removed; other campaign caches remain. A closed browser or already downloaded file cannot be erased remotely. Display disabled AI honestly without hiding ordinary local PDFs.
- Participant details, legacy final reports, personal-data exports and file downloads prepare payloads and identifying receipts inside the shared users-then-memberships fence. Expert campaign assignment is rechecked through the same transaction; file body preparation has a finite 20-second budget.
- Observation, final-report, consensus and recalculation mutations commit their identifying receipts inside their participant fence. Administrative assessor changes use that same fence; expert writes and both upload phases repeat the exact-campaign authorization check. Erasure collects historical consensus IDs as well as result, observation and report IDs.
- In-flight uploads reserve a durable recovery reference before PUT, then hold the participant fence through PUT and persistence. Known failures compensate without losing recovery references. Outcome-uncertain PUTs stay pending and prevent erasure completion until an operator establishes provider/request quiescence; a successful DELETE, abort or guessed wait is not sufficient proof. Generated-report writes and final PDF byte-read/export receipts have their corresponding participant/report access fences. Verify these boundaries with complete handlers and real PostgreSQL/S3, not an always-rejected fence mock alone.
- Production remains gated on a read-only impact inventory, approved recovery/backup checks and explicit release permission. Startup now invokes the general sweep, so deployment would activate real-employee retrospective cleanup; do not deploy this branch accidentally.

## Local checks

```sh
npx vitest run tests/data-policy.test.ts tests/pilot-retention.test.ts
python3 tests/test_backup_retention.py
npm run typecheck
```

The synthetic PostgreSQL/S3 acceptance script is deliberately opt-in and refuses non-loopback targets before importing database/storage providers. Point only at a disposable local database and a dedicated `test-`/`qa-` bucket:

```sh
RUN_DATA_RETENTION_INTEGRATION=1 \
DATA_RETENTION_TEST_DATABASE='<exact disposable database name>' \
DATABASE_URL='<loopback test PostgreSQL URL>' \
S3_ENDPOINT='<loopback S3 URL>' S3_BUCKET='qa-retention' \
npx tsx tests/data-retention-integration.ts
```

Supply test S3 credentials in the process environment, never source or logs. The script creates uniquely prefixed synthetic fixtures, exercises assessment/pilot and exact boundaries, verifies S3 deletion and DB report/artifact/raw-data cleanup, protects shared users/staff, and cleans up its fixtures. Parent integration must additionally exercise concurrent writers and the real HTTP/browser paths; unit mocks are not proof of those boundaries.
