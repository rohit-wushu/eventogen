import { Form } from 'react-bootstrap';

// Theme presets surfaced in the builder. Each `config` is the full set of
// CSS-variable values the public form needs — the builder seeds these into
// theme_config when an operator picks a preset, and individual fields can
// then be tweaked. Keep these in sync with mergeThemeConfig() in the
// public-form renderer.
export const THEME_PRESETS = {
    classic: {
        label: 'Classic',
        blurb: 'Soft card, rounded inputs.',
        thumb: { bg: '#f1f5f9', card: '#ffffff', accent: '#8b5cf6' },
        config: {
            primary: '#8b5cf6',
            accent: '#ec4899',
            background: '#f8fafc',
            surface: '#ffffff',
            text: '#0f172a',
            mutedText: '#64748b',
            fontFamily: 'Inter',
            fontSize: '15px',
            cardWidth: '720px',
            cardRadius: '20px',
            fieldRadius: '10px',
            fieldSpacing: '18px',
            fieldStyle: 'outlined',
            headerOverlay: 'gradient',
        },
    },
    minimal: {
        label: 'Minimal',
        blurb: 'No card, clean lines.',
        thumb: { bg: '#ffffff', card: '#ffffff', accent: '#0f172a' },
        config: {
            primary: '#0f172a',
            accent: '#0f172a',
            background: '#ffffff',
            surface: '#ffffff',
            text: '#0f172a',
            mutedText: '#64748b',
            fontFamily: 'Inter',
            fontSize: '15px',
            cardWidth: '600px',
            cardRadius: '0px',
            fieldRadius: '0px',
            fieldSpacing: '20px',
            fieldStyle: 'underlined',
            headerOverlay: 'flat',
        },
    },
    gradient: {
        label: 'Gradient',
        blurb: 'Vibrant hero background.',
        thumb: { bg: 'linear-gradient(135deg,#fb7185,#8b5cf6,#06b6d4)', card: '#ffffff', accent: '#7c3aed' },
        config: {
            primary: '#7c3aed',
            accent: '#f97316',
            background: 'linear-gradient(135deg, #fb7185, #8b5cf6, #06b6d4)',
            surface: '#ffffff',
            text: '#0f172a',
            mutedText: '#475569',
            fontFamily: 'Plus Jakarta Sans',
            fontSize: '15px',
            cardWidth: '720px',
            cardRadius: '24px',
            fieldRadius: '12px',
            fieldSpacing: '20px',
            fieldStyle: 'outlined',
            headerOverlay: 'gradient',
        },
    },
    dark: {
        label: 'Dark',
        blurb: 'Neon-accented dark mode.',
        thumb: { bg: '#0b0b1a', card: '#161629', accent: '#22d3ee' },
        config: {
            primary: '#22d3ee',
            accent: '#f472b6',
            background: '#0b0b1a',
            surface: '#161629',
            text: '#f1f5f9',
            mutedText: '#94a3b8',
            fontFamily: 'Inter',
            fontSize: '15px',
            cardWidth: '720px',
            cardRadius: '18px',
            fieldRadius: '10px',
            fieldSpacing: '18px',
            fieldStyle: 'filled',
            headerOverlay: 'flat',
        },
    },
    bordered: {
        label: 'Bordered',
        blurb: 'Editorial, sharp corners.',
        thumb: { bg: '#fefce8', card: '#ffffff', accent: '#0ea5e9' },
        config: {
            primary: '#0ea5e9',
            accent: '#f43f5e',
            background: '#fefce8',
            surface: '#ffffff',
            text: '#1e293b',
            mutedText: '#64748b',
            fontFamily: 'Lora',
            fontSize: '15px',
            cardWidth: '720px',
            cardRadius: '0px',
            fieldRadius: '4px',
            fieldSpacing: '16px',
            fieldStyle: 'outlined',
            headerOverlay: 'flat',
        },
    },
};

// Merge theme + per-form override on top of the preset's defaults so the
// renderer (and the builder's preview frame) always see a fully populated
// config. Used by both the builder customizer and PublicFormPage.
export function mergeThemeConfig(themeKey, overrideConfig) {
    const preset = THEME_PRESETS[themeKey] || THEME_PRESETS.classic;
    const out = { ...preset.config };
    if (overrideConfig && typeof overrideConfig === 'object') {
        for (const k of Object.keys(out)) {
            if (overrideConfig[k]) out[k] = overrideConfig[k];
        }
    }
    return out;
}

