import { useCallback } from 'react'

const DISPLAY = {
  fast_movement: 'Fast Movement',
  fix:           'Repair Skills',
  shop_discount: 'Shop Discount',
  strong_man:    'Strong Man (Carry)',
  inspector:     'Inspector (Diagnostic)',
  eagle_eye:     'Eagle Eye (Spotting)',
  negotiator:    'Negotiator (Selling)',
  lucky_bastard: 'Lucky Bastard (Rare parts)',
  renovation:    'Renovation (Restoration)',
}

const ICONS = {
  fast_movement: '🏃',
  fix:           '🔧',
  shop_discount: '💰',
  strong_man:    '🏋️',
  inspector:     '🔍',
  eagle_eye:     '👁️',
  negotiator:    '🤝',
  lucky_bastard: '🍀',
  renovation:    '🏛️',
}

function SkillCard({ skill, onSkillChange }) {
  const { name, purchased, tiers, _origPurchased, _origTiers } = skill
  
  const changed = purchased !== _origPurchased || tiers.some((t, i) => t !== _origTiers[i])

  const togglePurchased = () => {
    onSkillChange({ ...skill, purchased: !purchased })
  }

  const toggleTier = (idx) => {
    const newTiers = [...tiers]
    newTiers[idx] = !newTiers[idx]
    onSkillChange({ ...skill, tiers: newTiers })
  }

  return (
    <div className={`skill-card${changed ? ' changed' : ''}${purchased ? ' purchased' : ''}`}>
      <div className="skill-header">
        <span className="skill-icon">{ICONS[name] || '✨'}</span>
        <div className="skill-names">
          <div className="skill-name">{DISPLAY[name] || name}</div>
          <div className="skill-id">{name}</div>
        </div>
        <label className="skill-toggle">
          <input type="checkbox" checked={purchased} onChange={togglePurchased} />
          <span className="skill-toggle-slider"></span>
        </label>
      </div>

      <div className="skill-tiers">
        {tiers.map((t, i) => (
          <button
            key={i}
            className={`skill-tier-btn${t ? ' active' : ''}${_origTiers[i] !== t ? ' changed' : ''}`}
            onClick={() => toggleTier(i)}
            disabled={!purchased}
            title={t ? 'Tier Purchased' : 'Click to purchase tier'}
          >
            {i + 1}
          </button>
        ))}
      </div>
      
      {changed && (
        <div className="skill-was">Modified</div>
      )}
    </div>
  )
}

export default function Skills({ skills, onSkillsChange }) {
  const handleSkillChange = useCallback((updatedSkill) => {
    onSkillsChange(prev => prev.map(s => s.name === updatedSkill.name ? updatedSkill : s))
  }, [onSkillsChange])

  const handlePurchaseAll = useCallback(() => {
    onSkillsChange(prev => prev.map(s => ({
      ...s,
      purchased: true,
      tiers: s.tiers.map(() => true)
    })))
  }, [onSkillsChange])

  const purchasedCount = skills.filter(s => s.purchased).length
  const totalTiers     = skills.reduce((acc, s) => acc + s.tiers.length, 0)
  const purchasedTiers = skills.reduce((acc, s) => acc + s.tiers.filter(t => t).length, 0)

  return (
    <div className="skills-container">
      <div className="skills-toolbar">
        <div className="skills-summary">
          <span className="badge">{purchasedCount} / {skills.length} skills</span>
          <span className="badge">{purchasedTiers} / {totalTiers} tiers</span>
        </div>
        <button className="btn btn-sm btn-success" onClick={handlePurchaseAll}>
          Max All Skills
        </button>
      </div>

      <div className="skills-grid">
        {skills.map(s => (
          <SkillCard
            key={s.name}
            skill={s}
            onSkillChange={handleSkillChange}
          />
        ))}
      </div>
    </div>
  )
}
