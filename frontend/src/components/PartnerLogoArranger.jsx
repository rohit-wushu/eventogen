import { useState, useRef, useEffect, useMemo } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import { BsGripVertical, BsPlusLg, BsTrash } from 'react-icons/bs';

// Multi-row drag-and-drop logo arranger. Each row is its own horizontal
// drop lane; tiles can move within or across rows. The data shape we
// produce/consume is `rows: number[][]` — partner ids grouped into rows.
// An "Unassigned" pool below collects any partner not present in any row
// (e.g. just-added partners) so operators can drag them into the layout.
//
// Props:
//   partners — { id, name, logo_url, category_name }[] for the active event
//   rows     — number[][] current row layout (may be empty/undefined)
//   onChange — (rows: number[][]) => void; called after every successful drop
export default function PartnerLogoArranger({ partners, rows, onChange }) {
    // Local rows are the source of truth during drag operations. We mirror
    // the prop on mount and whenever the *set of partner ids* changes,
    // but not on every parent render — otherwise an optimistic post-drop
    // update would get clobbered by the parent's stale `rows` prop.
    const initial = useMemo(() => normalizeRows(rows, partners), []);
    const [localRows, setLocalRows] = useState(initial);
    const [dragId, setDragId] = useState(null);
    const [overTile, setOverTile] = useState(null); // { rowIdx, position } where position = 'before' | 'after'
    const [overRow, setOverRow] = useState(null);   // rowIdx when hovering empty area / row chrome
    const partnerIdsKeyRef = useRef(partners.map(p => p.id).sort((a,b)=>a-b).join(','));

    // Resync only when the underlying set of partner ids changes (added /
    // removed elsewhere). Reordering by the user must NOT trigger a
    // resync — the local state already reflects the freshest layout.
    useEffect(() => {
        const incomingKey = partners.map(p => p.id).sort((a,b)=>a-b).join(',');
        if (incomingKey === partnerIdsKeyRef.current) return;
        partnerIdsKeyRef.current = incomingKey;
        setLocalRows(prev => normalizeRows(prev, partners));
    }, [partners]);

    // Also mirror the prop when the parent supplies a fundamentally
    // different `rows` (e.g. a fresh fetch after a save). Compare by
    // shape to avoid re-running on identity-different but semantically
    // equal rows.
    const rowsKey = JSON.stringify(rows || []);
    const lastSeenRowsRef = useRef(rowsKey);
    useEffect(() => {
        if (lastSeenRowsRef.current === rowsKey) return;
        lastSeenRowsRef.current = rowsKey;
        setLocalRows(normalizeRows(rows, partners));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rowsKey]);

    const byId = useMemo(() => Object.fromEntries(partners.map(p => [p.id, p])), [partners]);
    const assignedIds = new Set(localRows.flat());
    const unassigned = partners.filter(p => !assignedIds.has(p.id));

    const commit = (next) => {
        setLocalRows(next);
        // Filter empty rows out of the persisted shape — empty rows are
        // a UI concept; the public renderer doesn't need them.
        const persisted = next.filter(r => r.length > 0);
        onChange?.(persisted);
    };

    const removeIdFromRows = (rowsArr, id) => rowsArr.map(r => r.filter(x => x !== id));

    const insertIntoRow = (rowsArr, rowIdx, id, atIndex) => rowsArr.map((r, i) => {
        if (i !== rowIdx) return r;
        const next = [...r];
        const safeIdx = Math.max(0, Math.min(next.length, atIndex));
        next.splice(safeIdx, 0, id);
        return next;
    });

    const onDragStart = (e, id) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(id));
    };
    const onDragEnd = () => { setDragId(null); setOverTile(null); setOverRow(null); };

    const onTileDragOver = (e, rowIdx, tileIdx) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;
        setOverTile({ rowIdx, tileIdx, position: before ? 'before' : 'after' });
        setOverRow(null);
    };
    const onTileDrop = (e, rowIdx, tileIdx) => {
        e.preventDefault();
        e.stopPropagation();
        const fromId = dragId ?? Number(e.dataTransfer.getData('text/plain'));
        onDragEnd();
        if (!fromId) return;
        const position = overTile?.position === 'after' ? 1 : 0;
        let next = removeIdFromRows(localRows, fromId);
        // Recompute target index after removal — tile indexes may shift
        // when the dragged item came from earlier in the same row.
        const sourceRow = localRows.findIndex(r => r.includes(fromId));
        let targetIdx = tileIdx;
        if (sourceRow === rowIdx) {
            const sourceIdx = localRows[rowIdx].indexOf(fromId);
            if (sourceIdx < tileIdx) targetIdx -= 1;
        }
        next = insertIntoRow(next, rowIdx, fromId, targetIdx + position);
        commit(next);
    };

    const onRowDragOver = (e, rowIdx) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOverRow(rowIdx);
        setOverTile(null);
    };
    const onRowDrop = (e, rowIdx) => {
        e.preventDefault();
        const fromId = dragId ?? Number(e.dataTransfer.getData('text/plain'));
        onDragEnd();
        if (!fromId) return;
        let next = removeIdFromRows(localRows, fromId);
        next = insertIntoRow(next, rowIdx, fromId, next[rowIdx].length);
        commit(next);
    };

    const onUnassignedDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOverRow(-1);
    };
    const onUnassignedDrop = (e) => {
        e.preventDefault();
        const fromId = dragId ?? Number(e.dataTransfer.getData('text/plain'));
        onDragEnd();
        if (!fromId) return;
        commit(removeIdFromRows(localRows, fromId));
    };

    const addRow = () => commit([...localRows, []]);
    const removeRow = (rowIdx) => {
        // Drop the row chrome but keep its tiles — they fall into the
        // unassigned pool so operators don't lose their selection.
        commit(localRows.filter((_, i) => i !== rowIdx));
    };

    if (partners.length === 0) {
        return (
            <div className="pla-empty">Add partners to this event first — they'll show up here for arranging.</div>
        );
    }

    return (
        <div className="pla">
            {localRows.map((rowIds, rowIdx) => (
                <div
                    key={rowIdx}
                    className={`pla-row ${overRow === rowIdx ? 'over' : ''}`}
                    onDragOver={e => onRowDragOver(e, rowIdx)}
                    onDrop={e => onRowDrop(e, rowIdx)}
                >
                    <div className="pla-row-head">
                        <span className="pla-row-label">Row {rowIdx + 1}</span>
                        <button
                            type="button"
                            className="pla-row-remove"
                            onClick={() => removeRow(rowIdx)}
                            title="Delete this row (its logos move to Unassigned)"
                        ><BsTrash size={11} /></button>
                    </div>
                    <div className="pla-row-tiles">
                        {rowIds.length === 0 ? (
                            <span className="pla-row-empty">Drop logos here</span>
                        ) : (
                            rowIds
                                .map(id => byId[id])
                                .filter(Boolean)
                                .map((p, tileIdx) => (
                                    <Tile
                                        key={p.id}
                                        p={p}
                                        rowIdx={rowIdx}
                                        tileIdx={tileIdx}
                                        kind="row"
                                        dragId={dragId}
                                        overTile={overTile}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        onTileDragOver={onTileDragOver}
                                        onTileDrop={onTileDrop}
                                    />
                                ))
                        )}
                    </div>
                </div>
            ))}

            <button type="button" className="pla-add-row" onClick={addRow}>
                <BsPlusLg /> Add row
            </button>

            {unassigned.length > 0 && (
                <div
                    className={`pla-pool ${overRow === -1 ? 'over' : ''}`}
                    onDragOver={onUnassignedDragOver}
                    onDrop={onUnassignedDrop}
                >
                    <div className="pla-pool-head">Unassigned · drag into a row above</div>
                    <div className="pla-pool-tiles">
                        {unassigned.map(p => (
                            <Tile
                                key={p.id}
                                p={p}
                                kind="pool"
                                dragId={dragId}
                                overTile={overTile}
                                onDragStart={onDragStart}
                                onDragEnd={onDragEnd}
                                onTileDragOver={onTileDragOver}
                                onTileDrop={onTileDrop}
                            />
                        ))}
                    </div>
                </div>
            )}

            <style>{`
                .pla { display: flex; flex-direction: column; gap: 10px; }
                .pla-empty {
                    padding: 18px 14px; text-align: center;
                    font-size: 12px; color: var(--text-muted);
                    background: rgba(255,255,255,0.02);
                    border: 1px dashed var(--border-subtle);
                    border-radius: 10px;
                }
                .pla-row {
                    background: rgba(255,255,255,0.03);
                    border: 1px solid var(--border-subtle);
                    border-radius: 10px;
                    padding: 8px 10px;
                    transition: border-color 0.12s, background 0.12s;
                }
                .pla-row.over {
                    border-color: var(--accent);
                    background: rgba(139,92,246,0.08);
                }
                .pla-row-head {
                    display: flex; align-items: center; justify-content: space-between;
                    margin-bottom: 8px;
                }
                .pla-row-label {
                    font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em;
                    font-weight: 700; color: var(--text-muted);
                }
                .pla-row-remove {
                    background: transparent; border: none; cursor: pointer;
                    color: var(--text-muted); padding: 2px 6px; border-radius: 6px;
                }
                .pla-row-remove:hover { color: #f87171; background: rgba(239,68,68,0.08); }
                .pla-row-tiles {
                    display: flex; flex-wrap: wrap; gap: 6px; min-height: 50px;
                    align-items: center;
                }
                .pla-row-empty {
                    font-size: 11px; color: var(--text-muted);
                    opacity: 0.65; padding: 8px 4px;
                }
                .pla-add-row {
                    align-self: flex-start;
                    background: transparent;
                    border: 1px dashed var(--border-subtle);
                    color: var(--text-muted);
                    border-radius: 8px;
                    padding: 6px 12px;
                    font-size: 0.78rem; font-weight: 600;
                    cursor: pointer;
                    display: inline-flex; align-items: center; gap: 6px;
                }
                .pla-add-row:hover {
                    border-color: var(--accent);
                    color: var(--text-primary);
                    background: rgba(139,92,246,0.08);
                }
                .pla-pool {
                    background: rgba(0,0,0,0.18);
                    border: 1px dashed var(--border-subtle);
                    border-radius: 10px;
                    padding: 8px 10px;
                }
                .pla-pool.over {
                    border-color: var(--accent);
                    background: rgba(139,92,246,0.10);
                }
                .pla-pool-head {
                    font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em;
                    font-weight: 700; color: var(--text-muted);
                    margin-bottom: 6px;
                }
                .pla-pool-tiles {
                    display: flex; flex-wrap: wrap; gap: 6px;
                }

                .pla-tile {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 10px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    cursor: grab;
                    user-select: none;
                    transition: transform 0.1s, border-color 0.12s, background 0.12s;
                    position: relative;
                }
                .pla-tile:hover { border-color: var(--accent); }
                .pla-tile:active { cursor: grabbing; }
                .pla-tile.dragging { opacity: 0.4; }
                .pla-tile.pool {
                    background: rgba(255,255,255,0.06);
                }
                /* Insertion indicator while dragging — a 2px accent bar
                   on the leading or trailing edge of the hovered tile. */
                .pla-tile.over-before::before,
                .pla-tile.over-after::after {
                    content: '';
                    position: absolute; top: -2px; bottom: -2px;
                    width: 2px;
                    background: var(--accent);
                    border-radius: 1px;
                }
                .pla-tile.over-before::before { left: -4px; }
                .pla-tile.over-after::after  { right: -4px; }

                .pla-handle { color: var(--text-muted); flex-shrink: 0; font-size: 12px; }
                .pla-logo {
                    flex-shrink: 0;
                    width: 32px; height: 32px;
                    border-radius: 6px;
                    background: #fff;
                    display: grid; place-items: center;
                    overflow: hidden;
                }
                .pla-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
                .pla-fallback { color: #64748b; font-weight: 700; font-size: 13px; }
                .pla-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; max-width: 140px; }
                .pla-name {
                    font-size: 0.74rem; font-weight: 600; color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .pla-cat {
                    font-size: 0.62rem; color: var(--text-muted);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
            `}</style>
        </div>
    );
}

