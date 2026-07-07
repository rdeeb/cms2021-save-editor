import { useState, useCallback } from 'react'

const TIERS = {
  paintshop:            3,
  garage_upgrade:       3,
  lifter:               3,
  repair_parts:         3,
  repair_body:          3,
  scraps:               1,
  dyno:                 1,
  warehouse:            1,
  path_test:            1,
  car_wash:             1,
  unlock_tablet:        1,
  unlock_obd:           1,
  unlock_fuel:          1,
  unlock_electronic:    1,
  garage_customization: 1,
  unlock_cylinder:      1,
  unlock_tires:         1,
  brake_lathe:          1,
  welder:               1,
  battery:              1,
  crane:                1,
  bus_upgrade:          1,
  windowtint:           1,
}

const DISPLAY = {
  paintshop:            'Paint Shop',
  scraps:               'Scrap Parts Bin',
  dyno:                 'Dynamometer',
  warehouse:            'Parts Warehouse',
  path_test:            'Test Track',
  car_wash:             'Car Wash',
  unlock_tablet:        'Diagnostic Tablet',
  unlock_obd:           'OBD Scanner',
  unlock_fuel:          'Fuel System Kit',
  unlock_electronic:    'Electronics Bench',
  garage_upgrade:       'Garage Upgrade',
  garage_customization: 'Garage Customization',
  lifter:               'Car Lifter',
  unlock_cylinder:      'Cylinder Head Kit',
  unlock_tires:         'Tire Equipment',
  brake_lathe:          'Brake Lathe',
  repair_parts:         'Parts Repair Bench',
  welder:               'Welding Station',
  battery:              'Battery Charger',
  crane:                'Engine Crane',
  repair_body:          'Body Repair Set',
  bus_upgrade:          'Bus Bay Upgrade',
  windowtint:           'Window Tinting',
}

const ICONS = {
  paintshop:            '🎨',
  scraps:               '🔩',
  dyno:                 '📊',
  warehouse:            '🏭',
  path_test:            '🛣️',
  car_wash:             '🧼',
  unlock_tablet:        '📱',
  unlock_obd:           '🔌',
  unlock_fuel:          '⛽',
  unlock_electronic:    '⚡',
  garage_upgrade:       '🔧',
  garage_customization: '✨',
  lifter:               '⬆️',
  unlock_cylinder:      '🔴',
  unlock_tires:         '🛞',
  brake_lathe:          '⚙️',
  repair_parts:         '🛠️',
  welder:               '🔥',
  battery:              '🔋',
  crane:                '🏗️',
  repair_body:          '🚗',
  bus_upgrade:          '🚌',
  windowtint:           '🪟',
}

function UpgradeCard({ item, onStateChange }) {
  const { name, state, _orig } = item
  const maxTier = TIERS[name] || 1
  
  const changed = state !== _orig
  const purchased = state > 0

  const togglePurchased = () => {
    onStateChange(purchased ? 0 : 1)
  }

  const setTier = (t) => {
    onStateChange(t)
  }

  return (
    <div className={`skill-card${changed ? ' changed' : ''}${purchased ? ' purchased' : ''}`}>
      <div className="skill-header">
        <span className="skill-icon">{ICONS[name] || '🔧'}</span>
        <div className="skill-names">
          <div className="skill-name">{DISPLAY[name] || name}</div>
          <div className="skill-id">{name}</div>
        </div>
        <label className="skill-toggle">
          <input type="checkbox" checked={purchased} onChange={togglePurchased} />
          <span className="skill-toggle-slider"></span>
        </label>
      </div>

      {maxTier > 1 ? (
        <div className="skill-tiers">
          {Array.from({ length: maxTier }).map((_, i) => {
            const tierVal = i + 1
            const isActive = state >= tierVal
            const isChanged = (_orig < tierVal && state >= tierVal) || (_orig >= tierVal && state < tierVal)
            
            return (
              <button
                key={i}
                className={`skill-tier-btn${isActive ? ' active' : ''}${isChanged ? ' changed' : ''}`}
                onClick={() => setTier(tierVal)}
                disabled={!purchased}
                title={`Level ${tierVal}`}
              >
                {tierVal}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="skill-tiers" style={{ justifyContent: 'center' }}>
           <span style={{ fontSize: '12px', opacity: purchased ? 1 : 0.4 }}>
             {purchased ? 'FULLY UNLOCKED' : 'LOCKED'}
           </span>
        </div>
      )}
      
      {changed && (
        <div className="skill-was">Modified (was {_orig})</div>
      )}
    </div>
  )
}

export default function Garage({ garage, onGarageChange }) {
  const handleStateChange = useCallback((idx, newState) => {
    onGarageChange(prev => prev.map((g, i) => i === idx ? { ...g, state: newState } : g))
  }, [onGarageChange])

  const handleMaxAll = useCallback(() => {
    onGarageChange(prev => prev.map(g => ({
      ...g,
      state: TIERS[g.name] || 1
    })))
  }, [onGarageChange])

  const unlockedCount = garage.filter(g => g.state > 0).length

  return (
    <div className="skills-container">
      <div className="skills-toolbar">
        <div className="skills-summary">
          <span className="badge">{unlockedCount} / {garage.length} upgrades unlocked</span>
        </div>
        <button className="btn btn-sm btn-success" onClick={handleMaxAll}>
          Max All Upgrades
        </button>
      </div>

      <div className="skills-grid">
        {garage.map((g, i) => (
          <UpgradeCard
            key={g.name}
            item={g}
            onStateChange={(val) => handleStateChange(i, val)}
          />
        ))}
      </div>
    </div>
  )
}
