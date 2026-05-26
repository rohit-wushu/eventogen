// Unauthenticated public read-only endpoints intended for embedding event data on
// external/marketing websites. The Speakers/Partners/Agendas/Events admin pages
// link to these via the "JSON URL" button (see ApiEndpointsModal). Each route
// requires an event_id (or :id) and returns only public-safe fields — never
// tenant_id, created_by, contact info, or anything billing-related.

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Helper: confirm the event exists (and capture its tenant_id so child queries
// can scope correctly without trusting client-supplied tenant data).
async function resolveEventTenant(eventId) {
    if (!eventId) return null;
    const [rows] = await db.query('SELECT id, tenant_id FROM events WHERE id = ?', [eventId]);
    return rows.length > 0 ? rows[0] : null;
}

// GET /api/public/speakers?event_id=N
router.get('/speakers', async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        const evt = await resolveEventTenant(event_id);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        const [speakers] = await db.query(`
            SELECT id, salutation, name, designation, company, location, photo_url, bio,
                   role, topic, panel, linkedin_url, sns_card_url, sequence
            FROM speakers
            WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL
              AND is_hidden = 0
            ORDER BY sequence ASC, id ASC`,
            [evt.id, evt.tenant_id]);
        // Replace the DB primary key with a 1-based display index so the public
        // JSON renumbers automatically whenever the admin reorders rows.
        const renumbered = speakers.map((s, i) => ({ ...s, id: i + 1 }));
        res.json(renumbered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/public/partner-showcase?event_id=N
// One-call payload powering the hosted /partners/:eventId page: event
// header data + the chosen showcase template & overrides + every visible
// partner (with category). Same shape `getPartners` returns plus the
// template config so the page can render in a single request.
router.get('/partner-showcase', async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        const [evtRows] = await db.query(
            `SELECT id, tenant_id, title, primary_color, secondary_color, accent_color,
                    font_family, event_logo_url,
                    partner_showcase_template, partner_showcase_config
             FROM events WHERE id = ?`,
            [event_id]
        );
        if (!evtRows.length) return res.status(404).json({ error: 'Event not found' });
        const evt = evtRows[0];
        const [partners] = await db.query(`
            SELECT p.id, p.name, p.website, p.logo_url, p.logo_width, p.logo_height,
                   p.sequence, p.category_id, pc.name AS category_name, pc.sequence AS category_sequence
            FROM partners p
            LEFT JOIN partner_categories pc ON p.category_id = pc.id AND pc.tenant_id = p.tenant_id
            WHERE p.event_id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL
            ORDER BY pc.sequence ASC, p.sequence ASC, p.id ASC`,
            [evt.id, evt.tenant_id]);
        let config = null;
        if (evt.partner_showcase_config) {
            try {
                config = typeof evt.partner_showcase_config === 'string'
                    ? JSON.parse(evt.partner_showcase_config)
                    : evt.partner_showcase_config;
            } catch { config = null; }
        }
        res.json({
            event: {
                id: evt.id,
                title: evt.title,
                logo_url: evt.event_logo_url,
                primary_color: evt.primary_color,
                secondary_color: evt.secondary_color,
                accent_color: evt.accent_color,
                font_family: evt.font_family,
            },
            template: evt.partner_showcase_template || 'tiered',
            config: config || {},
            partners,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/public/partners?event_id=N
// Includes category name and the configured logo dimensions so the marketing
// site can render each logo at the size set in the admin panel.
router.get('/partners', async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        const evt = await resolveEventTenant(event_id);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        const [partners] = await db.query(`
            SELECT p.id, p.name, p.website, p.logo_url, p.logo_width, p.logo_height,
                   p.sequence, p.category_id, pc.name AS category_name
            FROM partners p
            LEFT JOIN partner_categories pc ON p.category_id = pc.id AND pc.tenant_id = p.tenant_id
            WHERE p.event_id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL
            ORDER BY p.sequence ASC, p.id ASC`,
            [evt.id, evt.tenant_id]);
        const renumbered = partners.map((p, i) => ({ ...p, id: i + 1 }));
        res.json(renumbered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/public/agendas?event_id=N
// Returns agendas grouped by day_number with their assigned speakers nested.
router.get('/agendas', async (req, res) => {
    try {
        const { event_id } = req.query;
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        const evt = await resolveEventTenant(event_id);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        const [agendas] = await db.query(`
            SELECT id, title, description, day_number, start_time, end_time, sequence
            FROM agendas
            WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL
            ORDER BY day_number, sequence, start_time`,
            [evt.id, evt.tenant_id]);

        if (agendas.length === 0) return res.json([]);

        const agendaIds = agendas.map(a => a.id);
        const [speakerMappings] = await db.query(`
            SELECT asp.agenda_id, s.id, s.name, s.photo_url, s.designation, s.company
            FROM agenda_speakers asp
            JOIN speakers s ON asp.speaker_id = s.id AND s.tenant_id = asp.tenant_id AND s.deleted_at IS NULL AND s.is_hidden = 0
            WHERE asp.agenda_id IN (?) AND asp.tenant_id = ?`,
            [agendaIds, evt.tenant_id]);

        // Snapshot each agenda's speaker list using DB ids first, then renumber the
        // outer agenda ids and re-key nested speakers to a sequential index too.
        const withSpeakers = agendas.map((a, i) => ({
            ...a,
            id: i + 1,
            speakers: speakerMappings
                .filter(sm => sm.agenda_id === a.id)
                .map((sm, j) => ({ id: j + 1, name: sm.name, photo_url: sm.photo_url, designation: sm.designation, company: sm.company }))
        }));
        res.json(withSpeakers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/public/events/:id
// Public-safe metadata: title/dates/venue/branding/logos. Strips owner/team
// fields and anything billing-related.
router.get('/events/:id', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, title, description, start_date, end_date, venue, status, category,
                   event_logo_url, company_logo_url, sns_card_bg_url,
                   primary_color, secondary_color, accent_color, font_family,
                   meta_title, meta_description, og_image_url, favicon_url
            FROM events
            WHERE id = ?`,
            [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
