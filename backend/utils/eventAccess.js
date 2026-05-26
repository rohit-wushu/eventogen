// Centralized event-access check used by every section route (speakers,
// partners, attendees, agendas, awards, travel, …) so multi-event
// assignment logic lives in exactly one place.
//
// Access rules:
//   • admin / manager → handled by each route's own ownership logic; this
//     helper returns true for them so it never narrows their access.
//   • employee → allowed only for events in their assignment set, AND
//     (for section-aware checks) only for sections enabled on that event.
//
// `req.user.assignedEventIds` and `req.user.eventSections` are populated by
// authMiddleware. `eventSections[eventId]` is `null` for "full access on
// this event" or an array of section keys to restrict to.
//
// We also fall back to the legacy single `assigned_event_id` so the check is
// correct even if the array wasn't loaded for some reason (fail safe to the
// old behavior, never broader).

const assignedIdsOf = (user) => {
    if (!user) return [];
    if (Array.isArray(user.assignedEventIds) && user.assignedEventIds.length) {
        return user.assignedEventIds.map(Number);
    }
    if (user.assigned_event_id != null) return [Number(user.assigned_event_id)];
    return [];
};

// True when the user may act within `eventId`. Admins and managers always
// pass here (their finer-grained ownership checks run separately in each
// route). Employees pass only for assigned events.
const hasEventAccess = (user, eventId) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (eventId == null) return false;
    return assignedIdsOf(user).includes(Number(eventId));
};

// Employee-scoped variant matching the old per-file `employeeAllowed`
// helper: non-employees always pass; employees must have the event.
const employeeAllowed = (user, eventId) => {
    if (!user || user.role !== 'employee') return true;
    if (eventId == null) return false;
    return assignedIdsOf(user).includes(Number(eventId));
};

// True when the user may use `section` (e.g. 'speakers') within `eventId`.
// Layered check:
//   1. Admins / managers always pass.
//   2. Employee must be assigned to the event.
//   3. Employee's per-event section list (if set) must include the section;
//      `null` means "full access on that event" so it passes any section.
// Tenant-wide users.permissions is enforced separately by requireSection
// middleware — this helper handles the per-event grain.
const hasSectionForEvent = (user, eventId, section) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (eventId == null) return false;
    const eid = Number(eventId);
    if (!assignedIdsOf(user).includes(eid)) return false;
    const sections = user.eventSections || {};
    const list = sections[eid];
    if (list === undefined || list === null) return true; // null = full
    return Array.isArray(list) && list.includes(section);
};

// Same as assignedIdsOf but never empty — for use in SQL `IN (?)` clauses,
// where an empty array would produce invalid `IN ()`. Returns [0] (matches
// no real event) when the user has no assignments.
const assignedIdsForSql = (user) => {
    const ids = assignedIdsOf(user);
    return ids.length ? ids : [0];
};

// Subset of assignedIdsOf restricted to events where the user has `section`
// enabled. Use this in list queries like:
//   WHERE event_id IN (?)   →   eventIdsForSection(user, 'speakers')
// so the list automatically hides events where the employee can't see that
// section. Admins/managers return all their assigned IDs (full access).
// Never returns an empty array — falls back to [0] so the SQL stays valid.
const eventIdsForSection = (user, section) => {
    const ids = assignedIdsOf(user);
    if (!user || user.role === 'admin' || user.role === 'manager') {
        return ids.length ? ids : [0];
    }
    const sections = user.eventSections || {};
    const allowed = ids.filter(eid => {
        const list = sections[eid];
        if (list === undefined || list === null) return true; // null = full
        return Array.isArray(list) && list.includes(section);
    });
    return allowed.length ? allowed : [0];
};

module.exports = {
    hasEventAccess, employeeAllowed, hasSectionForEvent,
    assignedIdsOf, assignedIdsForSql, eventIdsForSection,
};
