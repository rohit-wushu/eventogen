const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline `protect` already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'speakers'.
const guard = [protect, requireSection('speakers')];
const { checkLimit } = require('../middleware/limits');
const { notifyAdminsAndManagers } = require('../utils/notify');
const { processSpeakerPhoto, deleteUpload } = require('../utils/imageProcessor');
const { createUpload, fileUrl } = require('../utils/storage');
const path = require('path');
const csv = require('csv-parser');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Convert any Google Drive share-link variant to a direct download URL.
// Examples handled:
//   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
//   https://drive.google.com/open?id=FILE_ID
//   https://drive.google.com/uc?id=FILE_ID
// Non-Drive URLs are returned unchanged.
const normalizePhotoUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const url = raw.trim();
    if (!url) return null;
    let m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    m = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    m = url.match(/drive\.google\.com\/uc\?.*\bid=([a-zA-Z0-9_-]+)/);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    return url;
};

// Download an image to /uploads with a unique filename. Follows redirects (Drive issues several)
// and only writes to disk if the response is an image/* content type. Returns { relPath } or throws.
const CT_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg',
    'image/png': 'png', 'image/x-png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
};
const downloadImageToUploads = (url, baseName) => new Promise((resolve, reject) => {
    const attempt = (current, remaining) => {
        const lib = current.startsWith('https:') ? https : http;
        lib.get(current, (resp) => {
            if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location && remaining > 0) {
                const next = resp.headers.location.startsWith('http')
                    ? resp.headers.location
                    : new URL(resp.headers.location, current).toString();
                resp.resume();
                return attempt(next, remaining - 1);
            }
            if (resp.statusCode !== 200) {
                resp.resume();
                return reject(new Error(`status ${resp.statusCode}`));
            }
            const ct = (resp.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
            if (!ct.startsWith('image/')) {
                // Common cause on Drive: file isn't shared publicly, so Drive returns an HTML
                // login/consent page with content-type text/html. We surface that as a clear error.
                resp.resume();
                return reject(new Error(`not an image (got ${ct || 'unknown'}) — file may not be publicly shared`));
            }
            const ext = CT_EXT[ct] || 'jpg';
            const filename = `${baseName}.${ext}`;
            const filePath = path.join('uploads', filename);
            const writer = fs.createWriteStream(filePath);
            resp.pipe(writer);
            writer.on('finish', () => writer.close(() => resolve({ relPath: `/uploads/${filename}` })));
            writer.on('error', (err) => {
                fs.unlink(filePath, () => {});
                reject(err);
            });
        }).on('error', reject);
    };
    attempt(url, 5);
});

const upload = createUpload('speaker');

// Multi-event aware access helpers. The local `employeeAllowed(req, x)`
// wrapper keeps the existing call-site signature while delegating to the
// shared logic that understands a user's full assigned-event set AND the
// per-event 'speakers' section flag.
const { hasSectionForEvent, assignedIdsOf, assignedIdsForSql, eventIdsForSection } = require('../utils/eventAccess');
const employeeAllowed = (req, event_id) => hasSectionForEvent(req.user, event_id, 'speakers');
// Employee list-scope = events where this user has the speakers section.
const empSpeakerEventIds = (req) => eventIdsForSection(req.user, 'speakers');