// Convert merged config to a CSS-variables style object (for inline style
// or :root scope). Names mirror what PublicFormPage's themed stylesheet
// reads.
export function configToCssVars(config) {
    return {
        '--pf-primary': config.primary,
        '--pf-accent': config.accent,
        '--pf-bg': config.background,
        '--pf-surface': config.surface,
        '--pf-text': config.text,
        '--pf-muted': config.mutedText,
        '--pf-font': `${config.fontFamily}, system-ui, sans-serif`,
        '--pf-font-size': config.fontSize,
        '--pf-card-w': config.cardWidth,
        '--pf-card-r': config.cardRadius,
        '--pf-field-r': config.fieldRadius,
        '--pf-field-gap': config.fieldSpacing,
    };
}

const FONT_FAMILIES = [
    'Inter', 'Plus Jakarta Sans', 'Manrope', 'Roboto',
    'Poppins', 'Montserrat', 'Lora', 'Playfair Display', 'DM Sans'
];

const FIELD_STYLES = [
    { value: 'outlined',   label: 'Outlined' },
    { value: 'filled',     label: 'Filled' },
    { value: 'underlined', label: 'Underlined' },
];

const HEADER_OVERLAYS = [
    { value: 'gradient', label: 'Gradient bar' },
    { value: 'flat',     label: 'Flat color' },
    { value: 'none',     label: 'None' },
];

