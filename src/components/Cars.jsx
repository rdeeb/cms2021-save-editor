import { useState, useCallback } from 'react'

function CarPartRow({ part, onPartChange }) {
  const { name, condition, _origCond } = part
  const changed = Math.abs(condition - _origCond) > 0.001
  const pct = Math.round(condition * 100)

  const handleSliderChange = (e) => {
    const val = parseFloat(e.target.value)
    onPartChange({ ...part, condition: val })
  }

  const handleFix = () => {
    onPartChange({ ...part, condition: 1.0 })
  }

  return (
    <div className={`car-part-item ${changed ? 'changed' : ''}`}>
      <div className="car-part-info">
        <span className="car-part-name">{name}</span>
        <span className={`car-part-pct ${pct < 15 ? 'critical' : pct < 50 ? 'worn' : ''}`}>
          {pct}%
        </span>
      </div>
      <div className="car-part-controls">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          className="condition-slider"
          value={condition}
          onChange={handleSliderChange}
        />
        <button className="btn btn-xs btn-outline" onClick={handleFix} disabled={condition >= 1}>
          Fix
        </button>
      </div>
    </div>
  )
}

function CarCard({ car, onCarChange }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { name, parts, rawName } = car
  
  const changedCount = parts.filter(p => Math.abs(p.condition - p._origCond) > 0.001).length

  const handlePartChange = (idx, updatedPart) => {
    const newParts = [...parts]
    newParts[idx] = updatedPart
    onCarChange({ ...car, parts: newParts })
  }

  const handleFixAll = () => {
    const newParts = parts.map(p => ({ ...p, condition: 1.0 }))
    onCarChange({ ...car, parts: newParts })
  }

  return (
    <div className={`car-card ${changedCount > 0 ? 'changed' : ''}`}>
      <div className="car-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="car-title-wrap">
          <span className="car-name">{name}</span>
          <span className="car-meta">Internal ID: {rawName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {changedCount > 0 && <span className="dirty-badge" style={{ fontSize: '10px' }}>{changedCount} edits</span>}
          <span className="car-badge">{parts.length} components</span>
          <span style={{ fontSize: '18px', opacity: 0.5 }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </div>
      
      {isExpanded && (
        <div className="car-expanded">
          <div className="car-actions">
            <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); handleFixAll(); }}>
              Repair All Components (100%)
            </button>
          </div>
          <div className="car-parts-grid">
            {parts.map((p, i) => (
              <CarPartRow
                key={i}
                part={p}
                onPartChange={(updated) => handlePartChange(i, updated)}
              />
            ))}
            {parts.length === 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic', padding: '12px 0' }}>
                No sub-components detected for this vehicle.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Cars({ cars, onCarsChange }) {
  const handleCarChange = useCallback((updatedCar) => {
    onCarsChange(prev => prev.map(c => c.rawName === updatedCar.rawName ? updatedCar : c))
  }, [onCarsChange])

  if (!cars || cars.length === 0) {
    return (
      <div className="parts-empty" style={{ padding: '40px 24px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏎️</div>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
          No vehicles detected
        </div>
        <div style={{ maxWidth: '400px', margin: '0 auto', lineHeight: '1.7' }}>
          We couldn't find any vehicle records in the tail of this save file.
          This may happen with very early-game saves.
        </div>
      </div>
    )
  }

  return (
    <div className="cars-container">
      <div style={{ marginBottom: '16px', color: 'var(--text-dim)', fontSize: '14px' }}>
        Found {cars.length} vehicles/major assemblies. You can now repair individual components.
      </div>
      
      {cars.map((car, i) => (
        <CarCard key={car.rawName} car={car} onCarChange={handleCarChange} />
      ))}
    </div>
  )
}
