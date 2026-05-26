import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicPartnerShowcase } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import { mergeShowcaseConfig, showcaseConfigToCssVars } from '../components/PartnerShowcaseCustomizer';

// Public, unauthenticated /partners/:eventId page rendering the operator's
// chosen showcase template. Body-scroll lock is released because the admin
// app sets `body { overflow: hidden }` globally — without this the public
// page on mobile would refuse to scroll.

export default function PartnerShowcasePage() {
    const { eventId } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const prevB = document.body.style.overflow;
        const prevH = document.documentElement.style.overflow;
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        return () => { document.body.style.overflow = prevB; document.documentElement.style.overflow = prevH; };
    }, []);

    useEffect(() => {
        if (!eventId) return;
        setLoading(true);
        getPublicPartnerShowcase(eventId)
            .then(r => setData(r.data))
            .catch(err => setError(err.response?.data?.error || 'Failed to load partners'))
            .finally(() => setLoading(false));
    }, [eventId]);

    useEffect(() => {
        if (data?.event?.title) document.title = `${data.event.title} · Partners`;
    }, [data]);

    const merged = useMemo(() => {
        if (!data) return null;
        const m = mergeShowcaseConfig(data.template || 'tiered', data.config || {});
        // Linked-event branding wins over preset defaults — operators
        // expect the showcase to feel like the event itself.
        if (data.event?.font_family) m.fontFamily = data.event.font_family;
        if (data.event?.primary_color) m.accent = data.event.primary_color;
        return m;
    }, [data]);

    const cssVars = useMemo(() => merged ? showcaseConfigToCssVars(merged) : {}, [merged]);

    // Build the row groups the templates render. Two strategies:
    //  1. Manual rows from the operator's arranger (`config.rows` is
    //     an array of arrays of partner ids). Each row becomes a group.
    //     Used when the operator has explicitly arranged anything.
    //  2. Category-based grouping (legacy behaviour) — used when no
    //     manual rows exist, so existing showcases keep working.
    const groups = useMemo(() => {
        if (!data?.partners) return [];
        const byId = Object.fromEntries(data.partners.map(p => [p.id, p]));
        const manualRows = Array.isArray(data?.config?.rows) ? data.config.rows : null;

        if (manualRows && manualRows.length > 0) {
            // Honor operator's row layout. Each row picks up a friendly
            // label from the dominant category in that row (so the
            // category-label switch still has something to render).
            return manualRows.map((rowIds, idx) => {
                const items = rowIds.map(id => byId[id]).filter(Boolean);
                const catCounts = items.reduce((m, p) => {
                    const k = p.category_name || '';
                    m[k] = (m[k] || 0) + 1;
                    return m;
                }, {});
                const dominantCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
                return {
                    id: `row-${idx}`,
                    label: dominantCat || `Row ${idx + 1}`,
                    sequence: idx,
                    items,
                };
            }).filter(g => g.items.length > 0);
        }

        // Fallback: group by category sequence, same as before.
        const map = new Map();
        data.partners.forEach(p => {
            const key = p.category_id || 'uncat';
            if (!map.has(key)) {
                map.set(key, {
                    id: key,
                    label: p.category_name || 'Partners',
                    sequence: p.category_sequence ?? 99,
                    items: [],
                });
            }
            map.get(key).items.push(p);
        });
        return Array.from(map.values()).sort((a, b) => a.sequence - b.sequence);
    }, [data]);

    if (loading) return <div style={shellStyle}><span style={{ color: '#64748b' }}>Loading partners…</span></div>;
    if (error)   return <div style={shellStyle}><h3 style={{ color: '#0f172a' }}>{error}</h3></div>;
    if (!data)   return null;

    const template = data.template || 'tiered';

    return (
        <div className={`ps-root ps-${template}`} style={{ ...cssVars, fontFamily: 'var(--ps-font)', background: 'var(--ps-bg)' }}>
            <div className="ps-container">
                {(merged.sectionTitle || data.event?.title) && (
                    <header className="ps-header">
                        {data.event?.logo_url && <img src={getImageUrl(data.event.logo_url)} alt="" className="ps-logo" />}
                        {merged.sectionTitle && <h1>{merged.sectionTitle}</h1>}
                        {data.event?.title && <p className="ps-event">{data.event.title}</p>}
                    </header>
                )}

                {groups.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--ps-muted)' }}>No partners to show yet.</p>
                ) : template === 'ribbon' ? (
                    <RibbonLayout groups={groups} />
                ) : template === 'wall' ? (
                    <WallLayout groups={groups} showLabels={!!merged.showCategoryLabels} />
                ) : (
                    <TieredLayout groups={groups} showLabels={!!merged.showCategoryLabels} />
                )}
            </div>

            <PSStyles />
        </div>
    );
}

// ── Layout components ───────────────────────────────────────────

