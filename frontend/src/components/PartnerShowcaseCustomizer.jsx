import { Form } from 'react-bootstrap';

// Three layout templates for the public partners page. Each has a
// `config` block of CSS-variable values; an operator's overrides merge
// on top via mergeShowcaseConfig.
export const PARTNER_SHOWCASE_TEMPLATES = {
    tiered: {
        label: 'Tiered Grid',
        blurb: 'Diamond → Gold → Silver. Logos scale by category.',
        thumb: 'tiered',
        config: {
            background: '#ffffff',
            surface: '#f8fafc',
            accent: '#8b5cf6',
            text: '#0f172a',
            mutedText: '#64748b',
            fontFamily: 'Inter',
            sectionTitle: 'Our Partners',
            showCategoryLabels: true,
            maxWidth: '1100px',
            logoScale: '1',
            spacing: '32px',
            cardRadius: '12px',
        },
    },
    wall: {
        label: 'Equal Wall',
        blurb: 'Every logo same size; tier badges above each row group.',
        thumb: 'wall',
        config: {
            background: '#0f172a',
            surface: '#1e293b',
            accent: '#22d3ee',
            text: '#f1f5f9',
            mutedText: '#94a3b8',
            fontFamily: 'Inter',
            sectionTitle: 'Partners & Sponsors',
            showCategoryLabels: true,
            maxWidth: '1200px',
            logoScale: '1',
            spacing: '24px',
            cardRadius: '14px',
        },
    },
    ribbon: {
        label: 'Ribbon Strip',
        blurb: 'Single horizontal band — drop into a header / footer.',
        thumb: 'ribbon',
        config: {
            background: '#ffffff',
            surface: '#ffffff',
            accent: '#0f172a',
            text: '#0f172a',
            mutedText: '#64748b',
            fontFamily: 'Inter',
            sectionTitle: '',
            showCategoryLabels: false,
            maxWidth: '1200px',
            logoScale: '0.85',
            spacing: '40px',
            cardRadius: '0px',
        },
    },
};

export function mergeShowcaseConfig(templateKey, overrideConfig) {
    const preset = PARTNER_SHOWCASE_TEMPLATES[templateKey] || PARTNER_SHOWCASE_TEMPLATES.tiered;
    const out = { ...preset.config };
    if (overrideConfig && typeof overrideConfig === 'object') {
        for (const k of Object.keys(out)) {
            const v = overrideConfig[k];
            if (v !== undefined && v !== null && v !== '') out[k] = v;
        }
    }
    return out;
}

export function showcaseConfigToCssVars(config) {
    return {
        '--ps-bg': config.background,
        '--ps-surface': config.surface,
        '--ps-accent': config.accent,
        '--ps-text': config.text,
        '--ps-muted': config.mutedText,
        '--ps-font': `${config.fontFamily}, system-ui, sans-serif`,
        '--ps-max-w': config.maxWidth,
        '--ps-logo-scale': config.logoScale,
        '--ps-spacing': config.spacing,
        '--ps-card-r': config.cardRadius,
    };
}

// Tiny ASCII-y svg thumbnails for the template tile previews. Built
// per-key rather than rendered from the actual config so the thumbnail
// communicates the *shape* of each layout — the customizer doesn't need
// 1:1 fidelity, just an at-a-glance hint.
function PresetThumb({ kind, accent }) {
    const bar = (w, opacity = 1) => (
        <span style={{
            display: 'block', height: 6, borderRadius: 2,
            background: accent || '#cbd5e1',
            opacity,
            width: `${w}%`,
        }} />
    );
    if (kind === 'tiered') {
        return (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10 }}>
                <span style={{ display: 'flex', justifyContent: 'center' }}>{bar(60)}</span>
                <span style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>{bar(28, 0.7)}{bar(28, 0.7)}</span>
                <span style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>{bar(16, 0.5)}{bar(16, 0.5)}{bar(16, 0.5)}{bar(16, 0.5)}</span>
            </span>
        );
    }
    if (kind === 'wall') {
        return (
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 10 }}>
                {Array(9).fill(0).map((_, i) => <span key={i} style={{ aspectRatio: '1.6/1', background: accent || '#cbd5e1', opacity: 0.5 + (i % 3) * 0.15, borderRadius: 2 }} />)}
            </span>
        );
    }
    // ribbon
    return (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '20px 10px' }}>
            {Array(5).fill(0).map((_, i) => <span key={i} style={{ width: '12%', height: 8, background: accent || '#cbd5e1', borderRadius: 2 }} />)}
        </span>
    );
}

