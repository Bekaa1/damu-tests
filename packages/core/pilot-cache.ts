import { pilotDataExpired } from "./pilot";

// Browser storage cannot be erased while a browser is closed. On reopening,
// remove expired pilot caches before they can restore an offline test.
export function clearExpiredPilotCache(storage: Pick<Storage,"length"|"key"|"getItem"|"removeItem">, now=new Date()) {
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>Boolean(k));
  let expiredCampaigns: string[]=[];
  try {
    const cached=JSON.parse(storage.getItem("assessflow.offline-session")||"null");
    if (pilotDataExpired(cached?.session?.member,cached?.session?.organization,now)) {
      expiredCampaigns=(cached.campaigns||[]).map((c:{id:string})=>c.id);
      storage.removeItem("assessflow.offline-session");
    }
  } catch {}
  for(const key of keys.filter(k=>k.startsWith("assessflow.cached."))) {
    try {
      const cached=JSON.parse(storage.getItem(key)||"null");
      if ((cached?.dataDeletionAt && new Date(cached.dataDeletionAt)<=now) || expiredCampaigns.includes(cached?.campaignId)) {
        const id=key.slice("assessflow.cached.".length);
        for(const prefix of ["cached","answers","presence"]) storage.removeItem(`assessflow.${prefix}.${id}`);
      }
    } catch {}
  }
}