// Tier-aware logo size — first category gets the largest treatment, then
// each subsequent category steps down. Caps at 4 levels so the smallest
// tier still reads.
function tierScale(tierIndex) {
    if (tierIndex === 0) return 1.5;
    if (tierIndex === 1) return 1.1;
    if (tierIndex === 2) return 0.85;
    return 0.7;
}

function PartnerLogo({ partner, sizePx }) {
    const url = partner.logo_url ? getImageUrl(partner.logo_url) : null;
    const inner = url
        ? <img src={url} alt={partner.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : <span style={{ fontWeight: 600, color: 'var(--ps-muted)' }}>{partner.name}</span>;
    const card = (
        <span className="ps-card" style={{
            width: sizePx, height: sizePx * 0.6,
            borderRadius: 'var(--ps-card-r)',
            background: 'var(--ps-surface)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '12px 18px',
        }}>{inner}</span>
    );
    return partner.website
        ? <a href={partner.website} target="_blank" rel="noopener noreferrer" className="ps-link" title={partner.name}>{card}</a>
        : card;
}

function TieredLayout({ groups, showLabels }) {
    return (
        <div className="ps-tiered">
            {groups.map((g, i) => {
                const size = 220 * tierScale(i) * (parseFloat(getCssVar('--ps-logo-scale')) || 1);
                return (
                    <section key={g.id} className="ps-tier" style={{ marginBottom: 'var(--ps-spacing)' }}>
                        {showLabels && <h2 className="ps-tier-label">{g.label}</h2>}
                        <div className="ps-tier-row">
                            {g.items.map(p => <PartnerLogo key={p.id} partner={p} sizePx={size} />)}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function WallLayout({ groups, showLabels }) {
    const size = 200 * (parseFloat(getCssVar('--ps-logo-scale')) || 1);
    return (
        <div className="ps-wall">
            {groups.map(g => (
                <section key={g.id} className="ps-wall-section" style={{ marginBottom: 'var(--ps-spacing)' }}>
                    {showLabels && <h2 className="ps-tier-label">{g.label}</h2>}
                    <div className="ps-wall-grid">
                        {g.items.map(p => <PartnerLogo key={p.id} partner={p} sizePx={size} />)}
                    </div>
                </section>
            ))}
        </div>
    );
}

function RibbonLayout({ groups }) {
    const all = groups.flatMap(g => g.items);
    const size = 140 * (parseFloat(getCssVar('--ps-logo-scale')) || 1);
    return (
        <div className="ps-ribbon">
            {all.map(p => <PartnerLogo key={p.id} partner={p} sizePx={size} />)}
        </div>
    );
}

// Read a CSS variable from the document root. Used by the layout components
// to honour --ps-logo-scale at render time without prop-drilling.
function getCssVar(name) {
    if (typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const shellStyle = {
    minHeight: '100vh',
    display: 'grid', placeItems: 'center',
    background: '#f8fafc',
    fontFamily: 'system-ui, sans-serif',
};

function PSStyles() {
    return (
        <style>{`
            .ps-root { min-height: 100vh; padding: 60px 24px; color: var(--ps-text); }
            .ps-container { max-width: var(--ps-max-w); margin: 0 auto; }
            .ps-header { text-align: center; margin-bottom: 56px; }
            .ps-logo { height: 48px; object-fit: contain; margin-bottom: 14px; }
            .ps-header h1 {
                margin: 0; font-size: 2rem; font-weight: 800; letter-spacing: -0.02em;
                color: var(--ps-text);
            }
            .ps-event {
                margin: 8px 0 0; color: var(--ps-muted);
                font-size: 0.85rem; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600;
            }
            .ps-tier-label {
                margin: 0 0 18px; text-align: center;
                color: var(--ps-accent);
                font-size: 0.78rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700;
            }
            .ps-tier-row {
                display: flex; flex-wrap: wrap; gap: 18px;
                align-items: center; justify-content: center;
            }
            .ps-card {
                box-shadow: 0 6px 18px rgba(0,0,0,0.06);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .ps-link { text-decoration: none; color: inherit; }
            .ps-link:hover .ps-card {
                transform: translateY(-2px);
                box-shadow: 0 12px 28px rgba(0,0,0,0.1);
            }

            /* Wall — equal-size grid */
            .ps-wall-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 18px;
            }
            .ps-wall-grid .ps-card {
                width: 100% !important;
                height: 110px !important;
            }

            /* Ribbon — single horizontal scrolling band; less padding so
               it fits comfortably in a header / footer slot. */
            .ps-ribbon {
                display: flex; flex-wrap: wrap; gap: 28px;
                align-items: center; justify-content: center;
            }
            .ps-ribbon .ps-card { box-shadow: none; background: transparent; }
            .ps-ribbon .ps-card img { filter: grayscale(0.2); }
            .ps-ribbon .ps-link:hover .ps-card img { filter: none; }

            @media (max-width: 640px) {
                .ps-root { padding: 40px 14px; }
                .ps-header h1 { font-size: 1.5rem; }
                .ps-tier-row { gap: 12px; }
            }
        `}</style>
    );
}
