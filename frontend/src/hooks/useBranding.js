import { useEffect, useState } from 'react';
import { getBranding } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

// Module-level cache so this hook never refetches across mounts.
let cache = null;
let inflight = null;

async function loadOnce() {
    if (cache) return cache;
    if (inflight) return inflight;
    inflight = getBranding()
        .then(r => { cache = r.data || {}; return cache; })
        .catch(() => { cache = {}; return cache; })
        .finally(() => { inflight = null; });
    return inflight;
}

// Applies title, meta description, and favicon to <head>. Idempotent.
function applyToHead(b) {
    if (b.meta_title || b.site_title) document.title = b.meta_title || b.site_title;
    if (b.meta_description) {
        let m = document.querySelector('meta[name="description"]');
        if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); }
        m.setAttribute('content', b.meta_description);
    }
    if (b.favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'icon'); document.head.appendChild(link); }
        link.setAttribute('href', getImageUrl(b.favicon));
    }
}

// Shape exposed to callers — sane defaults so the UI renders before the
// network response lands.
const DEFAULTS = {
    site_title: 'Eventogen',
    portal_tagline: 'Premium Speaker Suite',
    hero_headline: 'Everything you need to run *unforgettable* events.',
    hero_sub: 'Manage speakers, partners, agendas and travel in one elegant, secure workspace — trusted by event teams worldwide.',
    meta_title: '',
    meta_description: '',
    portal_logo: '',
    favicon: ''
};

export function useBranding() {
    const [b, setB] = useState(cache ? { ...DEFAULTS, ...cache } : DEFAULTS);
    useEffect(() => {
        loadOnce().then(data => {
            const merged = { ...DEFAULTS, ...data };
            setB(merged);
            applyToHead(merged);
        });
    }, []);
    return b;
}

// One-shot call for App boot: apply head tags before any component renders.
// Doesn't return anything — just side-effects.
export async function bootBranding() {
    const data = await loadOnce();
    applyToHead({ ...DEFAULTS, ...data });
}

// Called by the super-admin branding tab after a successful save.
export function invalidateBrandingCache() {
    cache = null;
    inflight = null;
}
