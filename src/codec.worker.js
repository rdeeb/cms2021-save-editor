/**
 * Web Worker wrapper for the codec.
 * Runs decode / applyEdits off the main thread so the UI never freezes.
 *
 * Messages IN  → { type: 'decode',  buffer: ArrayBuffer }
 *              → { type: 'encode',  save, stats, partEdits, garageEdits, skillEdits }
 *
 * Messages OUT → { type: 'progress', pct: 0-100, label: string }
 *              → { type: 'done',     result }
 *              → { type: 'error',    message: string }
 */
import { decode, parseStats, parseGarage, parseSkills, flattenParts, parseCars, applyEdits } from './codec.js'

const report = (pct, label) => self.postMessage({ type: 'progress', pct, label })

self.onmessage = ({ data: msg }) => {
  try {
    if (msg.type === 'decode') {
      const save   = decode(msg.buffer, report)
      const result = {
        save,
        header: save.header,
        stats:  parseStats(save),
        skills: parseSkills(save),
        garage: parseGarage(save),
        parts:  flattenParts(save),
        cars:   parseCars(save),
      }
      self.postMessage({ type: 'done', result })

    } else if (msg.type === 'encode') {
      const binary = applyEdits(
        msg.save,
        {
          stats:       msg.stats,
          partEdits:   msg.partEdits,
          garageEdits: msg.garageEdits,
          skillEdits:  msg.skillEdits,
          carPartEdits: msg.carPartEdits
        },
        report,
      )
      // Transfer the underlying ArrayBuffer so it's zero-copy across the thread boundary
      self.postMessage({ type: 'done', result: binary }, [binary.buffer])
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message })
  }
}
