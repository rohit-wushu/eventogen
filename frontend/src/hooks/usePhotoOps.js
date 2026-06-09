import { useState } from 'react';
import { enhanceImage, removeImageBackground } from '../services/api';

// Shared hook for the "Enhance" / "Remove Background" photo-op buttons.
// Three callers used to inline the same boilerplate: state for which op is
// running, fetch the source as a File, call the API, parse the Axios blob-
// error body for a JSON message, hand the processed binary back. Now they
// just plug in `getSource(opName)` (returns File | Blob | URL string | null)
// and `onResult(blob, opName)` (does whatever — replaces a state var,
// re-opens the cropper, etc.).
//
// Returns { photoOp, error, runEnhance, runRemoveBg, reset } where photoOp
// is 'enhance' | 'remove-bg' | null and is the single source of truth for
// disabling other UI while a request is in flight.
export function usePhotoOps({ getSource, onResult }) {
    const [photoOp, setPhotoOp] = useState(null);
    const [error, setError] = useState('');

    const run = async (opName, apiFn) => {
        try {
            setPhotoOp(opName);
            setError('');
            const raw = await getSource(opName);
            if (!raw) {
                setError(`Upload or load a photo first, then ${opName === 'enhance' ? 'Enhance' : 'Remove Background'}.`);
                return;
            }
            // Normalise to a File: accept File/Blob directly, or fetch a URL
            // (data: / blob: / http(s) all work via fetch).
            let sourceFile = raw;
            if (typeof raw === 'string') {
                const r = await fetch(raw);
                if (!r.ok) throw new Error(`Couldn't load current photo (HTTP ${r.status})`);
                const blob = await r.blob();
                sourceFile = new File([blob], 'photo.png', { type: blob.type || 'image/png' });
            } else if (raw instanceof Blob && !(raw instanceof File)) {
                sourceFile = new File([raw], 'photo.png', { type: raw.type || 'image/png' });
            }
            const { data: resultBlob } = await apiFn(sourceFile);
            await onResult(resultBlob, opName);
        } catch (err) {
            // Axios returns blob bodies on error when responseType is 'blob';
            // peek inside for the JSON error message.
            let msg = err?.message || `${opName} failed`;
            if (err?.response?.data instanceof Blob) {
                try { const txt = await err.response.data.text(); const j = JSON.parse(txt); msg = j.error || msg; } catch (_) {}
            }
            setError(msg);
        } finally {
            setPhotoOp(null);
        }
    };

    return {
        photoOp,
        error,
        runEnhance:    () => run('enhance',   enhanceImage),
        runRemoveBg:   () => run('remove-bg', removeImageBackground),
        reset:         () => { setPhotoOp(null); setError(''); },
    };
}
