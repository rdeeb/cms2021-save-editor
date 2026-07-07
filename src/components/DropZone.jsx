import { useState, useCallback, useRef } from 'react'

export default function DropZone({ onFile, loading, progress, progressLabel, error }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  const handleChange = useCallback((e) => {
    const file = e.target.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div className="dropzone-page">
      <div
        className={`dropzone-card${dragOver ? ' drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="dropzone-icon">🎮</span>
        <h1 className="dropzone-title">CMS21 Save Editor</h1>
        <p className="dropzone-subtitle">
          Drop your save file here, or browse to select it.
          <br />
          Supports <strong>.cms21b</strong> save files.
        </p>

        {loading ? (
          <div className="dropzone-loading">
            <div className="dropzone-progress-bar">
              <div
                className="dropzone-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="dropzone-progress-label">
              {progressLabel || 'Loading…'}
            </span>
          </div>
        ) : (
          <label className="dropzone-browse">
            Browse file…
            <input
              ref={inputRef}
              type="file"
              accept=".cms21b"
              onChange={handleChange}
            />
          </label>
        )}

        {error && (
          <div className="dropzone-error">
            <strong>Failed to load:</strong> {error}
          </div>
        )}

        <div className="dropzone-hint">
          <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
            Save file location:
          </strong>
          <code>%AppData%\..\LocalLow\Red Dot Games\Car Mechanic Simulator 2021\</code>
        </div>
      </div>
    </div>
  )
}