// A single draggable logo tile. Hoisted to module scope (not nested in
// PartnerLogoArranger) so its component identity is stable across renders —
// otherwise every setState during a drag would remount the tiles and cancel
// the in-flight HTML5 drag operation, breaking same-row reordering.
function Tile({ p, rowIdx, tileIdx, kind, dragId, overTile, onDragStart, onDragEnd, onTileDragOver, onTileDrop }) {
    return (
        <div
            className={[
                'pla-tile',
                dragId === p.id ? 'dragging' : '',
                kind === 'pool' ? 'pool' : '',
                overTile && overTile.rowIdx === rowIdx && overTile.tileIdx === tileIdx
                    ? `over-${overTile.position}` : '',
            ].join(' ')}
            draggable
            onDragStart={e => onDragStart(e, p.id)}
            onDragEnd={onDragEnd}
            onDragOver={e => kind === 'row' ? onTileDragOver(e, rowIdx, tileIdx) : undefined}
            onDrop={e => kind === 'row' ? onTileDrop(e, rowIdx, tileIdx) : undefined}
            title={p.name}
        >
            <span className="pla-handle"><BsGripVertical /></span>
            <span className="pla-logo">
                {p.logo_url
                    ? <img src={getImageUrl(p.logo_url)} alt={p.name} />
                    : <span className="pla-fallback">{p.name?.[0] || '?'}</span>}
            </span>
            <span className="pla-meta">
                <span className="pla-name">{p.name}</span>
                {p.category_name && <span className="pla-cat">{p.category_name}</span>}
            </span>
        </div>
    );
}

// Build a working `rows` shape from whatever was passed in:
//   - drop ids that no longer correspond to a known partner
//   - guarantee at least one row (so operators always have a drop target)
function normalizeRows(rawRows, partners) {
    const valid = new Set(partners.map(p => p.id));
    let rows = (Array.isArray(rawRows) ? rawRows : [])
        .map(r => Array.isArray(r) ? r.map(Number).filter(id => valid.has(id)) : [])
        .filter(r => Array.isArray(r));
    if (rows.length === 0) rows = [[]];
    return rows;
}
