import { useEffect, useState } from 'react';
import { getMySubscription } from '../services/api';

// Module-level cache so multiple QuotaButtons on the same page don't refetch.
// 30s TTL is short enough that the user sees their just-created row reflected
// after a normal navigation; the parent page can also call `bumpQuota` after a
// successful create to invalidate immediately.
let cache = null;
let cacheTime = 0;
let inflight = null;
const TTL_MS = 30_000;
const listeners = new Set();

function emit() { listeners.forEach(fn => fn(cache)); }

async function refresh(force = false) {
    if (!force && cache && (Date.now() - cacheTime) < TTL_MS) return cache;
    if (inflight) return inflight;
    inflight = getMySubscription()
        .then(r => { cache = r.data; cacheTime = Date.now(); emit(); return cache; })
        .catch(err => { cache = null; emit(); throw err; })
        .finally(() => { inflight = null; });
    return inflight;
}

export function invalidateQuota() {
    cache = null;
    cacheTime = 0;
    refresh(true).catch(() => {});
}

// Returns { info, sub, loading } where info is the usage object for `resource`
// (events / speakers / attendees / users / storage). info may be null when the
// caller has no tenant (e.g. super admin) — components should hide UI in that
// case rather than blocking.
export function useQuota(resource) {
    const [snap, setSnap] = useState(cache);

    useEffect(() => {
        const cb = (data) => setSnap(data);
        listeners.add(cb);
        if (!cache) refresh().catch(() => {});
        else setSnap(cache);
        return () => { listeners.delete(cb); };
    }, []);

    return {
        info: snap?.usage?.[resource] || null,
        sub: snap?.subscription || null,
        loading: !snap && !cache
    };
}
