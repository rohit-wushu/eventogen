const db = require('../config/db');

// ─── @report engine ─────────────────────────────────────────────────
// Detects `@report ...` text in an outgoing group message and, when
// matched, builds a structured report payload describing the event the
// group belongs to (speakers, partners, attendees) + today's chat
// activity. The caller persists the returned payload as a bot_report
// message so every group member sees the same card inline.

const TRIGGER = '@report';

const SUBCOMMANDS = new Set(['', 'speakers', 'partners', 'attendees', 'activity']);

// Parse `body` into { trigger, subcommand } if it starts with @report.
// Returns null for non-report messages so the caller can fall through
// to the normal insert path.
const parseTrigger = (body) => {
    if (!body || typeof body !== 'string') return null;
    const trimmed = body.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower !== TRIGGER && !lower.startsWith(TRIGGER + ' ')) return null;
    const rest = trimmed.slice(TRIGGER.length).trim().toLowerCase();
    const sub = rest.split(/\s+/)[0] || '';
    if (!SUBCOMMANDS.has(sub)) {
        return { subcommand: '__unknown__', raw: rest };
    }
    return { subcommand: sub, raw: rest };
};

// Returns a Date object pinned to the start of "today" in the server's
// local timezone. Used to scope activity counts to today-till-now.
const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const formatNowLabel = () => {
    const d = new Date();
    return d.toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
        month: 'short', day: 'numeric', year: 'numeric'
    });
};

// Collects all event-role data for a single event in one round of
// parallel queries. Soft-deleted speakers/partners are excluded.
const fetchRoleData = async (eventId, tenantId) => {
    const [[event], speakers, partners, attendees] = await Promise.all([
        db.query(
            'SELECT id, title FROM events WHERE id=? AND tenant_id=?',
            [eventId, tenantId]
        ).then(([r]) => r),
        db.query(
            `SELECT id, name, role, designation, company
             FROM speakers
             WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL
             ORDER BY name ASC`,
            [eventId, tenantId]
        ).then(([r]) => r),
        db.query(
            `SELECT p.id, p.name, p.website, pc.name AS category_name
             FROM partners p
             LEFT JOIN partner_categories pc ON pc.id = p.category_id AND pc.tenant_id = p.tenant_id
             WHERE p.event_id=? AND p.tenant_id=? AND p.deleted_at IS NULL
             ORDER BY p.sequence ASC, p.name ASC`,
            [eventId, tenantId]
        ).then(([r]) => r).catch(() => db.query(
            // Fallback if partner_categories table isn't present
            `SELECT id, name, website FROM partners
             WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL
             ORDER BY sequence ASC, name ASC`,
            [eventId, tenantId]
        ).then(([r]) => r)),
        db.query(
            // Only ticket_type + status are used to compute the breakdown;
            // skipping name/company/id avoids hauling kb of unused data
            // on events with thousands of attendees.
            `SELECT ticket_type, status
             FROM attendees
             WHERE event_id=? AND tenant_id=?`,
            [eventId, tenantId]
        ).then(([r]) => r)
    ]);

    return { event: event || null, speakers, partners, attendees };
};

// Group-scoped chat activity for the day so the report can answer
// "what's happening in this chat today, right now?". Excludes deleted
// messages and the bot's own report cards so re-running @report
// doesn't bump its own count.
const fetchActivityToday = async (groupId, tenantId) => {
    const since = startOfToday();
    const firstRow = ([rows]) => rows[0] || {};
    // One pass over today's messages computes all three counters via
    // conditional aggregates — cheaper than three separate scans.
    const [activity, members] = await Promise.all([
        db.query(
            `SELECT
                SUM(message_type='user' AND deleted_for_everyone=0) AS msgs,
                COUNT(DISTINCT CASE WHEN message_type='user' AND deleted_for_everyone=0 THEN sender_id END) AS actives,
                SUM(attachment_url IS NOT NULL AND deleted_for_everyone=0) AS files
             FROM messages
             WHERE group_id=? AND tenant_id=? AND created_at >= ?`,
            [groupId, tenantId, since]
        ).then(firstRow),
        db.query(
            'SELECT COUNT(*) AS cnt FROM chat_group_members WHERE group_id=? AND tenant_id=?',
            [groupId, tenantId]
        ).then(firstRow)
    ]);

    return {
        messages_today: Number(activity.msgs) || 0,
        active_members_today: Number(activity.actives) || 0,
        total_members: members.cnt || 0,
        files_today: Number(activity.files) || 0
    };
};

