import { useState } from 'react'

export default function DownloadModal({ onConfirm, onCancel, diff = [] }) {
  const [activePlatform, setActivePlatform] = useState('steam')
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleConfirm = () => {
    if (dontShowAgain) {
      localStorage.setItem('skipDownloadModal', 'true')
    }
    onConfirm()
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h3>Save Download Instructions</h3>
          <p>Read where to place your file before proceeding.</p>
        </div>

        <div className="modal-body" style={{ paddingBottom: 0 }}>
          <div className="modal-diff">
            <div className="modal-diff-title">
              About to write {diff.length === 0 ? 'no changes' : `${diff.length} change${diff.length === 1 ? '' : 's'}`}
            </div>
            {diff.length === 0 ? (
              <div className="modal-diff-empty">
                You haven't made any edits. The downloaded file will be byte-identical to the original.
              </div>
            ) : (
              <ul className="modal-diff-list">
                {diff.map((d, i) => (
                  <li key={i} className="modal-diff-item">
                    <span className="modal-diff-item-label">{d.label}</span>
                    {d.bulk ? (
                      <span className="modal-diff-bulk">{d.bulk}</span>
                    ) : (
                      <>
                        <span className="modal-diff-item-from">{d.from}</span>
                        <span className="modal-diff-arrow">→</span>
                        <span className="modal-diff-item-to">{d.to}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-tabs">
          <button 
            className={`modal-tab ${activePlatform === 'steam' ? 'active' : ''}`}
            onClick={() => setActivePlatform('steam')}
          >
            Steam / Epic
          </button>
          <button 
            className={`modal-tab ${activePlatform === 'xbox' ? 'active' : ''}`}
            onClick={() => setActivePlatform('xbox')}
          >
            Xbox Game Pass (PC)
          </button>
        </div>

        <div className="modal-body">
          {activePlatform === 'steam' ? (
            <div className="platform-info">
              <p>Your save is likely located in:</p>
              <code>%USERPROFILE%\AppData\LocalLow\Red Dot Games\Car Mechanic Simulator 2021\Saves\</code>
              <ul className="instruction-list">
                <li>Replace the existing <strong>profileX.cms21b</strong> file.</li>
                <li>Make sure the game is closed before replacing.</li>
              </ul>
            </div>
          ) : (
            <div className="platform-info">
              <p>Xbox Game Pass (PC) uses hash filenames found in:</p>
              <code>%LOCALAPPDATA%\Packages\...\SystemAppData\wgs\</code>
              <ul className="instruction-list">
                <li>Identify your save by size (usually 8KB–30KB).</li>
                <li><strong>IMPORTANT:</strong> Rename the downloaded file to match the original <strong>Hash Name</strong> (the long string of letters and numbers).</li>
                <li>To avoid cloud sync issues, disconnect your internet, replace the file, launch the game, and then reconnect once in the main menu.</li>
              </ul>
            </div>
          )}

          <div className="modal-warning">
            <div className="warning-icon">⚠️</div>
            <div className="warning-text">
              <strong>Always backup your files!</strong>
              <p>
                If something fails and you don't have a backup, your save may be permanently lost.
                By using this software, you accept that it is provided as-is with no guarantees.
              </p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <label className="modal-checkbox">
            <input 
              type="checkbox" 
              checked={dontShowAgain} 
              onChange={(e) => setDontShowAgain(e.target.checked)} 
            />
            Don't show this again
          </label>
          <div className="modal-btns">
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleConfirm}>Download Now</button>
          </div>
        </div>
      </div>
    </div>
  )
}
