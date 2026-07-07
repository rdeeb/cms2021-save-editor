/**
 * CMS21 Save Editor — pure-JS binary codec
 *
 * Direct port of decode.py. All binary I/O uses DataView / Uint8Array so this
 * runs entirely in the browser with no backend required.
 *
 * Public API
 * ----------
 *   decode(arrayBuffer)                      → save object
 *   encode(save)                             → Uint8Array
 *   parseStats(save)                         → { money, level, xp, skill_points }
 *   parseGarage(save)                        → [{ name, state, raw }]
 *   parseSkills(save)                        → [{ name, purchased, tiers }]
 *   flattenParts(save)                       → [{ sec_idx, part_idx, name, condition, … }]
 *   applyEdits(save, { stats, partEdits,
 *               garageEdits, skillEdits })   → Uint8Array  (ready to download)
 */

// ── Constants ────────────────────────────────────────────────────────────────

const MAGIC = 'PJOOOTER'

const _STANDARD_SIZE = 47
const _BODY_SIZE     = 63
const _RIM_SIZE      = 64

const _BODY_PART_PREFIXES = ['car_', 'window', 'mirror', 'door', 'trunk',
                             'hood', 'taillight', 'bumper', 'fender']
const _RIM_PREFIXES       = ['rim_', 'tire_', 'wheel_']

const _GARAGE_NAMES = [
  'paintshop','scraps','dyno','warehouse','path_test','car_wash',
  'unlock_tablet','unlock_obd','unlock_fuel','unlock_electronic',
  'garage_upgrade','garage_customization','lifter','unlock_cylinder',
  'unlock_tires','brake_lathe','repair_parts','welder','battery',
  'crane','repair_body','bus_upgrade','windowtint',
]

const _utf8dec = new TextDecoder('utf-8')
const _utf8enc = new TextEncoder()

// Byte patterns used for dynamic-offset lookups in the tail section
// \x5c\xfe\xff\xff = last IEEE-754 NaN sentinel; \x00\x00\xf0\x41 = float32(30.0)
// (Pre-1.0.30-ish format only.)
const _STATS_ANCHOR   = new Uint8Array([0x5c, 0xfe, 0xff, 0xff, 0x00, 0x00, 0xf0, 0x41])
// Shorter fallback anchor for newer save formats that dropped the NaN sentinel.
const _STATS_ANCHOR_V2 = new Uint8Array([0x00, 0x00, 0xf0, 0x41])
// uint32(23) + str8 "paintshop"  (23 = number of garage items)
const _GARAGE_NEEDLE  = new Uint8Array([0x17, 0x00, 0x00, 0x00, 0x09,
                                        ..._utf8enc.encode('paintshop')])
// First skill name is always "fast_movement"
const _SKILL_NEEDLE   = _utf8enc.encode('fast_movement')

// ── Low-level utilities ───────────────────────────────────────────────────────

