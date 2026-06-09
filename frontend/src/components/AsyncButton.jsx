import { useRef, useState } from 'react';
import { Spinner } from 'react-bootstrap';

// Drop-in <button> replacement that prevents the double-click footgun on
// any async action (create / save / submit / upload / etc.).
//
// Pass an async `onClick` and AsyncButton will:
//   • Set `disabled` on itself for the lifetime of the returned Promise
//   • Show a leading spinner (replacing the icon if you provided one)
//   • Optionally swap the visible label for `loadingText`
//   • Ignore extra clicks while still in-flight (defence in depth, since the
//     button is already disabled but bubbling / programmatic clicks can slip
//     through)
//
// All other props (className, style, type, title, form, …) pass through
// straight to the underlying <button>, so an existing styled button can be
// converted by changing the tag name and adding nothing else.
//
// Usage:
//   <AsyncButton onClick={handleSave} className="btn btn-primary">
//     Save
//   </AsyncButton>
//
//   <AsyncButton
//     onClick={handleCreate}
//     loadingText="Creating…"
//     icon={<BsPlus />}
//     className="btn-action"
//   >
//     Create Event
//   </AsyncButton>
export default function AsyncButton({
    onClick,
    children,
    loadingText,
    icon,
    disabled,
    className,
    style,
    type = 'button',
    spinnerSize = 'sm',
    spinnerColor,
    ...rest
}) {
    const [loading, setLoading] = useState(false);
    // A ref-based guard so a synchronous double-click in the same tick (or a
    // programmatic .click()) can't slip past the state-based disable.
    const inflightRef = useRef(false);

    const handleClick = async (e) => {
        if (loading || inflightRef.current) return;
        if (!onClick) return;
        inflightRef.current = true;
        setLoading(true);
        try {
            await onClick(e);
        } finally {
            // Defer the reset by a tick so React commits the disabled state
            // before we re-enable — prevents the user-visible "flicker" when
            // the action is instantaneous (e.g. cached response).
            inflightRef.current = false;
            setLoading(false);
        }
    };

    return (
        <button
            type={type}
            onClick={handleClick}
            disabled={loading || disabled}
            className={className}
            style={{
                position: 'relative',
                cursor: loading || disabled ? 'not-allowed' : 'pointer',
                opacity: loading || disabled ? 0.85 : 1,
                ...style,
            }}
            {...rest}
        >
            {loading ? (
                <>
                    <Spinner
                        animation="border"
                        size={spinnerSize}
                        style={{
                            color: spinnerColor || 'currentColor',
                            marginRight: 8,
                            verticalAlign: 'middle',
                            width: spinnerSize === 'sm' ? '1em' : undefined,
                            height: spinnerSize === 'sm' ? '1em' : undefined,
                            borderWidth: 2,
                        }}
                    />
                    {loadingText || children}
                </>
            ) : (
                <>
                    {icon && <span style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>{icon}</span>}
                    {children}
                </>
            )}
        </button>
    );
}
