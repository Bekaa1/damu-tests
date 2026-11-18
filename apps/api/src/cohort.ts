import { db } from "./db";
import { normRoster } from "./norms";
import {
  attachFrozenNorm,
  type FrozenPayload,
} from "../../../packages/core/frozen-norms";
// Reading a report never constructs or updates a norm.
export async function campaignRanks(
  organizationId: string,
  campaignId: string,
  provided?: any,
) {
  const norm =
    provided === undefined
      ? await db.frozenNorm.findFirst({ where: { organizationId, campaignId } })
      : provided;
  const out = new Map<string, any>();
  if (!norm) return out;
  const { rows } = await normRoster(db, organizationId, campaignId);
  for (const r of rows)
    out.set(
      r.resultId,
      attachFrozenNorm(r, norm.metrics as unknown as FrozenPayload, norm.id),
    );
  return out;
}
