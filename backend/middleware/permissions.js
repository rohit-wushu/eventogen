// Per-employee section access. Admin/manager always pass; super admin passes
// (they don't hit tenant routes anyway, but defensive). Employees pass when
// their permissions column is NULL (default = full access) or when the
// requested section is listed in their JSON array. Anything else → 403.
//
// Apply on each entity route file like:
//
//   const speakersGuard = [protect, requireSection('speakers')];
//   router.get('/', speakersGuard, handler);

// Section keys must match the values stored in users.permissions. The
// frontend renders these labels too; keep both in sync.
const SECTIONS = ['speakers', 'partners', 'awards', 'agendas', 'attendees', 'travel', 'media', 'forms'];

function parsePermissions(raw) {
    if (raw == null) return null;            // NULL = no restriction
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; }
        catch { return null; }
    }
    return null;
}

function hasSection(user, section) {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (user.role === 'admin' || user.role === 'manager') return true;
    const perms = parsePermissions(user.permissions);
    if (perms === null) return true;          // unset = default full access
    return perms.includes(section);
}

function requireSection(section) {
    if (!SECTIONS.includes(section)) {
        throw new Error(`requireSection: unknown section "${section}"`);
    }
    return (req, res, next) => {
        if (hasSection(req.user, section)) return next();
        return res.status(403).json({
            error: 'section_forbidden',
            section,
            message: `You don't have access to ${section}. Ask your admin or manager to enable it.`,
        });
    };
}

module.exports = { SECTIONS, hasSection, parsePermissions, requireSection };