function _bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function _hexToBytes(hex) {
  const arr = new Uint8Array(hex.length >>> 1)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

function _concatBytes(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

/** Find first occurrence of needle in haystack from fromIndex. Returns -1 if absent. */
function _bytesIndexOf(haystack, needle, fromIndex = 0) {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Find last occurrence of needle in haystack. Returns -1 if absent. */
function _bytesLastIndexOf(haystack, needle) {
  let result = -1, i = 0
  while (true) {
    const idx = _bytesIndexOf(haystack, needle, i)
    if (idx === -1) break
    result = idx; i = idx + 1
  }
  return result
}

/** Read a length-prefixed UTF-8 string (1-byte length + data). Returns [string, nextPos]. */
function _readStr8(data, pos) {
  const n = data[pos]
  const s = _utf8dec.decode(data.slice(pos + 1, pos + 1 + n))
  return [s, pos + 1 + n]
}

/** Write a length-prefixed UTF-8 string. Returns Uint8Array. */
function _writeStr8(s) {
  const b = _utf8enc.encode(s)
  return _concatBytes([new Uint8Array([b.length]), b])
}

// ── Part name heuristic ───────────────────────────────────────────────────────

function _isValidPartName(s) {
  if (s.length < 3) return false
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return false          // rejects e.g. 'Standard[#000000]'
  const alpha = [...s].filter(c => /[a-zA-Z]/.test(c))
  if (alpha.length > 0 && alpha.every(c => c === c.toUpperCase())) return false  // rejects 'DGR4D37'
  return true
}

function _findNextEntry(data, start) {
  for (let size = 0; size < Math.min(256, data.length - start); size++) {
    const pos = start + size
    if (pos >= data.length) break
    const n = data[pos]
    if (n >= 2 && n <= 60) {
      const end = pos + 1 + n
      if (end <= data.length) {
        const cand = data.slice(pos + 1, end)
        if (cand.every(b => b >= 32 && b < 127)) {
          if (_isValidPartName(String.fromCharCode(...cand))) return pos
        }
      }
    }
  }
  return -1
}

// ── Block size detection ──────────────────────────────────────────────────────

function _guessBlockSize(name) {
  const low = name.toLowerCase()
  if (_RIM_PREFIXES.some(p => low.startsWith(p)))       return _RIM_SIZE
  if (_BODY_PART_PREFIXES.some(p => low.startsWith(p))) return _BODY_SIZE
  return _STANDARD_SIZE
}

// ── Binary block decode / encode ──────────────────────────────────────────────
//
//  Block field layout (all little-endian):
//   [0..1]   uint16  part_id
//   [2..8]   7 bytes unknown flags
//   [9..12]  float32 condition  (0.0 = broken … 1.0 = perfect)
//   [13..16] float32 quality
//   [17..20] uint32  flag
//   [21..38] 18 bytes unknown
//   [39..42] float32 extra
//   [43..46] 4 bytes tail
//   -- body/rim parts append 16 bytes of RGBA colour --
//   [47..50] float32 paint.r
//   [51..54] float32 paint.g
//   [55..58] float32 paint.b
//   [59..62] float32 paint.a

function _decodeBlock(name, block) {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const n = block.length
  const entry = { name, _raw: _bytesToHex(block) }

  if (n >= 47) {
    entry.part_id   = view.getUint16(0, true)
    entry.condition = view.getFloat32(9, true)
    entry.quality   = view.getFloat32(13, true)
    entry.flag      = view.getUint32(17, true)
    entry.extra     = view.getFloat32(39, true)
  }
  if (n >= 63) {
    entry.paint = {
      r: view.getFloat32(47, true),
      g: view.getFloat32(51, true),
      b: view.getFloat32(55, true),
      a: view.getFloat32(59, true),
    }
  }
  return entry
}

function _encodeBlock(entry) {
  const block = _hexToBytes(entry._raw)
  const view  = new DataView(block.buffer)

  if (block.length >= 47) {
    if (entry.condition !== undefined) view.setFloat32(9,  entry.condition, true)
    if (entry.quality   !== undefined) view.setFloat32(13, entry.quality,   true)
    if (entry.flag      !== undefined) view.setUint32(17,  entry.flag,      true)
    if (entry.extra     !== undefined) view.setFloat32(39, entry.extra,     true)
  }
  if (block.length >= 63 && entry.paint) {
    view.setFloat32(47, entry.paint.r, true)
    view.setFloat32(51, entry.paint.g, true)
    view.setFloat32(55, entry.paint.b, true)
    view.setFloat32(59, entry.paint.a, true)
  }
  return block
}

// ── Parts section ─────────────────────────────────────────────────────────────

function _parsePartsSection(data, start, onProgress, pStart = 10, pEnd = 65) {
  let pos = start
  if (pos >= data.length) return [null, pos]

  const [sectionName, p1] = _readStr8(data, pos)
  pos = p1

  const view  = new DataView(data.buffer, data.byteOffset + pos)
  if (pos + 4 > data.length) return [null, pos]
  const count = view.getUint32(0, true)
  pos += 4

  // Heuristic: if count is absurdly large (e.g. > 10,000 for a 20KB file), 
  // it might be a misread header.
  if (count > 0xFFFF || (count * 40 > data.length)) {
     // This is likely not the start of a parts section.
     return [null, start]
  }

  const parts = []
  let lastReportedPct = -1
  for (let i = 0; i < count; i++) {
    if (onProgress && count > 0) {
      const pct = Math.round(pStart + (pEnd - pStart) * (i + 1) / count)
      if (pct !== lastReportedPct) {
        onProgress(pct, `Parsing parts… (${i + 1} / ${count})`)
        lastReportedPct = pct
      }
    }
    
    if (pos >= data.length) break

    const nameLen = data[pos]
    if (pos + 1 + nameLen > data.length) break
    const name    = _utf8dec.decode(data.slice(pos + 1, pos + 1 + nameLen))
    pos += 1 + nameLen

    const dataStart = pos
    let blockSize

    if (i < count - 1) {
      let guessed  = _guessBlockSize(name)
      const cand   = dataStart + guessed
      let ok = false
      if (cand < data.length) {
        const n = data[cand]
        if (n >= 2 && n <= 60) {
          const end = cand + 1 + n
          if (end <= data.length) {
            const candStr = data.slice(cand + 1, end)
            if (candStr.every(b => b >= 32 && b < 127)) {
              if (_isValidPartName(String.fromCharCode(...candStr))) ok = true
            }
          }
        }
      }
      if (!ok) {
        const nextOff = _findNextEntry(data, dataStart)
        if (nextOff !== -1) guessed = nextOff - dataStart
      }
      blockSize = guessed
    } else {
      blockSize     = _guessBlockSize(name)
      const nextOff = _findNextEntry(data, dataStart + 1)
      if (nextOff !== -1) {
        const candidate = nextOff - dataStart
        if (candidate >= 40 && candidate <= 149) blockSize = candidate
      }
    }

    if (dataStart + blockSize > data.length) blockSize = data.length - dataStart
    parts.push(_decodeBlock(name, data.slice(dataStart, dataStart + blockSize)))
    pos = dataStart + blockSize
  }

  return [{ section_name: sectionName, parts }, pos]
}

function _encodePartsSection(section) {
  const chunks = [_writeStr8(section.section_name)]
  const countBuf = new Uint8Array(4)
  new DataView(countBuf.buffer).setUint32(0, section.parts.length, true)
  chunks.push(countBuf)
  for (const p of section.parts) {
    chunks.push(_writeStr8(p.name))
    chunks.push(_encodeBlock(p))
  }
  return _concatBytes(chunks)
}

// ── Header ────────────────────────────────────────────────────────────────────

function _parseHeader(data) {
  const magic = String.fromCharCode(...data.slice(0, 8))
  if (magic !== MAGIC) throw new Error(`Not a valid CMS21 save file (bad magic: ${magic})`)

  const view  = new DataView(data.buffer, data.byteOffset)
  const year  = view.getUint16(8, true)
  const month = data[10]
  const nl    = data[11]
  const name  = _utf8dec.decode(data.slice(12, 12 + nl))
  const rawStart = 12 + nl

  // Find the version string within the first ~256 bytes after the profile name.
  // The version is the FIRST length-prefixed ASCII string that looks like
  // "<digits>.<digits>..." possibly suffixed with letters (e.g. "1.0.10w",
  // "1.0.39.hf1"). Cap the search so we don't scan into car-part data.
  const verSearchEnd = Math.min(data.length - 1, rawStart + 256)
  let verEnd = -1
  for (let i = rawStart; i < verSearchEnd; i++) {
    const n = data[i]
    if (n < 3 || n > 16) continue
    if (i + 1 + n > data.length) break
    const slice = data.slice(i + 1, i + 1 + n)
    if (!slice.every(b => b >= 32 && b < 127)) continue
    const s = String.fromCharCode(...slice)
    if (!/^\d+\.\d/.test(s)) continue
    const stripped = s.replace(/[a-zA-Z]+\d*$/, '')
    const parts    = stripped.split('.').filter(p => p !== '')
    if (parts.length >= 2 && parts.every(p => /^\d+$/.test(p))) {
      verEnd = i + 1 + n
      break
    }
  }

  // Determine where the header ends.
  // - Old format (≤ 1.0.10w-ish): version is followed by 0xff padding, then
  //   the parts section. End the header after the 0xff run.
  // - New format (≥ 1.0.30-ish): no 0xff padding — end the header immediately
  //   after the version string.
  let pos
  if (verEnd !== -1 && verEnd < data.length && data[verEnd] !== 0xff) {
    pos = verEnd
  } else {
    pos = rawStart
    while (pos < data.length && data[pos] !== 0xff) pos++
    while (pos < data.length && data[pos] === 0xff) pos++
  }

  const headerRaw = data.slice(rawStart, pos)

  const hdr = {
    magic,
    save_year:    year,
    save_month:   month,
    profile_name: name,
    version:      _extractVersion(headerRaw),
    _header_raw:  _bytesToHex(headerRaw),
  }
  return [hdr, pos]
}

function _extractVersion(raw) {
  for (let i = 0; i < raw.length - 8; i++) {
    const n = raw[i]
    if (n >= 3 && n <= 16) {
      const b = raw.slice(i + 1, i + 1 + n)
      if (!b.every(x => x >= 32 && x < 127)) continue
      const s = String.fromCharCode(...b)
      if (!/^\d+\.\d/.test(s)) continue
      const stripped = s.replace(/[a-zA-Z]+\d*$/, '')
      const parts    = stripped.split('.').filter(p => p !== '')
      if (parts.length >= 2 && parts.every(p => /^\d+$/.test(p))) {
        return s
      }
    }
  }
  return ''
}

function _encodeHeader(hdr) {
  const yearBuf = new Uint8Array(2)
  new DataView(yearBuf.buffer).setUint16(0, hdr.save_year, true)
  return _concatBytes([
    new Uint8Array([...MAGIC].map(c => c.charCodeAt(0))),
    yearBuf,
    new Uint8Array([hdr.save_month]),
    _writeStr8(hdr.profile_name),
    _hexToBytes(hdr._header_raw),
  ])
}

// ── Tail-section dynamic-offset helpers ───────────────────────────────────────

/**
 * Locate the stats block.
 *
 * Returns:
 *   { money, level, xp, layout: 'v1' } — old format (NaN sentinel + float30.0)
 *   { money, level, xp, layout: 'v2' } — newer format (float30.0 only); offsets
 *     are best-effort and any field whose value looks unreasonable is omitted.
 *   null — neither anchor found.
 */
function _tailStatsOffsets(tail) {
  const v1 = _bytesLastIndexOf(tail, _STATS_ANCHOR)
  if (v1 !== -1) {
    const off = v1 + 17  // anchor(8) + float(4) + float(4) + 1 pad byte
    return { money: off, level: off + 4, xp: off + 8, layout: 'v1' }
  }

  // Newer format (≥ 1.0.30-ish): only the float32(30.0) marker remains.
  // The block layout is the same as v1 — just shifted left by the missing
  // 4-byte NaN sentinel:
  //   [0..3]  float32(30.0)        (was bytes 4..7 of the v1 anchor)
  //   [4..7]  float32              (gameplay value)
  //   [8..11] float32              (gameplay value)
  //   [12]    1-byte pad
  //   [13..16] uint32  money
  //   [17..20] uint32  level - 1
  //   [21..24] uint32  xp
  const v2 = _bytesLastIndexOf(tail, _STATS_ANCHOR_V2)
  if (v2 === -1 || v2 + 25 > tail.length) return null
  const view = new DataView(tail.buffer, tail.byteOffset)
  const looksLikeStats = (mOff, lOff, xOff) => {
    if (xOff + 4 > tail.length) return false
    const m = view.getUint32(mOff, true)
    const l = view.getUint32(lOff, true)
    const x = view.getUint32(xOff, true)
    return m <= 1_000_000_000 && l <= 200 && x <= 100_000_000
  }
  const candidates = [
    // money / level-1 / xp offsets from anchor start
    { m: 13, l: 17, x: 21 },  // v2 layout — old block with NaN sentinel stripped
    { m: 8,  l: 12, x: 16 },  // fallback: shifted -5 if pad byte gone too
  ]
  for (const c of candidates) {
    if (looksLikeStats(v2 + c.m, v2 + c.l, v2 + c.x)) {
      return { money: v2 + c.m, level: v2 + c.l, xp: v2 + c.x, layout: 'v2' }
    }
  }
  return null
}

function _tailGarageStateOffset(tail) {
  // Rather than a fixed needle, find "paintshop" and then back up to see the count.
  const pidx = _bytesIndexOf(tail, _utf8enc.encode('paintshop'))
  if (pidx === -1) return -1

  // The byte before is the length (9). Before that is the count (uint32).
  const goff = pidx - 1 - 4
  if (goff < 0) return -1
  const view = new DataView(tail.buffer, tail.byteOffset)
  const count = view.getUint32(goff, true)

  let pos = goff + 4  // skip count uint32
  // Skip over all names (length-prefixed)
  for (let i = 0; i < count; i++) {
    const n = tail[pos]
    pos += 1 + n
  }
  pos += 4  // skip second count uint32
  return pos
}

function _tailSkillPointsOffset(tail) {
  const goff = _bytesIndexOf(tail, _GARAGE_NEEDLE)
  if (goff === -1) return -1
  return goff - 4
}

function _tailSkillsOffset(tail) {
  const idx = _bytesIndexOf(tail, _SKILL_NEEDLE)
  if (idx === -1) return -1
  return idx - 1 - 4  // back over the name-length byte and the count uint32
}

function _parseTailSkills(tail) {
  const startPos = _tailSkillsOffset(tail)
  if (startPos === -1) return []
  const view = new DataView(tail.buffer, tail.byteOffset)
  let pos    = startPos
  const count = view.getUint32(pos, true)
  pos += 4

  const names = []
  for (let i = 0; i < count; i++) {
    const [name, next] = _readStr8(tail, pos)
    names.push(name); pos = next
  }
  pos += 4  // skip count2

  return names.map(name => {
    const dataLen = view.getUint32(pos, true)
    const data    = tail.slice(pos + 4, pos + 4 + dataLen)
    pos += 4 + dataLen
    return {
      name,
      purchased: data.length > 0 ? Boolean(data[0]) : false,
      tiers:     data.length > 1 ? Array.from(data.slice(1), Boolean) : [],
    }
  })
}

function _encodeTailSkills(tail, skills) {
  const buf  = new Uint8Array(tail)  // copy
  const startPos = _tailSkillsOffset(buf)
  if (startPos === -1) return buf
  const view = new DataView(buf.buffer)
  let pos    = startPos
  const count = view.getUint32(pos, true)
  pos += 4

  const names = []
  for (let i = 0; i < count; i++) {
    const [name, next] = _readStr8(buf, pos)
    names.push(name); pos = next
  }
  pos += 4  // skip count2

  for (let i = 0; i < names.length; i++) {
    const dataLen = view.getUint32(pos, true)
    const s = i < skills.length ? skills[i] : null
    if (s !== null) {
      const newData = new Uint8Array([s.purchased ? 1 : 0, ...s.tiers.map(t => t ? 1 : 0)])
      const patched = new Uint8Array(dataLen)
      patched.set(newData.slice(0, dataLen))
      buf.set(patched, pos + 4)
    }
    pos += 4 + dataLen
  }
  return buf
}

// ── Public: top-level decode / encode ────────────────────────────────────────

/**
 * Decode a .cms21b ArrayBuffer into a save object.
 * Pass the object (unmodified) to applyEdits or encode.
 */
export function decode(arrayBuffer, onProgress) {
  const report = (pct, label) => onProgress?.(pct, label)

  report(5, 'Reading header…')
  const data = new Uint8Array(arrayBuffer)
  const [header, _hStart] = _parseHeader(data)

  /** Validate that a potential section header at `pos` is real.
   *  Returns { sectionName, count, partsStart } or null. */
  function _trySectionAt(pos) {
    if (pos + 5 >= data.length) return null
    const namelen = data[pos]
    if (namelen < 3 || namelen > 20) return null
    const nameEnd = pos + 1 + namelen
    if (nameEnd + 4 > data.length) return null
    // All name bytes must be printable ASCII
    for (let i = pos + 1; i < nameEnd; i++) {
      if (data[i] < 32 || data[i] >= 127) return null
    }
    const sectionName = _utf8dec.decode(data.slice(pos + 1, nameEnd))
    const view = new DataView(data.buffer, data.byteOffset)
    const count = view.getUint32(nameEnd, true)
    // Sanity: count can be 0 (empty inventory) but not absurdly large
    if (count > 5000) return null
    return { sectionName, count, partsStart: nameEnd + 4 }
  }

  // Compute rawStart independently — right after the profile name bytes,
  // before any 0xFF padding. This is where _parseHeader's own scan began.
  // We need to start here so we can encounter (and validate) every 0xFF block,
  // including the very first one that immediately precedes the parts section.
  const rawStart = 12 + data[11]   // 8(magic)+2(year)+1(month)+1(namelen) + namelen

  // Scan forward through all 0xFF padding blocks starting from rawStart.
  // The first block that leads to a valid section header is the parts section.
  let partsSections = []
  let pos = _hStart
  let scanPos = rawStart
  while (scanPos < data.length - 5) {
    if (data[scanPos] === 0xff) {
      // Skip the entire 0xFF run
      while (scanPos < data.length && data[scanPos] === 0xff) scanPos++
      const candidate = _trySectionAt(scanPos)
      if (candidate !== null) {
        // Found a valid section header — parse it
        report(10, 'Parsing parts…')
        const [section, nextPos] = _parsePartsSection(data, scanPos, report, 10, 65)
        if (section) {
          partsSections.push(section)
          pos = nextPos
        }
        break  // Only one inventory section per save
      }
      // Not a valid section — keep scanning (could be an embedded 0xFF byte in car data)
    } else {
      scanPos++
    }
  }

  // Fallback: nothing found, pos stays at _hStart (tail starts right after header)
  if (partsSections.length === 0) {
    pos = _hStart
  }

  report(70, 'Reading player stats…')
  const tailRaw = _bytesToHex(data.slice(pos))

  report(100, 'Done')
  return { header, parts_sections: partsSections, _tail_raw: tailRaw }
}

/**
 * Re-encode a (possibly modified) save object into a Uint8Array.
 */
export function encode(save) {
  return _concatBytes([
    _encodeHeader(save.header),
    ...save.parts_sections.map(_encodePartsSection),
    _hexToBytes(save._tail_raw),
  ])
}

// ── Public: derived data (mirrors server.py helpers) ─────────────────────────

export function parseStats(save) {
  const tail = _hexToBytes(save._tail_raw)
  const view = new DataView(tail.buffer)
  const offs = _tailStatsOffsets(tail)
  const spOff = _tailSkillPointsOffset(tail)
  const hasMLX = offs !== null
  const hasSP  = spOff !== -1 && spOff + 4 <= tail.length
  return {
    money:        hasMLX ? view.getUint32(offs.money, true) : 0,
    level:        hasMLX ? view.getUint32(offs.level, true) + 1 : 1,
    xp:           hasMLX ? view.getUint32(offs.xp,    true) : 0,
    skill_points: hasSP  ? view.getUint32(spOff,      true) : 0,
    _supports: {
      money: hasMLX,
      level: hasMLX,
      xp: hasMLX,
      skill_points: hasSP,
    },
    _layout: hasMLX ? offs.layout : null,
  }
}

export function parseGarage(save) {
  const tail = _hexToBytes(save._tail_raw)
  const base = _tailGarageStateOffset(tail)
  if (base === -1) return []
  return _GARAGE_NAMES.map((name, i) => {
    const off = base + i * 8
    const raw = Array.from(tail.slice(off, off + 8))
    return { name, state: raw[0] ?? 0, raw }
  })
}

export function parseSkills(save) {
  return _parseTailSkills(_hexToBytes(save._tail_raw))
}

export function flattenParts(save) {
  const out = []
  for (let si = 0; si < save.parts_sections.length; si++) {
    const sec = save.parts_sections[si]
    for (let pi = 0; pi < sec.parts.length; pi++) {
      const p = sec.parts[pi]
      out.push({
        sec_idx:       si,
        part_idx:      pi,
        name:          p.name,
        condition:     p.condition ?? null,
        quality:       p.quality   ?? null,
        has_condition: 'condition' in p,
      })
    }
  }
  return out
}

/**
 * Scan binary buffers for car sections and group them.
 * CM21 saves are sequential: car record followed by its components.
 */
export function parseCars(save) {
  const tail = _hexToBytes(save._tail_raw)
  
  const cars = []
  let currentCar = null
  
  const PART_PREFIXES = [
    'car_', 'window', 'mirror', 'door', 'trunk', 'hood', 'taillight', 'bumper', 'fender',
    'rim_', 'tire_', 'wheel_', 'suspension', 'piasta', 'tuleja', 'amortyzator',
    'tarcza', 'zacisk', 'klocki', 'wahacz', 'drazek', 'stabilizator', 'Engine'
  ]

  // Scan for 1-byte len + name strings
  for (let pos = 0; pos < tail.length - 60; pos++) {
     const len = tail[pos]
     if (len >= 3 && len <= 50) {
        const cand = tail.slice(pos + 1, pos + 1 + len)
        let isString = true
        for (let i = 0; i < cand.length; i++) {
           if (cand[i] < 32 || cand[i] >= 127) { isString = false; break; }
        }
        if (isString) {
           const name = _utf8dec.decode(cand)
           const lower = name.toLowerCase()
           const isPart = PART_PREFIXES.some(p => lower.startsWith(p.toLowerCase()))
           
           if (isPart || name.includes('/') || name.includes('(')) {
              const isMainCar = lower.startsWith('car_') && !name.includes('-') && !lower.includes('_wash') && name.split('_').length <= 2
              const isWash = lower === 'car_wash'

              if (isMainCar || isWash) {
                 currentCar = { name, parts: [], rawName: name }
                 cars.push(currentCar)
              } else if (currentCar) {
                 // Try to decode the block following the name
                 const dataStart = pos + 1 + len
                 const blockSize = _guessBlockSize(name)
                 if (dataStart + blockSize <= tail.length) {
                    const block = tail.slice(dataStart, dataStart + blockSize)
                    const decoded = _decodeBlock(name, block)
                    if (decoded.condition !== undefined && decoded.condition >= 0 && decoded.condition <= 1.0) {
                       currentCar.parts.push({
                          ...decoded,
                          offset: dataStart
                       })
                    }
                 }
              }
              pos += len // skip name bytes to avoid re-reading
           }
        }
     }
  }
  
  // Collapse duplicates and clean up
  return cars.map(c => ({
     name: c.name.replace(/^car_/, '').replace(/_/g, ' '),
     parts: c.parts,
     rawName: c.rawName
  }))
}

/**
 * Apply a set of edits to a save object and return the binary result.
 *
 * @param {object} save        - The save object from decode()
 * @param {object} edits
 * @param {object} [edits.stats]        - { money, level, xp, skill_points }
 * @param {Array}  [edits.partEdits]    - [{ sec_idx, part_idx, condition }]
 * @param {Array}  [edits.garageEdits]  - [{ idx, state }]
 * @param {Array}  [edits.skillEdits]   - [{ name, purchased, tiers }]
 * @returns {Uint8Array}
 */
export function applyEdits(save, { stats, partEdits = [], garageEdits = [], skillEdits = [], carPartEdits = [] } = {}, onProgress) {
  const report = (pct, label) => onProgress?.(pct, label)

  report(10, 'Preparing…')
  save = JSON.parse(JSON.stringify(save))  // deep clone — never mutate the original

  // ── Player stats ────────────────────────────────────────────────────────────
  if (stats) {
    report(30, 'Applying stats…')
    const tail = _hexToBytes(save._tail_raw)
    const view = new DataView(tail.buffer)
    const offs = _tailStatsOffsets(tail)
    if (offs) {
      if (stats.money !== undefined) view.setUint32(offs.money, stats.money, true)
      if (stats.level !== undefined) view.setUint32(offs.level, Math.max(0, stats.level - 1), true)
      if (stats.xp    !== undefined) view.setUint32(offs.xp,    stats.xp,    true)
    }
    const spOff = _tailSkillPointsOffset(tail)
    if (stats.skill_points !== undefined && spOff !== -1 && spOff + 4 <= tail.length) {
      view.setUint32(spOff, stats.skill_points, true)
    }
    save._tail_raw = _bytesToHex(tail)
  }

  // ── Part conditions ─────────────────────────────────────────────────────────
  report(50, 'Applying part edits…')
  for (const edit of partEdits) {
    save.parts_sections[edit.sec_idx].parts[edit.part_idx].condition =
      Math.max(0, Math.min(1, edit.condition))
  }

  // ── Garage state ────────────────────────────────────────────────────────────
  report(70, 'Applying garage edits…')
  if (garageEdits.length > 0) {
    const tail = _hexToBytes(save._tail_raw)
    const base = _tailGarageStateOffset(tail)
    if (base !== -1) {
      for (const edit of garageEdits) {
        const target = base + edit.idx * 8
        if (target >= 0 && target < tail.length) {
          tail[target] = Math.max(0, Math.min(255, edit.state))
        }
      }
      save._tail_raw = _bytesToHex(tail)
    }
  }

  // ── Skills ──────────────────────────────────────────────────────────────────
  report(85, 'Applying skill edits…')
  if (skillEdits.length > 0) {
    const tail    = _hexToBytes(save._tail_raw)
    const patched = _encodeTailSkills(tail, skillEdits)
    save._tail_raw = _bytesToHex(patched)
  }

  // ── Car Parts ───────────────────────────────────────────────────────────────
  if (carPartEdits.length > 0) {
    report(90, 'Applying car part edits…')
    const tail = _hexToBytes(save._tail_raw)
    const view = new DataView(tail.buffer)
    for (const edit of carPartEdits) {
       // Only patch condition at offset 9
       view.setFloat32(edit.offset + 9, Math.max(0, Math.min(1.0, edit.condition)), true)
    }
    save._tail_raw = _bytesToHex(tail)
  }

  report(95, 'Encoding…')
  const result = encode(save)
  report(100, 'Done')
  return result
}
