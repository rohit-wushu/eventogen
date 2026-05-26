import { useEffect, useState } from 'react';
import { getActiveAnnouncements } from '../services/api';
import { AnnouncementPost } from '../pages/PlatformConsolePage';

// Fetches active platform announcements and renders them as rich posts above
// the Dashboard greeting. Dismissals are snoozed for 4 hours via localStorage
// (separate key from the thin top banner so closing one doesn't hide the other).
const DISMISS_KEY = 'announcements-post-dismissed';
const DISMISS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const readDismissMap = () => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') || {}; }
    catch { return {}; }
};

export default function DashboardAnnouncements() {
    const [items, setItems] = useState([]);
    const [dismissed, setDismissed] = useState(() => {
        const map = readDismissMap();
        const now = Date.now();
        return Object.keys(map)
            .filter(id => now - map[id] < DISMISS_TTL_MS)
            .map(id => Number(id));
    });

    useEffect(() => {
        getActiveAnnouncements()
            .then(r => setItems(r.data || []))
            .catch(() => {});
    }, []);

    const dismiss = (id) => {
        const next = [...dismissed, id];
        setDismissed(next);
        const map = readDismissMap();
        const now = Date.now();
        const pruned = Object.fromEntries(
            Object.entries(map).filter(([, ts]) => now - ts < DISMISS_TTL_MS)
        );
        pruned[id] = now;
        localStorage.setItem(DISMISS_KEY, JSON.stringify(pruned));
    };

    const visible = items.filter(a => !dismissed.includes(a.id));
    if (visible.length === 0) return null;

    return (
        <div>
            {visible.map(a => (
                <AnnouncementPost
                    key={a.id}
                    a={a}
                    onDismiss={a.dismissible ? () => dismiss(a.id) : undefined}
                />
            ))}
        </div>
    );
}
