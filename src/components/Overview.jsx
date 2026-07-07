import { useCallback } from 'react'
import Tooltip from './Tooltip.jsx'

function formatMoney(n) {
  return Number(n).toLocaleString()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function StatCard({
  label,
  value,
  origValue,
  onChange,
  type = 'number',
  min = 0,
  disabled = false,
  tooltip,
  presets = [],
}) {
  const changed = !disabled && value !== origValue

  return (
    <div className={`stat-card${disabled ? ' stat-card-disabled' : ''}`}>
      <span className="stat-label">
        {label}
        {tooltip && (
          <Tooltip content={tooltip} placement="top">
            <span className="info-hint" tabIndex={0}>?</span>
          </Tooltip>
        )}
      </span>
      <span className="stat-value">
        {disabled ? '—' : (label === 'Money' ? formatMoney(value) : value)}
      </span>
      <div className="stat-input-wrap">
        <input
          type={type}
          className={`stat-input${changed ? ' changed' : ''}`}
          value={disabled ? '' : value}
          min={min}
          disabled={disabled}
          placeholder={disabled ? 'Not supported' : undefined}
          onChange={(e) => {
            if (disabled) return
            const raw = e.target.value
            if (raw === '') return
            const parsed = parseInt(raw, 10)
            if (!isNaN(parsed) && parsed >= min) onChange(parsed)
          }}
        />
        {changed && (
          <span className="stat-was">
            was {label === 'Money' ? formatMoney(origValue) : origValue}
          </span>
        )}
        {!disabled && presets.length > 0 && (
          <div className="stat-presets">
            {presets.map(p => (
              <Tooltip key={p.label} content={p.tip} placement="bottom">
                <button
                  type="button"
                  className={`preset-btn${p.max ? ' preset-max' : ''}`}
                  onClick={() => onChange(typeof p.value === 'function' ? p.value(value) : p.value)}
                >
                  {p.label}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HeaderField({ label, value, origValue, onChange, type = 'text', min, max, options, small, tooltip }) {
  const changed = value !== origValue
  const inputProps = {
    className: `profile-edit-input${small ? ' small' : ''}${changed ? ' changed' : ''}`,
    value: value ?? '',
    onChange: (e) => {
      if (type === 'number') {
        const raw = e.target.value
        if (raw === '') return
        const n = parseInt(raw, 10)
        if (isNaN(n)) return
        if (min !== undefined && n < min) return
        if (max !== undefined && n > max) return
        onChange(n)
      } else {
        onChange(e.target.value)
      }
    },
  }

  return (
    <div className="profile-row">
      <span className="profile-row-label">
        {label}
        {tooltip && (
          <Tooltip content={tooltip} placement="top">
            <span className="info-hint" tabIndex={0}>?</span>
          </Tooltip>
        )}
      </span>
      {options ? (
        <select {...inputProps}>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input type={type === 'number' ? 'number' : 'text'} min={min} max={max} {...inputProps} />
      )}
      {changed && (
        <span className="profile-edit-row-was">was {origValue}</span>
      )}
    </div>
  )
}

export default function Overview({
  stats,
  origStats,
  header,
  origHeader,
  staticHeader,
  onStatsChange,
  onHeaderChange,
  isDirty,
  onUnlockAllGarage,
  onBuyAllSkills,
  onRepairAllCars,
  onResetAllEdits,
  counts,
}) {
  if (!stats || !origStats || !header) return null

  const updateStat = useCallback((key, val) => {
    onStatsChange(prev => ({ ...prev, [key]: val }))
  }, [onStatsChange])

  const updateHeader = useCallback((key, val) => {
    onHeaderChange(prev => ({ ...(prev ?? header), [key]: val }))
  }, [onHeaderChange, header])

  const supports = stats._supports || {
    money: true, level: true, xp: true, skill_points: true,
  }
  const anyStatUnsupported = !supports.money || !supports.level || !supports.xp

  const moneyPresets = [
    { label: '+1K',  tip: 'Add 1,000 credits',     value: v => Math.min(2_000_000_000, v + 1_000) },
    { label: '+10K', tip: 'Add 10,000 credits',    value: v => Math.min(2_000_000_000, v + 10_000) },
    { label: '+100K',tip: 'Add 100,000 credits',   value: v => Math.min(2_000_000_000, v + 100_000) },
    { label: '1M',   tip: 'Set to 1,000,000',      value: 1_000_000 },
    { label: 'MAX',  tip: 'Set to 999,999,999',    value: 999_999_999, max: true },
  ]
  const levelPresets = [
    { label: '+1',  tip: 'Increase level by 1', value: v => Math.min(100, v + 1) },
    { label: '25',  tip: 'Set to level 25',      value: 25 },
    { label: '50',  tip: 'Set to level 50',      value: 50 },
    { label: '99',  tip: 'Set to level 99',      value: 99, max: true },
  ]
  const xpPresets = [
    { label: '+1K',  tip: 'Add 1,000 XP',  value: v => v + 1_000 },
    { label: '+10K', tip: 'Add 10,000 XP', value: v => v + 10_000 },
    { label: 'MAX',  tip: 'Set to 999,999', value: 999_999, max: true },
  ]
  const spPresets = [
    { label: '+1', tip: 'Add 1 skill point', value: v => v + 1 },
    { label: '+5', tip: 'Add 5 skill points', value: v => v + 5 },
    { label: 'MAX', tip: 'Set to 99 skill points', value: 99, max: true },
  ]

  return (
    <div>
      {anyStatUnsupported && (
        <div className="overview-warning">
          <strong>Heads up:</strong> Money, Level, and XP editing isn't supported
          for this save format yet (game version {staticHeader.version || 'unknown'}).
          The format markers used by the editor weren't found in the file. Skills,
          garage, parts, and cars can still be edited normally.
        </div>
      )}

      <div className="bulk-panel">
        <div className="bulk-panel-header">
          <span className="bulk-panel-title">Bulk actions</span>
          <span className="bulk-panel-hint">One-click power moves — review the diff before downloading.</span>
        </div>
        <div className="bulk-actions">
          <Tooltip
            content={`Set all ${counts?.garage ?? 23} garage upgrades to their max tier (multi-tier ones to 3, binary unlocks to 1).`}
            placement="bottom"
          >
            <button type="button" className="bulk-btn" onClick={onUnlockAllGarage}>
              <span className="bulk-btn-icon">🏗️</span> Unlock all garage
            </button>
          </Tooltip>
          <Tooltip
            content={`Mark all ${counts?.skills ?? 9} skills as purchased and unlock every tier.`}
            placement="bottom"
          >
            <button type="button" className="bulk-btn" onClick={onBuyAllSkills}>
              <span className="bulk-btn-icon">🎯</span> Buy all skills + tiers
            </button>
          </Tooltip>
          <Tooltip
            content={`Restore every part on every car (${counts?.cars ?? 0} vehicles) to 100% condition.`}
            placement="bottom"
          >
            <button type="button" className="bulk-btn" onClick={onRepairAllCars}>
              <span className="bulk-btn-icon">🔧</span> Repair all cars
            </button>
          </Tooltip>
          <Tooltip
            content="Revert every edit on this save back to its original loaded state."
            placement="bottom"
          >
            <button
              type="button"
              className="bulk-btn bulk-undo"
              onClick={onResetAllEdits}
              disabled={!isDirty}
            >
              <span className="bulk-btn-icon">↺</span> Reset all edits
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="overview-grid">
        <StatCard
          label="Money"
          value={stats.money}
          origValue={origStats.money}
          onChange={(v) => updateStat('money', v)}
          min={0}
          disabled={!supports.money}
          tooltip="Credits available to spend in the game."
          presets={supports.money ? moneyPresets : []}
        />
        <StatCard
          label="Level"
          value={stats.level}
          origValue={origStats.level}
          onChange={(v) => updateStat('level', v)}
          min={1}
          disabled={!supports.level}
          tooltip="Mechanic level. Stored as level−1 in the save file."
          presets={supports.level ? levelPresets : []}
        />
        <StatCard
          label="XP"
          value={stats.xp}
          origValue={origStats.xp}
          onChange={(v) => updateStat('xp', v)}
          min={0}
          disabled={!supports.xp}
          tooltip="Experience points. Earned by completing jobs and races."
          presets={supports.xp ? xpPresets : []}
        />
        <StatCard
          label="Skill Points"
          value={stats.skill_points}
          origValue={origStats.skill_points}
          onChange={(v) => updateStat('skill_points', v)}
          min={0}
          disabled={!supports.skill_points}
          tooltip="Unspent points used to buy skills and tiers in the Skills tab."
          presets={supports.skill_points ? spPresets : []}
        />
      </div>

      <div className="profile-card profile-card-editable">
        <h3>Profile info</h3>
        <div className="profile-rows">
          <HeaderField
            label="Profile name"
            value={header.profile_name}
            origValue={origHeader.profile_name}
            onChange={(v) => updateHeader('profile_name', v)}
            tooltip="The save's profile name. Changing this renames the in-game profile shown on the load screen."
          />
          <div className="profile-row">
            <span className="profile-row-label">
              Save date
              <Tooltip content="In-game calendar date when this save was last written." placement="top">
                <span className="info-hint" tabIndex={0}>?</span>
              </Tooltip>
            </span>
            <div className="profile-date-group">
              <input
                type="number"
                min={1990}
                max={2200}
                className={`profile-edit-input small${header.save_year !== origHeader.save_year ? ' changed' : ''}`}
                value={header.save_year}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (!isNaN(n) && n >= 1990 && n <= 2200) updateHeader('save_year', n)
                }}
              />
              <span style={{ color: 'var(--text-dim)' }}>–</span>
              <select
                className={`profile-edit-input small${header.save_month !== origHeader.save_month ? ' changed' : ''}`}
                value={header.save_month}
                onChange={(e) => updateHeader('save_month', parseInt(e.target.value, 10))}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{String(i + 1).padStart(2, '0')} — {m}</option>
                ))}
              </select>
            </div>
            {(header.save_year !== origHeader.save_year || header.save_month !== origHeader.save_month) && (
              <span className="profile-edit-row-was">
                was {origHeader.save_year}-{String(origHeader.save_month).padStart(2, '0')}
              </span>
            )}
          </div>
          {staticHeader.version && (
            <div className="profile-row">
              <span className="profile-row-label">Game version</span>
              <span className="profile-row-value">{staticHeader.version}</span>
            </div>
          )}
          <div className="profile-row">
            <span className="profile-row-label">Magic</span>
            <span className="profile-row-value" style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
              {staticHeader.magic}
            </span>
          </div>
          {counts && (
            <div className="profile-row">
              <span className="profile-row-label">Save contents</span>
              <span className="profile-row-value" style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
                {counts.cars} car{counts.cars === 1 ? '' : 's'} · {counts.skills} skills · {counts.garage} garage items · {counts.parts} loose parts
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
