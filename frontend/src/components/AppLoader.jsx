import React, { useState } from 'react';
import { useBranding } from '../hooks/useBranding';
import { getImageUrl } from '../utils/imageUrl';

const SIZE_MAP = { sm: 36, md: 64, lg: 96, xl: 140 };

// Inline fallback "A" mark — used when no tenant favicon is set
// (or while branding is still loading). Keeps the loader visible
// instead of showing a broken-image icon.
const FallbackMark = () => (
    <svg viewBox="0 0 220 220" className="app-loader-img" aria-hidden="true">
        <path
            d="M110 14 L24 206 L62 206 L82 158 L138 158 L158 206 L196 206 Z M94 130 L110 90 L126 130 Z"
            fill="#1d4ed8"
        />
        <path
            d="M126 58 L70 184 L96 184 L108 154 L150 154 L162 184 L188 184 Z M118 132 L129 104 L140 132 Z"
            fill="#3b82f6"
            opacity="0.9"
        />
    </svg>
);

const AppLoader = ({
    size = 'md',
    label = 'Loading…',
    fullscreen = false,
    overlay = false,
    className = '',
    style = {},
}) => {
    const brand = useBranding();
    const [imgFailed, setImgFailed] = useState(false);
    const px = typeof size === 'number' ? size : (SIZE_MAP[size] || SIZE_MAP.md);

    const faviconUrl = brand?.favicon ? getImageUrl(brand.favicon) : '';
    const useFavicon = Boolean(faviconUrl) && !imgFailed;

    const wrapBase = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        ...style,
    };

    let wrapStyle = wrapBase;
    if (fullscreen) {
        wrapStyle = {
            ...wrapBase,
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(7, 9, 28, 0.78)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
        };
    } else if (overlay) {
        wrapStyle = {
            ...wrapBase,
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(7, 9, 28, 0.55)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
        };
    } else {
        wrapStyle = { ...wrapBase, padding: 24 };
    }

    return (
        <div className={`app-loader-wrap ${className}`} style={wrapStyle} role="status" aria-live="polite">
            <div className="app-loader" style={{ width: px, height: px }}>
                {useFavicon ? (
                    <img
                        src={faviconUrl}
                        alt=""
                        className="app-loader-img"
                        draggable={false}
                        onError={() => setImgFailed(true)}
                    />
                ) : (
                    <FallbackMark />
                )}
                <span className="app-loader-ring" aria-hidden="true" />
            </div>
            {label ? <div className="app-loader-label">{label}</div> : null}
            <span className="visually-hidden">{label || 'Loading'}</span>
        </div>
    );
};

export default AppLoader;
