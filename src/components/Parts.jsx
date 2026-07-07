import { useState, useCallback, useMemo } from 'react'

function conditionColor(c) {
  if (c >= 0.8) return { bar: 'bar-green',  pct: 'pct-green'  }
  if (c >= 0.5) return { bar: 'bar-yellow', pct: 'pct-yellow' }
  return             { bar: 'bar-red',    pct: 'pct-red'    }
}

const FILTERS = [
  { label: 'All',             key: 'all' },
  { label: 'Worn  <100%',     key: 'worn' },
  { label: 'Critical  <50%',  key: 'critical' },
]

export default function Parts({ parts, onPartsChange }) {
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')

  const visibleParts = useMemo(() => {
    return parts
      .map((p, globalIdx) => ({ ...p, globalIdx }))
      .filter(p => {
        if (!p.has_condition) return false
        if (filter === 'worn'     && p.condition >= 1.0)  return false
        if (filter === 'critical' && p.condition >= 0.5)  return false
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
  }, [parts, filter, search])

  const handleRepair = useCallback((globalIdx) => {
    onPartsChange(prev => prev.map((p, i) =>
      i === globalIdx ? { ...p, condition: 1.0 } : p
    ))
  }, [onPartsChange])

  const handleRepairAll = useCallback(() => {
    onPartsChange(prev => prev.map(p =>
      p.has_condition && p.condition < 1.0 ? { ...p, condition: 1.0 } : p
    ))
  }, [onPartsChange])

  const totalWithCondition = parts.filter(p => p.has_condition).length

  return (
    <div>
      <div className="parts-toolbar">
        <input
          type="text"
          className="parts-search"
          placeholder="Search parts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="garage-filters">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`filter-btn${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button className="btn btn-sm btn-success" onClick={handleRepairAll}>
          🔧 Repair All
        </button>

        <span className="parts-count">
          {visibleParts.length} shown / {totalWithCondition} total
        </span>
      </div>

      {parts.length === 0 ? (
        <div className="parts-empty" style={{ padding: '40px 24px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📦</div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
            No loose inventory parts in this save
          </div>
          <div style={{ maxWidth: '480px', margin: '0 auto', lineHeight: '1.7' }}>
            This tab only shows parts that are sitting loose in your garage
            storage. Parts already installed on a car are edited from the{' '}
            <strong style={{ color: 'var(--text)' }}>Cars</strong> tab —
            select a car there to repair its parts.
          </div>
        </div>
      ) : visibleParts.length === 0 ? (
        <div className="parts-empty">
          No parts match the current filter
          {search ? ` and search "${search}"` : ''}.
        </div>
      ) : (
        <div className="parts-list">
          <div className="parts-list-header">
            <span style={{ textAlign: 'right' }}>#</span>
            <span>Part Name</span>
            <span>Condition</span>
            <span></span>
            <span></span>
          </div>

          {visibleParts.map((p, displayIdx) => {
            const cond    = p.condition ?? 0
            const pct     = Math.round(cond * 100)
            const colors  = conditionColor(cond)
            const changed = p.has_condition && cond !== p._orig
            const atMax   = cond >= 1.0

            return (
              <div
                key={p.globalIdx}
                className={`part-row${changed ? ' changed' : ''}`}
              >
                <span className="part-idx">{displayIdx + 1}</span>

                <span className="part-name" title={p.name}>{p.name}</span>

                <div className="part-bar-wrap">
                  <div className="part-bar">
                    <div
                      className={`part-bar-fill ${colors.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <span className={`part-pct ${colors.pct}`}>{pct}%</span>

                <button
                  className="btn btn-sm btn-success"
                  style={{ padding: '2px 6px', fontSize: '13px' }}
                  onClick={() => handleRepair(p.globalIdx)}
                  disabled={atMax}
                  title={atMax ? 'Already at 100%' : 'Repair to 100%'}
                >
                  🔧
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