export default function PartnerShowcaseCustomizer({ template, config, onPickTemplate, onPatchConfig }) {
    const merged = mergeShowcaseConfig(template, config);

    const TextRow = ({ label, k, placeholder }) => (
        <div className="psc-row">
            <label>{label}</label>
            <input
                type="text"
                value={merged[k] ?? ''}
                placeholder={placeholder}
                onChange={e => onPatchConfig({ [k]: e.target.value })}
                className="psc-input"
            />
        </div>
    );

    return (
        <div className="psc">
            <div className="psc-section-label">Layout templates</div>
            <div className="psc-presets">
                {Object.entries(PARTNER_SHOWCASE_TEMPLATES).map(([key, p]) => (
                    <button
                        key={key}
                        type="button"
                        className={`psc-preset ${template === key ? 'active' : ''}`}
                        onClick={() => onPickTemplate(key)}
                        title={p.blurb}
                    >
                        <span className="psc-preset-thumb" style={{ background: '#0b1020' }}>
                            <PresetThumb kind={p.thumb} accent={p.config.accent} />
                        </span>
                        <span className="psc-preset-meta">
                            <span className="psc-preset-label">{p.label}</span>
                            <span className="psc-preset-blurb">{p.blurb}</span>
                        </span>
                    </button>
                ))}
            </div>

            <div className="psc-section-label">Section</div>
            <TextRow label="Section title" k="sectionTitle" placeholder="Our Partners" />
            <div className="psc-row psc-row-inline">
                <Form.Check
                    type="switch"
                    id="psc-cat-labels"
                    checked={!!merged.showCategoryLabels}
                    onChange={e => onPatchConfig({ showCategoryLabels: e.target.checked })}
                    label="Show category labels (Diamond, Gold, …)"
                />
            </div>

            <style>{`
                .psc { display: flex; flex-direction: column; gap: 14px; }
                .psc-section-label {
                    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--text-muted); font-weight: 700;
                    margin: 6px 0 -4px;
                }
                .psc-presets { display: flex; flex-direction: column; gap: 8px; }
                .psc-preset {
                    display: flex; align-items: center; gap: 12px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid var(--border-subtle); border-radius: 10px;
                    padding: 8px; cursor: pointer; transition: all 0.15s;
                    color: inherit; text-align: left;
                }
                .psc-preset:hover { border-color: var(--accent); }
                .psc-preset.active {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px rgba(139,92,246,0.25);
                }
                .psc-preset-thumb {
                    width: 88px; aspect-ratio: 16/9;
                    border-radius: 6px; flex-shrink: 0;
                    overflow: hidden;
                }
                .psc-preset-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .psc-preset-label { font-size: 0.84rem; font-weight: 600; color: var(--text-primary); }
                .psc-preset-blurb { font-size: 0.72rem; color: var(--text-muted); }

                .psc-row { display: flex; flex-direction: column; gap: 4px; }
                .psc-row-inline { flex-direction: row; align-items: center; }
                .psc-row label { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }
                .psc-input {
                    background: rgba(255,255,255,0.04) !important;
                    border: 1px solid var(--border-subtle) !important;
                    color: var(--text-primary) !important;
                    border-radius: 8px;
                    padding: 6px 10px; font-size: 0.84rem;
                    width: 100%;
                }
                .psc-input:focus {
                    outline: none;
                    border-color: var(--accent) !important;
                    box-shadow: 0 0 0 2px rgba(139,92,246,0.18) !important;
                }
            `}</style>
        </div>
    );
}