router.get('/', guard, async (req, res) => {
    try {
        let query = `SELECT s.*, e.title as event_title FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.tenant_id = ? AND s.deleted_at IS NULL`;
        let params = [req.tenantId];
        if (req.query.event_id) { query += ' AND s.event_id = ?'; params.push(req.query.event_id); }
        if (req.user.role === 'manager') { query += ' AND (e.created_by = ? OR s.event_id IN (?))'; params.push(req.user.id, assignedIdsForSql(req.user)); }
        else if (req.user.role === 'employee') { query += ' AND s.event_id IN (?)'; params.push(empSpeakerEventIds(req)); }

        query += ' ORDER BY s.sequence ASC, s.id ASC';
        const [speakers] = await db.query(query, params);
        // Attach a sequential `serial` field (1, 2, 3, …) so clients can number rows without relying on DB id
        const withSerial = speakers.map((s, i) => ({ ...s, serial: i + 1 }));
        res.json(withSerial);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reorder speakers (drag-and-drop). Body: { updates: [{id, sequence}, ...] }
//
// Was: N scope-check SELECTs + N UPDATEs serially inside a transaction
// (O(n) round-trips, lock contention scales with payload size).
// Now: 1 SELECT to fetch all scopes + 1 UPDATE with CASE to set every
// new sequence in one round-trip.
router.put('/reorder', guard, async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
    }
    const ids = updates.map(u => Number(u.id)).filter(Number.isFinite);
    if (ids.length !== updates.length) {
        return res.status(400).json({ error: 'Invalid speaker id(s)' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch every targeted speaker (with event scope) in one query.
        const [rows] = await connection.query(
            `SELECT s.id, s.event_id, e.created_by
             FROM speakers s
             LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id
             WHERE s.id IN (?) AND s.tenant_id = ? AND s.deleted_at IS NULL`,
            [ids, req.tenantId]
        );
        if (rows.length !== ids.length) {
            throw new Error('Speaker not found');
        }

        // Role-scoped permission check across all of them up front.
        if (req.user.role === 'manager' || req.user.role === 'employee') {
            for (const r of rows) {
                if (req.user.role === 'manager') {
                    const ok = r.created_by === req.user.id
                        || assignedIdsOf(req.user).includes(Number(r.event_id));
                    if (!ok) throw new Error('Not allowed for this speaker');
                } else {
                    if (!employeeAllowed(req, r.event_id)) {
                        throw new Error('Not allowed for this speaker');
                    }
                }
            }
        }

        // Single UPDATE with CASE/WHEN — one round-trip regardless of N.
        const cases = updates.map(() => 'WHEN ? THEN ?').join(' ');
        const caseParams = updates.flatMap(u => [u.id, u.sequence]);
        await connection.query(
            `UPDATE speakers SET sequence = CASE id ${cases} END
             WHERE id IN (?) AND tenant_id = ?`,
            [...caseParams, ids, req.tenantId]
        );

        await connection.commit();
        res.json({ message: 'Speakers reordered' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// EXPORT speakers
router.get('/export', guard, async (req, res) => {
    try {
        let query = `SELECT s.*, e.title as event_title FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.tenant_id = ? AND s.deleted_at IS NULL`;
        let params = [req.tenantId];
        if (req.query.event_id) { query += ' AND s.event_id = ?'; params.push(req.query.event_id); }
        if (req.user.role === 'manager') { query += ` AND (e.created_by = ? OR s.event_id IN (?))`; params.push(req.user.id, assignedIdsForSql(req.user)); }
        else if (req.user.role === 'employee') { query += ` AND s.event_id IN (?)`; params.push(empSpeakerEventIds(req)); }

        const [rows] = await db.query(query, params);

        const csvHeader = 'Salutation,Name,Bio,Designation,Company,Location,Email,Office No,Role,Topic,Panel,Mobile No,Category,Spokesperson Name,LinkedIn URL,Event\n';
        const csvRows = rows.map(s =>
            `"${s.salutation || ''}","${s.name}","${(s.bio || '').replace(/"/g, '""')}","${s.designation || ''}","${s.company || ''}","${s.location || ''}","${s.email || ''}","${s.office_no || ''}","${s.role || ''}","${(s.topic || '').replace(/"/g, '""')}","${s.panel || ''}","${s.mobile_no || ''}","${s.category || ''}","${s.spokesperson_name || ''}","${s.linkedin_url || ''}","${s.event_title || ''}"`
        ).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=speakers.csv');
        res.send(csvHeader + csvRows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// IMPORT speakers
router.post('/import', guard, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const event_id = req.query.event_id || null;
    const speakers = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => {
            speakers.push({
                salutation: data.Salutation || data.salutation || null,
                name: data.Name || data.name || '',
                bio: data.Bio || data.bio || '',
                designation: data.Designation || data.designation || '',
                company: data.Company || data.company || '',
                location: data.Location || data.location || null,
                email: data.Email || data.email || '',
                office_no: data['Office No'] || data.office_no || null,
                role: data.Role || data.role || '',
                topic: data.Topic || data.topic || null,
                panel: data.Panel || data.panel || null,
                mobile_no: data['Mobile No'] || data.mobile_no || null,
                category: data.Category || data.category || null,
                spokesperson_name: data['Spokesperson Name'] || data.spokesperson_name || null,
                linkedin_url: data['LinkedIn URL'] || data.linkedin_url || null,
                event_id: event_id,
                created_by: req.user.id
            });
        })
        .on('end', async () => {
            try {
                if (speakers.length === 0) return res.status(400).json({ error: 'CSV is empty' });

                // Duplicate detection: check existing speakers by name+email in same event
                const [existing] = await db.query(
                    'SELECT LOWER(TRIM(name)) as name_key, LOWER(TRIM(email)) as email_key FROM speakers WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL',
                    [event_id, req.tenantId]
                );
                const existingSet = new Set(existing.map(e => `${e.name_key}||${e.email_key}`));

                const newSpeakers = speakers.filter(s => {
                    const key = `${(s.name || '').trim().toLowerCase()}||${(s.email || '').trim().toLowerCase()}`;
                    return !existingSet.has(key);
                });
                const skipped = speakers.length - newSpeakers.length;

                if (newSpeakers.length > 0) {
                    const query = 'INSERT INTO speakers (tenant_id, salutation, name, bio, designation, company, location, email, office_no, role, topic, panel, mobile_no, category, spokesperson_name, linkedin_url, event_id, created_by) VALUES ?';
                    const values = newSpeakers.map(s => [req.tenantId, s.salutation, s.name, s.bio, s.designation, s.company, s.location, s.email, s.office_no, s.role, s.topic, s.panel, s.mobile_no, s.category, s.spokesperson_name, s.linkedin_url, s.event_id, s.created_by]);
                    await db.query(query, [values]);
                }
                fs.unlinkSync(req.file.path);
                let message = `${newSpeakers.length} speakers imported successfully`;
                if (skipped > 0) message += ` (${skipped} duplicates skipped)`;
                res.json({ message, imported: newSpeakers.length, skipped });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
});

// IMPORT speakers from a Google Sheet URL. The sheet must be shared with
// "Anyone with the link can view" (or published to web) so the backend can fetch
// its CSV export without OAuth.
router.post('/import-gsheet', guard, async (req, res) => {
    const { url, event_id } = req.body;
    if (!url) return res.status(400).json({ error: 'Google Sheet URL is required' });

    // Derive the CSV export URL from various Google Sheets URL shapes.
    let csvUrl = null;
    const publishedMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)\/pub/);
    const normalMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[#&?]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    if (publishedMatch) {
        // Published-to-web URLs: use the pub endpoint with output=csv
        csvUrl = `https://docs.google.com/spreadsheets/d/e/${publishedMatch[1]}/pub?gid=${gid}&single=true&output=csv`;
    } else if (normalMatch) {
        // Regular "Anyone with the link can view" URL
        csvUrl = `https://docs.google.com/spreadsheets/d/${normalMatch[1]}/export?format=csv&gid=${gid}`;
    } else {
        return res.status(400).json({ error: 'Invalid Google Sheets URL. Expected a docs.google.com/spreadsheets/... link.' });
    }

    // Permission guard — same rules as speaker create (event + 'speakers' section)
    if (req.user.role === 'employee' && !employeeAllowed(req, event_id)) {
        return res.status(403).json({ error: 'You can only import speakers to events where you have the speakers module' });
    }
    if (req.user.role === 'manager' && event_id) {
        const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
        if (!evts.length) return res.status(404).json({ error: 'Event not found' });
        const ok = evts[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(event_id));
        if (!ok) return res.status(403).json({ error: 'Access denied for this event' });
    }

    // Follow redirects (Google issues a 307 → actual CSV). Node's https doesn't follow automatically.
    const fetchFollowingRedirects = (targetUrl, maxRedirects = 5) => new Promise((resolve, reject) => {
        const attempt = (current, remaining) => {
            https.get(current, (resp) => {
                if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location && remaining > 0) {
                    // Google redirects from docs.google.com to googleusercontent.com
                    const next = resp.headers.location.startsWith('http')
                        ? resp.headers.location
                        : new URL(resp.headers.location, current).toString();
                    resp.resume(); // discard body
                    return attempt(next, remaining - 1);
                }
                if (resp.statusCode !== 200) {
                    resp.resume();
                    return reject(new Error(`Google Sheets responded with status ${resp.statusCode}. Make sure the sheet is shared with "Anyone with the link can view".`));
                }
                const contentType = resp.headers['content-type'] || '';
                if (contentType.includes('text/html')) {
                    resp.resume();
                    return reject(new Error('Google returned an HTML page instead of CSV. The sheet is likely private — share it with "Anyone with the link can view".'));
                }
                resolve(resp);
            }).on('error', reject);
        };
        attempt(targetUrl, maxRedirects);
    });

    let stream;
    try {
        stream = await fetchFollowingRedirects(csvUrl);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const speakers = [];
    stream
        .pipe(csv())
        .on('data', (data) => {
            speakers.push({
                salutation: data.Salutation || data.salutation || null,
                name: data.Name || data.name || '',
                bio: data.Bio || data.bio || '',
                designation: data.Designation || data.designation || '',
                company: data.Company || data.company || '',
                location: data.Location || data.location || null,
                email: data.Email || data.email || '',
                office_no: data['Office No'] || data.office_no || null,
                role: data.Role || data.role || '',
                topic: data.Topic || data.topic || null,
                panel: data.Panel || data.panel || null,
                mobile_no: data['Mobile No'] || data.mobile_no || null,
                category: data.Category || data.category || null,
                spokesperson_name: data['Spokesperson Name'] || data.spokesperson_name || null,
                linkedin_url: data['LinkedIn URL'] || data.linkedin_url || null,
                // Accept several common header variants for the photo column
                _photo_url_raw: data['Photo URL'] || data['Photo Url'] || data.photo_url || data.Photo || data.photo || data['Image URL'] || data.image_url || null,
                event_id: event_id || null,
                created_by: req.user.id
            });
        })
        .on('end', async () => {
            try {
                // Drop empty rows (blank "Name" = skip)
                const valid = speakers.filter(s => s.name && s.name.trim());
                if (valid.length === 0) return res.status(400).json({ error: 'No speakers found in the sheet. Make sure the first row contains headers (Name, Designation, Company, Email, Role, …).' });

                // Download photos in parallel (bounded concurrency to be polite to Drive/remote hosts).
                // Failed downloads don't block the import — the speaker still gets inserted, just without a photo.
                const photoFailures = [];
                const importBatch = Date.now();
                const withPhotos = [...valid];

                const CONCURRENCY = 5;
                let cursor = 0;
                const worker = async () => {
                    while (cursor < withPhotos.length) {
                        const i = cursor++;
                        const row = withPhotos[i];
                        const normalized = normalizePhotoUrl(row._photo_url_raw);
                        if (!normalized) { row.photo_url = null; continue; }
                        try {
                            const { relPath } = await downloadImageToUploads(normalized, `speaker-gsheet-${importBatch}-${i}`);
                            // Normalize the downloaded image (BG removal + 400x400 PNG)
                            const filename = relPath.replace(/^\/?uploads\//, '');
                            const processed = await processSpeakerPhoto(path.join('uploads', filename));
                            row.photo_url = processed.relPath;
                        } catch (err) {
                            row.photo_url = null;
                            photoFailures.push({ name: row.name, url: row._photo_url_raw, reason: err.message });
                        }
                    }
                };
                await Promise.all(Array.from({ length: Math.min(CONCURRENCY, withPhotos.length) }, worker));

                // Duplicate detection: check existing speakers by name+email in same event
                const [existing] = await db.query(
                    'SELECT LOWER(TRIM(name)) as name_key, LOWER(TRIM(email)) as email_key FROM speakers WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL',
                    [event_id || null, req.tenantId]
                );
                const existingSet = new Set(existing.map(e => `${e.name_key}||${e.email_key}`));

                const newSpeakers = withPhotos.filter(s => {
                    const key = `${(s.name || '').trim().toLowerCase()}||${(s.email || '').trim().toLowerCase()}`;
                    return !existingSet.has(key);
                });
                const skipped = withPhotos.length - newSpeakers.length;

                if (newSpeakers.length > 0) {
                    const query = 'INSERT INTO speakers (tenant_id, salutation, name, bio, photo_url, designation, company, location, email, office_no, role, topic, panel, mobile_no, category, spokesperson_name, linkedin_url, event_id, created_by) VALUES ?';
                    const values = newSpeakers.map(s => [req.tenantId, s.salutation, s.name, s.bio, s.photo_url || null, s.designation, s.company, s.location, s.email, s.office_no, s.role, s.topic, s.panel, s.mobile_no, s.category, s.spokesperson_name, s.linkedin_url, s.event_id, s.created_by]);
                    await db.query(query, [values]);
                }

                const photoOk = newSpeakers.filter(s => s.photo_url).length;
                let message = `${newSpeakers.length} speakers imported from Google Sheet`;
                if (skipped > 0) message += ` (${skipped} duplicates skipped)`;
                if (photoOk > 0 || photoFailures.length > 0) {
                    message += ` (photos: ${photoOk} downloaded`;
                    if (photoFailures.length > 0) message += `, ${photoFailures.length} failed`;
                    message += ')';
                }
                res.json({
                    message,
                    count: withPhotos.length,
                    photos_downloaded: photoOk,
                    photos_failed: photoFailures.length,
                    failures: photoFailures.slice(0, 20) // cap the payload
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        })
        .on('error', (err) => {
            res.status(500).json({ error: err.message });
        });
});

// GET media library — all speaker photos and SNS cards
// MUST be before /:id to avoid route conflict
router.get('/media/library', guard, async (req, res) => {
    try {
        let query = `SELECT s.id, s.name, s.designation, s.company, s.photo_url, s.sns_card_url, s.event_id, e.title as event_title
                     FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id
                     WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND ((s.photo_url IS NOT NULL AND s.photo_url != '') OR (s.sns_card_url IS NOT NULL AND s.sns_card_url != ''))`;
        const params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ' AND (e.created_by = ? OR s.event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            query += ' AND s.event_id IN (?)';
            params.push(empSpeakerEventIds(req));
        }

        if (req.query.event_id) {
            query += ' AND s.event_id = ?';
            params.push(req.query.event_id);
        }

        query += ' ORDER BY s.id DESC';
        const [rows] = await db.query(query, params);

        const media = [];
        rows.forEach(r => {
            if (r.photo_url) {
                media.push({ id: `photo-${r.id}`, speaker_id: r.id, speaker_name: r.name, designation: r.designation, company: r.company, type: 'photo', url: r.photo_url, event_id: r.event_id, event_title: r.event_title });
            }
            if (r.sns_card_url) {
                media.push({ id: `sns-${r.id}`, speaker_id: r.id, speaker_name: r.name, designation: r.designation, company: r.company, type: 'sns_card', url: r.sns_card_url, event_id: r.event_id, event_title: r.event_title });
            }
        });

        res.json(media);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', guard, async (req, res) => {
    try {
        const [speakers] = await db.query(`
            SELECT s.*, e.title as event_title
            FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL
        `, [req.params.id, req.tenantId]);
        if (speakers.length === 0) return res.status(404).json({ error: 'Speaker not found' });
        res.json(speakers[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Quick create: minimal required fields, used by chat "Share Speaker"
router.post('/quick', guard, checkLimit('speakers'), upload.single('photo'), async (req, res) => {
    const { name, designation, company, event_id } = req.body;
    if (!name || !designation || !company || !event_id) {
        return res.status(400).json({ error: 'Name, designation, company and event are required' });
    }
    if (!req.file) return res.status(400).json({ error: 'Photo is required' });

    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id))))
                return res.status(403).json({ error: 'Not allowed for this event' });
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, event_id))
            return res.status(403).json({ error: 'Not allowed for this event' });

        const processed = await processSpeakerPhoto(path.join('uploads', req.file.filename), name);
        const photo_url = processed.relPath;

        const [result] = await db.query(
            'INSERT INTO speakers (tenant_id, name, photo_url, designation, company, event_id, created_by, role, spokesperson_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, name, photo_url, designation, company, event_id, req.user.id, 'Speaker', name]
        );
        const speaker = { id: result.insertId, name, photo_url, designation, company, event_id, role: 'Speaker' };

        const [evtRows] = await db.query('SELECT title FROM events WHERE id = ? AND tenant_id = ?', [event_id, req.tenantId]);
        const eventTitle = evtRows.length > 0 ? evtRows[0].title : 'an event';
        notifyAdminsAndManagers(
            'speaker_added',
            'New Speaker Added',
            `${name} was added to ${eventTitle} via chat`,
            '/speakers',
            req.user.id,
            { imageUrl: photo_url, actorName: req.user.name }
        ).catch(() => {});

        res.status(201).json(speaker);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', guard, checkLimit('speakers'), upload.single('photo'), async (req, res) => {
    const { name, salutation, bio, designation, company, location, email, office_no, role, event_id, topic, panel, mobile_no, category, spokesperson_name, linkedin_url } = req.body;

    if (!name || !spokesperson_name || !designation || !company || !event_id || !role) {
        return res.status(400).json({ error: 'Name, Spokesperson Name, Designation, Company, Event, and Role are mandatory' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'Photo is required' });
    }

    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id))))
                return res.status(403).json({ error: 'You can only add speakers to your own or assigned events' });
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, event_id))
            return res.status(403).json({ error: 'You can only add speakers to your assigned event' });

        const processed = await processSpeakerPhoto(path.join('uploads', req.file.filename), name);
        const photo_url = processed.relPath;

        const [result] = await db.query(
            'INSERT INTO speakers (tenant_id, name, salutation, bio, photo_url, designation, company, location, email, office_no, role, event_id, created_by, topic, panel, mobile_no, category, spokesperson_name, linkedin_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, name, salutation || null, bio, photo_url, designation, company, location || null, email || null, office_no || null, role, event_id || null, req.user.id, topic || null, panel || null, mobile_no || null, category || null, spokesperson_name || null, linkedin_url || null]
        );

        // Fire-and-forget notification
        const [evtRows] = await db.query('SELECT title FROM events WHERE id = ? AND tenant_id = ?', [event_id, req.tenantId]);
        const eventTitle = evtRows.length > 0 ? evtRows[0].title : 'an event';
        notifyAdminsAndManagers('speaker_added', 'New Speaker Added', `${name} was added to ${eventTitle}`, '/speakers', req.user.id, { imageUrl: photo_url, actorName: req.user.name }).catch(() => {});

        res.status(201).json({ message: 'Speaker added' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', guard, upload.single('photo'), async (req, res) => {
    const { name, salutation, bio, designation, company, location, email, office_no, role, event_id, sns_card_url, topic, panel, mobile_no, category, spokesperson_name, linkedin_url } = req.body;

    if (!name || !spokesperson_name || !designation || !company || !event_id || !role) {
        return res.status(400).json({ error: 'Name, Spokesperson Name, Designation, Company, Event, and Role are mandatory' });
    }

    let photo_url = req.body.photo_url;

    try {
        const [cur] = await db.query('SELECT s.event_id, s.photo_url AS old_photo_url, e.created_by FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL', [req.params.id, req.tenantId]);
        if (cur.length === 0) return res.status(404).json({ error: 'Speaker not found' });

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to edit this speaker' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only edit speakers in your assigned event' });

        if (req.file) {
            const processed = await processSpeakerPhoto(path.join('uploads', req.file.filename), name);
            photo_url = processed.relPath;
        }

        const [updResult] = await db.query('UPDATE speakers SET name=?, salutation=?, bio=?, photo_url=?, designation=?, company=?, location=?, email=?, office_no=?, role=?, event_id=?, sns_card_url=?, topic=?, panel=?, mobile_no=?, category=?, spokesperson_name=?, linkedin_url=? WHERE id=? AND tenant_id=?',
            [name, salutation || null, bio, photo_url, designation, company, location || null, email || null, office_no || null, role, event_id || null, sns_card_url || null, topic || null, panel || null, mobile_no || null, category || null, spokesperson_name || null, linkedin_url || null, req.params.id, req.tenantId]);
        if (updResult.affectedRows === 0) return res.status(404).json({ error: 'Speaker not found' });

        // Clean up the previous file only if the photo actually changed
        if (req.file && cur.length > 0 && cur[0].old_photo_url && cur[0].old_photo_url !== photo_url) {
            deleteUpload(cur[0].old_photo_url);
        }
        res.json({ message: 'Speaker updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle (or set) whether a speaker appears in the public JSON feed at
// /api/public/speakers. Admin keeps the row in the database — it just
// stops being served externally. Body: { hidden: true|false } or empty
// to toggle the current value.
router.put('/:id/visibility', guard, async (req, res) => {
    try {
        const [cur] = await db.query(
            `SELECT s.is_hidden, s.event_id, e.created_by
             FROM speakers s
             LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id
             WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL`,
            [req.params.id, req.tenantId]
        );
        if (cur.length === 0) return res.status(404).json({ error: 'Speaker not found' });

        // Same scope check as update: managers limited to their own events
        // or their assigned event; employees limited to their assigned event.
        if (req.user.role === 'manager') {
            const ok = cur[0].created_by === req.user.id
                || assignedIdsOf(req.user).includes(Number(cur[0].event_id));
            if (!ok) return res.status(403).json({ error: 'You do not have permission to modify this speaker' });
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, cur[0].event_id)) {
            return res.status(403).json({ error: 'You can only modify speakers in your assigned event' });
        }

        const next = typeof req.body.hidden === 'boolean'
            ? (req.body.hidden ? 1 : 0)
            : (cur[0].is_hidden ? 0 : 1);

        await db.query('UPDATE speakers SET is_hidden = ? WHERE id = ? AND tenant_id = ?',
            [next, req.params.id, req.tenantId]);
        res.json({ id: Number(req.params.id), is_hidden: next });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/save-sns', guard, upload.single('sns_card'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const { design_metadata } = req.body;
    try {
        const url = fileUrl(req.file);
        const [result] = await db.query('UPDATE speakers SET sns_card_url=?, sns_card_design=? WHERE id=? AND tenant_id=?', [url, design_metadata || null, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Speaker not found' });
        res.json({ message: 'SNS Card saved successfully', url });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete only the SNS card (keeps the speaker intact)
router.delete('/:id/sns-card', guard, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT s.sns_card_url, s.event_id, e.created_by FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL',
            [req.params.id, req.tenantId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Speaker not found' });

        const isManagerAllowed = req.user.role === 'manager' &&
            (rows[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(rows[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to modify this speaker' });
        if (req.user.role === 'employee' && !employeeAllowed(req, rows[0].event_id))
            return res.status(403).json({ error: 'You can only modify speakers in your assigned event' });

        // Best-effort removal of the physical file
        const url = rows[0].sns_card_url;
        if (url && url.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, '..', url);
            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') console.warn('SNS card file unlink failed:', err.message);
            });
        }

        const [result] = await db.query('UPDATE speakers SET sns_card_url=NULL, sns_card_design=NULL WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Speaker not found' });
        res.json({ message: 'SNS Card deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT s.event_id, e.created_by FROM speakers s LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL', [req.params.id, req.tenantId]);

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to delete this speaker' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only delete speakers in your assigned event' });

        const [spk] = await db.query('SELECT name, photo_url FROM speakers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        // Soft delete: stamp deleted_at + deleted_by so the row lives on in the
        // Recycle Bin until the 30-day purge or an admin/manager restores it.
        const [result] = await db.query('UPDATE speakers SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.user.id, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Speaker not found' });
        if (spk.length > 0) {
            notifyAdminsAndManagers('speaker_deleted', 'Speaker Removed', `${spk[0].name} was removed`, '/speakers', req.user.id, { imageUrl: spk[0].photo_url, actorName: req.user.name }).catch(() => {});
        }
        res.json({ message: 'Speaker deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/delete-bulk', guard, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Invalid IDs provided' });
    
    try {
        // Auth check for each speaker (simplified for bulk)
        // In a real app, we might want to check permissions for all speakers first.
        // For now, if user is admin, allow all. If manager/employee, we'd need more complex filtering.
        // Let's implement a safe bulk delete for allowed speakers only.
        
        // Soft delete in bulk — same role-scoped WHERE as the original DELETE,
        // just SET deleted_at instead of dropping the row.
        let query = 'UPDATE speakers SET deleted_at = NOW(), deleted_by = ? WHERE id IN (?) AND tenant_id = ? AND deleted_at IS NULL';
        let params = [req.user.id, ids, req.tenantId];

        if (req.user.role === 'manager') {
            query = 'UPDATE speakers SET deleted_at = NOW(), deleted_by = ? WHERE id IN (?) AND tenant_id = ? AND deleted_at IS NULL AND (created_by = ? OR event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            query = 'UPDATE speakers SET deleted_at = NOW(), deleted_by = ? WHERE id IN (?) AND tenant_id = ? AND deleted_at IS NULL AND event_id IN (?)';
            params.push(empSpeakerEventIds(req));
        }

        const [result] = await db.query(query, params);
        res.json({ message: `${result.affectedRows} speakers deleted` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