// Bucket attendees by ticket_type so the card can show a breakdown
// without flooding the chat with hundreds of names.
const summarizeAttendees = (attendees) => {
    const buckets = {};
    let checkedIn = 0;
    for (const a of attendees) {
        const k = a.ticket_type || 'general';
        buckets[k] = (buckets[k] || 0) + 1;
        if (a.status === 'checked_in') checkedIn++;
    }
    return { total: attendees.length, by_type: buckets, checked_in: checkedIn };
};

// Build a section object the frontend can render as a labeled card row.
// Limits long lists to keep the card readable; full lists live elsewhere.
const buildSections = (subcommand, data, activity) => {
    const sections = [];
    const wants = (k) => subcommand === '' || subcommand === k;

    if (wants('speakers')) {
        sections.push({
            key: 'speakers',
            icon: '🎤',
            label: 'Speakers',
            count: data.speakers.length,
            items: data.speakers.slice(0, 20).map(s => ({
                primary: s.name,
                secondary: [s.role, s.designation, s.company].filter(Boolean).join(' · ')
            })),
            more: Math.max(0, data.speakers.length - 20)
        });
    }

    if (wants('partners')) {
        sections.push({
            key: 'partners',
            icon: '🤝',
            label: 'Partners',
            count: data.partners.length,
            items: data.partners.slice(0, 20).map(p => ({
                primary: p.name,
                secondary: p.category_name || (p.website ? p.website.replace(/^https?:\/\//, '') : '')
            })),
            more: Math.max(0, data.partners.length - 20)
        });
    }

    if (wants('attendees')) {
        const summary = summarizeAttendees(data.attendees);
        const breakdown = Object.entries(summary.by_type)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${t.toUpperCase()}: ${n}`);
        sections.push({
            key: 'attendees',
            icon: '👥',
            label: 'Attendees',
            count: summary.total,
            items: breakdown.map(b => ({ primary: b })),
            footer: `Checked in: ${summary.checked_in} / ${summary.total}`
        });
    }

    if (wants('activity')) {
        sections.push({
            key: 'activity',
            icon: '💬',
            label: 'Chat activity today',
            items: [
                { primary: `${activity.messages_today} messages` },
                { primary: `${activity.active_members_today} of ${activity.total_members} members active` },
                { primary: `${activity.files_today} files shared` }
            ]
        });
    }

    return sections;
};

// Build a report for a chat group. Returns a JSON-serializable payload
// the caller stores in messages.body for bot_report rows. Throws on
// "no event linked" so the caller can reply with a helpful error
// instead of an empty card.
const generateGroupReport = async ({ groupId, tenantId, requesterName, subcommand = '' }) => {
    const [groupRows] = await db.query(
        'SELECT id, name, event_id FROM chat_groups WHERE id=? AND tenant_id=?',
        [groupId, tenantId]
    );
    if (groupRows.length === 0) {
        throw new Error('Group not found');
    }
    const group = groupRows[0];
    if (!group.event_id) {
        return {
            kind: 'error',
            title: 'No event linked',
            message: 'This chat group is not tied to an event, so there are no speakers, partners, or attendees to report on.'
        };
    }

    const [roleData, activity] = await Promise.all([
        fetchRoleData(group.event_id, tenantId),
        fetchActivityToday(groupId, tenantId)
    ]);

    if (!roleData.event) {
        return {
            kind: 'error',
            title: 'Event missing',
            message: 'The event linked to this group could not be found (it may have been deleted).'
        };
    }

    return {
        kind: 'report',
        title: `Event Report — ${roleData.event.title}`,
        subtitle: `As of ${formatNowLabel()}`,
        scope: subcommand || 'full',
        sections: buildSections(subcommand, roleData, activity),
        footer: `Requested by ${requesterName || 'a member'}`
    };
};

const errorPayload = (title, message) => ({ kind: 'error', title, message });

module.exports = {
    TRIGGER,
    parseTrigger,
    generateGroupReport,
    errorPayload
};