// Customization sidebar shown in place of "Field properties" when the
// operator switches to the Customize tab. Reads the active preset key +
// override config, and pushes back partial updates as the user tweaks.
export default function FormThemeCustomizer({ theme, themeConfig, onPickPreset, onPatchConfig }) {
    const merged = mergeThemeConfig(theme, themeConfig);

    const ColorRow = ({ label, k }) => (
        <div className="ftc-row">
            <label>{label}</label>
            <div className="ftc-color">
                <input
                    type="color"
                    value={normalizeForColorInput(merged[k])}
                    onChange={e => onPatchConfig({ [k]: e.target.value })}
                    className="ftc-color-pick"
                />
                <input
                    type="text"
                    value={merged[k] || ''}
                    onChange={e => onPatchConfig({ [k]: e.target.value })}
                    className="ftc-color-text"
                />
            </div>
        </div>
    );

    const TextRow = ({ label, k, placeholder }) => (
        <div className="ftc-row">
            <label>{label}</label>
            <input
                type="text"
                value={merged[k] || ''}
                placeholder={placeholder}
                onChange={e => onPatchConfig({ [k]: e.target.value })}
                className="ftc-input"
            />
        </div>
    );

    const SelectRow = ({ label, k, options }) => (
        <div className="ftc-row">
            <label>{label}</label>
            <Form.Select
                size="sm"
                value={merged[k] || options[0].value}
                onChange={e => onPatchConfig({ [k]: e.target.value })}
                className="ftc-input"
            >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Form.Select>
        </div>
    );

    return (
        <div className="ftc">
            <div className="ftc-section-label">Themes</div>
            <div className="ftc-presets">
                {Object.entries(THEME_PRESETS).map(([key, p]) => (
                    <button
                        key={key}
                        type="button"
                        className={`ftc-preset ${theme === key ? 'active' : ''}`}
                        onClick={() => onPickPreset(key)}
                        title={p.blurb}
                    >
                        <span className="ftc-preset-thumb" style={{ background: p.thumb.bg }}>
                            <span className="ftc-preset-card" style={{ background: p.thumb.card, borderColor: p.thumb.accent }}>
                                <span style={{ background: p.thumb.accent }} />
                                <span style={{ background: p.thumb.accent, opacity: 0.4 }} />
                            </span>
                        </span>
                        <span className="ftc-preset-label">{p.label}</span>
                    </button>
                ))}
            </div>

            <div className="ftc-section-label">Colors</div>
            <ColorRow label="Primary"     k="primary" />
            <ColorRow label="Accent"      k="accent" />
            <TextRow  label="Background"  k="background" placeholder="#fff or gradient(...)" />
            <ColorRow label="Surface"     k="surface" />
            <ColorRow label="Text"        k="text" />
            <ColorRow label="Muted text"  k="mutedText" />

            <div className="ftc-section-label">Typography</div>
            <SelectRow label="Font family" k="fontFamily" options={FONT_FAMILIES.map(f => ({ value: f, label: f }))} />
            <TextRow   label="Base size"   k="fontSize"   placeholder="15px" />

            <div className="ftc-section-label">Layout</div>
            <TextRow   label="Card width"     k="cardWidth"    placeholder="720px" />
            <TextRow   label="Card radius"    k="cardRadius"   placeholder="20px" />
            <TextRow   label="Field radius"   k="fieldRadius"  placeholder="10px" />
            <TextRow   label="Field spacing"  k="fieldSpacing" placeholder="18px" />
            <SelectRow label="Field style"    k="fieldStyle"    options={FIELD_STYLES} />
            <SelectRow label="Header overlay" k="headerOverlay" options={HEADER_OVERLAYS} />

            <style>{`
                .ftc { display: flex; flex-direction: column; gap: 14px; }
                .ftc-section-label {
                    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--text-muted); font-weight: 700;
                    margin: 6px 0 -4px;
                }
                .ftc-presets {
                    display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
                }
                .ftc-preset {
                    display: flex; flex-direction: column; align-items: stretch;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid var(--border-subtle); border-radius: 10px;
                    padding: 6px; cursor: pointer; transition: all 0.15s;
                    color: inherit;
                }
                .ftc-preset:hover { border-color: var(--accent); transform: translateY(-1px); }
                .ftc-preset.active {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px rgba(139,92,246,0.25);
                }
                .ftc-preset-thumb {
                    aspect-ratio: 16/9; border-radius: 6px;
                    display: flex; align-items: center; justify-content: center;
                    overflow: hidden;
                }
                .ftc-preset-card {
                    width: 64%; height: 70%; border-radius: 4px;
                    border: 1px solid;
                    padding: 6px;
                    display: flex; flex-direction: column; gap: 4px; justify-content: flex-end;
                }
                .ftc-preset-card > span { display: block; height: 4px; border-radius: 2px; }
                .ftc-preset-card > span:nth-child(1) { width: 80%; }
                .ftc-preset-card > span:nth-child(2) { width: 50%; }
                .ftc-preset-label {
                    margin-top: 6px; font-size: 0.74rem; font-weight: 600;
                    color: var(--text-primary); text-align: center;
                }

                .ftc-row {
                    display: flex; flex-direction: column; gap: 4px;
                }
                .ftc-row label {
                    font-size: 0.72rem; color: var(--text-muted);
                    font-weight: 600; letter-spacing: 0.02em;
                }
                .ftc-input {
                    background: rgba(255,255,255,0.04) !important;
                    border: 1px solid var(--border-subtle) !important;
                    color: var(--text-primary) !important;
                    border-radius: 8px;
                    padding: 6px 10px; font-size: 0.84rem;
                    width: 100%;
                }
                .ftc-input:focus {
                    outline: none;
                    border-color: var(--accent) !important;
                    box-shadow: 0 0 0 2px rgba(139,92,246,0.18) !important;
                }
                .ftc-color {
                    display: flex; gap: 6px; align-items: center;
                }
                .ftc-color-pick {
                    width: 36px; height: 32px;
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px; padding: 2px;
                    background: rgba(255,255,255,0.04);
                    flex-shrink: 0;
                }
                .ftc-color-text {
                    flex: 1; min-width: 0;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-primary);
                    border-radius: 8px;
                    padding: 6px 10px; font-size: 0.84rem;
                    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                }
            `}</style>
        </div>
    );
}

// <input type="color"> needs a 6-char hex. If the saved config holds a CSS
// gradient or named color, fall back to a sane default so the picker still
// renders (the text input continues to display the original value).
function normalizeForColorInput(v) {
    if (typeof v !== 'string') return '#000000';
    const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
        return m[1].length === 3
            ? '#' + m[1].split('').map(c => c + c).join('')
            : v;
    }
    return '#000000';
}
