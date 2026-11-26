import { pilotDataExpired } from "./pilot";
import { participantDataExpired } from "./data-policy";

type OfflineStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;

// A closed/offline browser cannot be remotely erased. Purge before restoration
// on reopening, and never remove another organization's campaign caches.
function clearExpiredCache(storage: OfflineStorage, now: Date, expired: typeof participantDataExpired) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key));
  let expiredCampaigns: string[] = [];
  try {
    const cached = JSON.parse(storage.getItem("assessflow.offline-session") || "null");
    if (expired(cached?.session?.member, cached?.session?.organization, now)) {
      expiredCampaigns = (cached.campaigns || []).map((campaign: { id: string }) => campaign.id);
      storage.removeItem("assessflow.offline-session");
    }
  } catch { /* Malformed unrelated caches must not break startup. */ }
  for (const key of keys.filter(key => key.startsWith("assessflow.cached."))) {
    try {
      const cached = JSON.parse(storage.getItem(key) || "null");
      if ((cached?.dataDeletionAt && new Date(cached.dataDeletionAt) <= now) || expiredCampaigns.includes(cached?.campaignId)) {
        const id = key.slice("assessflow.cached.".length);
        for (const prefix of ["cached", "answers", "presence"]) storage.removeItem(`assessflow.${prefix}.${id}`);
        for (const entry of keys.filter(k => k.startsWith(`assessflow.journal.${id}.`))) storage.removeItem(entry);
      }
    } catch { /* Continue deleting other expired caches. */ }
  }
}

export function clearExpiredParticipantCache(storage: OfflineStorage, now = new Date()) {
  clearExpiredCache(storage, now, participantDataExpired);
}

/** Compatibility wrapper: an un-dated assessment session is not a pilot. */
export function clearExpiredPilotCache(storage: OfflineStorage, now = new Date()) {
  clearExpiredCache(storage, now, pilotDataExpired);
}
