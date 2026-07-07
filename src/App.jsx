import { useState, useCallback, useEffect, useRef } from 'react'
import DropZone from './components/DropZone.jsx'
import Overview from './components/Overview.jsx'
import Garage from './components/Garage.jsx'
import Parts from './components/Parts.jsx'
import Skills from './components/Skills.jsx'
import Cars from './components/Cars.jsx'
import DownloadModal from './components/DownloadModal.jsx'
import { parseCars } from './codec.js' // We still might need it if we call it from main, but worker has it too.

const TABS = ['Overview', 'Garage', 'Parts', 'Skills', 'Cars']

export default function App() {
  const workerRef = useRef(null)

  const [decoded, setDecoded] = useState(null)
  const [header, setHeader] = useState(null)
  const [origHeader, setOrigHeader] = useState(null)
  const [stats, setStats] = useState(null)
  const [origStats, setOrigStats] = useState(null)
  const [parts, setParts] = useState([])
  const [garage, setGarage] = useState([])
  const [skills, setSkills] = useState([])
  const [cars, setCars] = useState([])
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(0)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [filename, setFilename] = useState('profile0.cms21b')

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('./codec.worker.js', import.meta.url),
      { type: 'module' },
    )
    return () => workerRef.current?.terminate()
  }, [])

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setProgress(0)
    setProgressLabel('Reading file…')
    setError(null)
    setFilename(file.name)

    const buffer = await file.arrayBuffer()

    workerRef.current.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        setProgress(msg.pct)
        setProgressLabel(msg.label)
      } else if (msg.type === 'done') {
        const data = msg.result
        setDecoded(data)
        const headerCopy = {
          profile_name: data.header.profile_name,
          save_year:    data.header.save_year,
          save_month:   data.header.save_month,
        }
        setHeader(headerCopy)
        setOrigHeader({ ...headerCopy })
        setStats({ ...data.stats })
        setOrigStats({ ...data.stats })
        setParts(data.parts.map(p => ({ ...p, _orig: p.condition })))
        setGarage(data.garage.map(g => ({ ...g, _orig: g.state })))
        setSkills(data.skills.map(s => ({
          ...s,
          _origPurchased: s.purchased,
          _origTiers: [...s.tiers]
        })))
        setCars(data.cars.map(c => ({
          ...c,
          parts: c.parts.map(p => ({ ...p, _origCond: p.condition }))
        })))
        setActiveTab(0)
        setLoading(false)
        setProgress(0)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setLoading(false)
        setProgress(0)
      }
    }

    // Transfer the buffer to the worker (zero-copy)
    workerRef.current.postMessage({ type: 'decode', buffer }, [buffer])
  }, [])

  const handleDownload = useCallback(() => {
    if (!decoded) return
    if (localStorage.getItem('skipDownloadModal') === 'true') {
      executeDownload()
    } else {
      setShowDownloadModal(true)
    }
  }, [decoded])

  const executeDownload = useCallback(() => {
    if (!decoded) return
    setShowDownloadModal(false)
    setDownloading(true)
    setDlProgress(0)
    setError(null)

    const partEdits = parts
      .filter(p => p.has_condition && p.condition !== p._orig)
      .map(p => ({ sec_idx: p.sec_idx, part_idx: p.part_idx, condition: p.condition }))

    const garageEdits = garage
      .filter(g => g.state !== g._orig)
      .map((g, idx) => ({ idx, state: g.state }))

    const skillEdits = skills.map(s => ({
      name: s.name,
      purchased: s.purchased,
      tiers: s.tiers,
    }))

    const carPartEdits = []
    cars.forEach(c => {
      c.parts.forEach(p => {
        if (p.condition !== p._origCond) {
          carPartEdits.push({ offset: p.offset, condition: p.condition })
        }
      })
    })

    workerRef.current.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        setDlProgress(msg.pct)
      } else if (msg.type === 'done') {
        const binary = msg.result
        const blob = new Blob([binary], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)

        setParts(prev => prev.map(p => ({ ...p, _orig: p.condition })))
        setGarage(prev => prev.map(g => ({ ...g, _orig: g.state })))
        setSkills(prev => prev.map(s => ({
          ...s,
          _origPurchased: s.purchased,
          _origTiers: [...s.tiers]
        })))
        setCars(prev => prev.map(c => ({
          ...c,
          parts: c.parts.map(p => ({ ...p, _origCond: p.condition }))
        })))
        setOrigStats({ ...stats })
        if (header) setOrigHeader({ ...header })
        // Commit header edits back into decoded.save so future encodes start
        // from the renamed/dated baseline.
        setDecoded(prev => prev && header ? {
          ...prev,
          save: { ...prev.save, header: { ...prev.save.header, ...header } },
          header: { ...prev.header, ...header },
        } : prev)
        setDownloading(false)
        setDlProgress(0)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setDownloading(false)
        setDlProgress(0)
      }
    }

    const patchedSave = header
      ? { ...decoded.save, header: { ...decoded.save.header, ...header } }
      : decoded.save

    workerRef.current.postMessage({
      type: 'encode',
      save: patchedSave,
      stats,
      partEdits,
      garageEdits,
      skillEdits,
      carPartEdits,
    })
  }, [decoded, header, stats, parts, garage, skills, cars, filename])

  const supports = stats?._supports ?? {
    money: true, level: true, xp: true, skill_points: true,
  }
  const headerDirty = !!(header && origHeader && (
    header.profile_name !== origHeader.profile_name ||
    header.save_year    !== origHeader.save_year    ||
    header.save_month   !== origHeader.save_month
  ))
  const isDirty = decoded && (
    headerDirty ||
    (stats && origStats && (
      (supports.money && stats.money !== origStats.money) ||
      (supports.level && stats.level !== origStats.level) ||
      (supports.xp && stats.xp !== origStats.xp) ||
      (supports.skill_points && stats.skill_points !== origStats.skill_points)
    )) ||
    parts.some(p => p.has_condition && p.condition !== p._orig) ||
    garage.some(g => g.state !== g._orig) ||
    skills.some(s => s.purchased !== s._origPurchased || s.tiers.some((t, i) => t !== s._origTiers[i])) ||
    cars.some(c => c.parts.some(p => p.condition !== p._origCond))
  )

  // ── Bulk actions ────────────────────────────────────────────────────────────
  const unlockAllGarage = useCallback(() => {
    // Heuristic: items whose ORIGINAL max-seen state was 3 are multi-tier
    // (paintshop, scraps, dyno, etc.); the rest are binary (set to 1).
    const MULTI_TIER = new Set([
      'paintshop','scraps','dyno','warehouse','garage_upgrade',
      'garage_customization','lifter','brake_lathe','repair_parts',
      'welder','battery','crane','repair_body','bus_upgrade','windowtint',
    ])
    setGarage(prev => prev.map(g => ({
      ...g,
      state: MULTI_TIER.has(g.name) ? 3 : 1,
    })))
  }, [])

  const buyAllSkills = useCallback(() => {
    setSkills(prev => prev.map(s => ({
      ...s,
      purchased: true,
      tiers: s.tiers.map(() => true),
    })))
  }, [])

  const repairAllCars = useCallback(() => {
    setCars(prev => prev.map(c => ({
      ...c,
      parts: c.parts.map(p => ({ ...p, condition: 1.0 })),
    })))
  }, [])

  const resetAllEdits = useCallback(() => {
    if (origHeader) setHeader({ ...origHeader })
    if (origStats)  setStats({ ...origStats })
    setParts(prev => prev.map(p => ({ ...p, condition: p._orig })))
    setGarage(prev => prev.map(g => ({ ...g, state: g._orig })))
    setSkills(prev => prev.map(s => ({
      ...s,
      purchased: s._origPurchased,
      tiers: [...s._origTiers],
    })))
    setCars(prev => prev.map(c => ({
      ...c,
      parts: c.parts.map(p => ({ ...p, condition: p._origCond })),
    })))
  }, [origHeader, origStats])

  // ── Diff summary for download modal ─────────────────────────────────────────
  const computeDiff = () => {
    const items = []
    if (header && origHeader) {
      if (header.profile_name !== origHeader.profile_name) {
        items.push({ label: 'Profile name', from: origHeader.profile_name, to: header.profile_name })
      }
      if (header.save_year !== origHeader.save_year) {
        items.push({ label: 'Save year', from: origHeader.save_year, to: header.save_year })
      }
      if (header.save_month !== origHeader.save_month) {
        items.push({ label: 'Save month', from: origHeader.save_month, to: header.save_month })
      }
    }
    if (stats && origStats) {
      if (supports.money && stats.money !== origStats.money) {
        items.push({ label: 'Money', from: origStats.money.toLocaleString(), to: stats.money.toLocaleString() })
      }
      if (supports.level && stats.level !== origStats.level) {
        items.push({ label: 'Level', from: origStats.level, to: stats.level })
      }
      if (supports.xp && stats.xp !== origStats.xp) {
        items.push({ label: 'XP', from: origStats.xp.toLocaleString(), to: stats.xp.toLocaleString() })
      }
      if (supports.skill_points && stats.skill_points !== origStats.skill_points) {
        items.push({ label: 'Skill points', from: origStats.skill_points, to: stats.skill_points })
      }
    }
    const garageChanged = garage.filter(g => g.state !== g._orig).length
    if (garageChanged) items.push({ label: 'Garage upgrades', bulk: `${garageChanged} item${garageChanged === 1 ? '' : 's'} changed` })

    const skillsChanged = skills.filter(s =>
      s.purchased !== s._origPurchased ||
      s.tiers.some((t, i) => t !== s._origTiers[i])
    ).length
    if (skillsChanged) items.push({ label: 'Skills', bulk: `${skillsChanged} skill${skillsChanged === 1 ? '' : 's'} changed` })

    const partsChanged = parts.filter(p => p.has_condition && p.condition !== p._orig).length
    if (partsChanged) items.push({ label: 'Inventory parts', bulk: `${partsChanged} part${partsChanged === 1 ? '' : 's'} repaired` })

    const carPartsChanged = cars.reduce((sum, c) =>
      sum + c.parts.filter(p => p.condition !== p._origCond).length, 0
    )
    if (carPartsChanged) items.push({ label: 'Car parts', bulk: `${carPartsChanged} part${carPartsChanged === 1 ? '' : 's'} updated` })

    return items
  }

  if (!decoded) {
    return (
      <DropZone
        onFile={handleFile}
        loading={loading}
        progress={progress}
        progressLabel={progressLabel}
        error={error}
      />
    )
  }

  const hdr = decoded.header
  const liveName  = header?.profile_name  ?? hdr.profile_name
  const liveYear  = header?.save_year     ?? hdr.save_year
  const liveMonth = header?.save_month    ?? hdr.save_month

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">CMS21 Save Editor</span>
          <span className="topbar-profile">{liveName}</span>
          <span className="topbar-meta">
            {liveYear}-{String(liveMonth).padStart(2, '0')}
            {hdr.version ? ` · v${hdr.version}` : ''}
          </span>
          {isDirty && <span className="dirty-badge">● Unsaved changes</span>}
        </div>
        <div className="topbar-right">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDecoded(null)
              setHeader(null)
              setOrigHeader(null)
              setStats(null)
              setOrigStats(null)
              setParts([])
              setGarage([])
              setSkills([])
              setCars([])
              setError(null)
            }}
          >
            Open another file
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading
              ? `Saving… ${dlProgress < 100 ? `${dlProgress}%` : ''}`
              : '↓ Download .cms21b'}
          </button>
        </div>
      </header>

      {showDownloadModal && (
        <DownloadModal
          diff={computeDiff()}
          onConfirm={executeDownload}
          onCancel={() => setShowDownloadModal(false)}
        />
      )}

      {error && (
        <div className="global-error">
          <strong>Error:</strong> {error}
          <button className="error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`tab-btn${activeTab === i ? ' active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {activeTab === 0 && (
          <Overview
            stats={stats}
            origStats={origStats}
            header={header || hdr}
            origHeader={origHeader || hdr}
            staticHeader={hdr}
            onStatsChange={setStats}
            onHeaderChange={setHeader}
            isDirty={!!isDirty}
            onUnlockAllGarage={unlockAllGarage}
            onBuyAllSkills={buyAllSkills}
            onRepairAllCars={repairAllCars}
            onResetAllEdits={resetAllEdits}
            counts={{
              cars: cars.length,
              garage: garage.length,
              skills: skills.length,
              parts: parts.length,
            }}
          />
        )}
        {activeTab === 1 && (
          <Garage
            garage={garage}
            onGarageChange={setGarage}
          />
        )}
        {activeTab === 2 && (
          <Parts
            parts={parts}
            onPartsChange={setParts}
          />
        )}
        {activeTab === 3 && <Skills skills={skills} onSkillsChange={setSkills} />}
        {activeTab === 4 && <Cars cars={cars} onCarsChange={setCars} />}
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <span className="footer-made">Made in 🇵🇦 with ❤️ by <a href="https://github.com/rdeeb" target="_blank" rel="noreferrer">rdeeb</a></span>
          <span className="footer-sep">|</span>
          <a href="https://github.com/rdeeb/cms2021-save-editor" target="_blank" rel="noreferrer">GitHub Project</a>
          <span className="footer-sep">|</span>
          <a href="https://github.com/rdeeb/cms2021-save-editor/issues" target="_blank" rel="noreferrer" className="footer-link-error">
            Report a Bug
          </a>
        </div>
      </footer>
    </div>
  )
}
