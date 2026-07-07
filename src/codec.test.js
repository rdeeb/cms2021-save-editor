import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { decode, encode, parseStats, parseGarage, parseSkills, flattenParts, parseCars, applyEdits } from './codec.js'

// Load profile1.cms21b from the repo root
const __dirname = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(__dirname, '../profile1.cms21b'))
const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)

// ─────────────────────────────────────────────────────────────────────────────

describe('decode — profile1.cms21b', () => {
  let save

  beforeAll(() => {
    save = decode(arrayBuffer)
  })

  // ── Header ──────────────────────────────────────────────────────────────────

  describe('header', () => {
    it('reads the correct magic', () => {
      expect(save.header.magic).toBe('PJOOOTER')
    })

    it('reads the profile name', () => {
      expect(save.header.profile_name).toBe('FreshStart')
    })

    it('reads the save year', () => {
      expect(save.header.save_year).toBe(2021)
    })

    it('reads the save month', () => {
      expect(save.header.save_month).toBe(5)
    })

    it('reads the game version', () => {
      expect(save.header.version).toBe('1.0.10w')
    })
  })

  // ── Stats ───────────────────────────────────────────────────────────────────

  describe('parseStats', () => {
    let stats

    beforeAll(() => {
      stats = parseStats(save)
    })

    it('reads money', () => {
      expect(stats.money).toBe(4000)
    })

    it('reads level (stored as level-1, returned as level)', () => {
      expect(stats.level).toBe(1)
    })

    it('reads xp', () => {
      expect(stats.xp).toBe(0)
    })

    it('reads skill_points', () => {
      expect(stats.skill_points).toBe(0)
    })
  })

  // ── Garage ──────────────────────────────────────────────────────────────────

  describe('parseGarage', () => {
    let garage

    beforeAll(() => {
      garage = parseGarage(save)
    })

    it('returns 23 garage items', () => {
      expect(garage).toHaveLength(23)
    })

    it('paintshop is tier 3 (fully upgraded)', () => {
      expect(garage[0]).toMatchObject({ name: 'paintshop', state: 3 })
    })

    it('scraps is locked', () => {
      expect(garage[1]).toMatchObject({ name: 'scraps', state: 0 })
    })

    it('path_test is unlocked', () => {
      expect(garage[4]).toMatchObject({ name: 'path_test', state: 1 })
    })

    it('each item has an 8-byte raw array', () => {
      garage.forEach(g => expect(g.raw).toHaveLength(8))
    })
  })

  // ── Skills ──────────────────────────────────────────────────────────────────

  describe('parseSkills', () => {
    let skills

    beforeAll(() => {
      skills = parseSkills(save)
    })

    it('returns an array of skills', () => {
      expect(skills.length).toBeGreaterThan(0)
    })

    it('first skill is fast_movement and is not purchased', () => {
      expect(skills[0]).toMatchObject({ name: 'fast_movement', purchased: false })
    })

    it('fast_movement has 5 tiers all false', () => {
      expect(skills[0].tiers).toEqual([false, false, false, false, false])
    })

    it('fix skill is not purchased', () => {
      expect(skills[1]).toMatchObject({ name: 'fix', purchased: false })
    })

    it('shop_discount has 2 tiers', () => {
      const sd = skills.find(s => s.name === 'shop_discount')
      expect(sd.tiers).toHaveLength(2)
    })
  })

  // ── Parts ───────────────────────────────────────────────────────────────────

  describe('flattenParts', () => {
    it('returns an array (0 parts on a fresh save)', () => {
      const parts = flattenParts(save)
      expect(Array.isArray(parts)).toBe(true)
      expect(parts).toHaveLength(0)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('encode — round-trip', () => {
  it('re-encodes to byte-identical output', () => {
    const save      = decode(arrayBuffer)
    const reencoded = encode(save)
    const original  = new Uint8Array(arrayBuffer)

    expect(reencoded).toHaveLength(original.length)
    expect(reencoded).toEqual(original)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('applyEdits', () => {
  it('round-trips with no edits', () => {
    const save      = decode(arrayBuffer)
    const result    = applyEdits(save, {})
    const original  = new Uint8Array(arrayBuffer)
    expect(result).toEqual(original)
  })

  it('sets money correctly', () => {
    const save   = decode(arrayBuffer)
    const result = applyEdits(save, { stats: { money: 999999, level: 1, xp: 0, skill_points: 0 } })
    const stats  = parseStats(decode(result.buffer))
    expect(stats.money).toBe(999999)
  })

  it('sets level correctly', () => {
    const save   = decode(arrayBuffer)
    const result = applyEdits(save, { stats: { money: 4000, level: 50, xp: 0, skill_points: 0 } })
    const stats  = parseStats(decode(result.buffer))
    expect(stats.level).toBe(50)
  })

  it('sets xp correctly', () => {
    const save   = decode(arrayBuffer)
    const result = applyEdits(save, { stats: { money: 4000, level: 1, xp: 12345, skill_points: 0 } })
    const stats  = parseStats(decode(result.buffer))
    expect(stats.xp).toBe(12345)
  })

  it('does not mutate the original save object', () => {
    const save   = decode(arrayBuffer)
    const before = save._tail_raw
    applyEdits(save, { stats: { money: 999999, level: 99, xp: 99999, skill_points: 99 } })
    expect(save._tail_raw).toBe(before)
  })

  it('unlocks a garage item', () => {
    const save   = decode(arrayBuffer)
    const result = applyEdits(save, { garageEdits: [{ idx: 1, state: 1 }] })
    const garage = parseGarage(decode(result.buffer))
    expect(garage[1].state).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('robustness — profile2.cms21b (complex car data)', () => {
  const p2raw = readFileSync(join(__dirname, '../profile2.cms21b'))
  const p2ab  = p2raw.buffer.slice(p2raw.byteOffset, p2raw.byteOffset + p2raw.byteLength)

  it('decodes without crashing', () => {
    const save = decode(p2ab)
    expect(save.header.profile_name).toBe('cms2021promo')
  })

  it('finds 0 inventory parts (correct for this file)', () => {
    const save = decode(p2ab)
    const parts = flattenParts(save)
    expect(parts).toHaveLength(0)
  })

  it('correctly parses stats near the end', () => {
    const save = decode(p2ab)
    const stats = parseStats(save)
    expect(stats.money).toBe(325212)
    expect(stats.level).toBe(36)
  })

  it('correctly parses skill status', () => {
    const save = decode(p2ab)
    const skills = parseSkills(save)
    // profile2 has all skills purchased
    skills.forEach(s => {
      expect(s.purchased).toBe(true)
      expect(s.tiers.every(t => t === true)).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('robustness — profile0.cms21b (inventory parts)', () => {
  const p0raw = readFileSync(join(__dirname, '../profile0.cms21b'))
  const p0ab  = p0raw.buffer.slice(p0raw.byteOffset, p0raw.byteOffset + p0raw.byteLength)

  it('decodes without crashing', () => {
    const save = decode(p0ab)
    expect(save.header.profile_name).toBe('rDeeb')
  })

  it('finds 67 inventory parts (correct for this file)', () => {
    const save = decode(p0ab)
    const parts = flattenParts(save)
    expect(parts).toHaveLength(67)
  })

  it('correctly parses stats (Money=22467, Level=8, XP=556)', () => {
    const save = decode(p0ab)
    const stats = parseStats(save)
    expect(stats.money).toBe(22467)
    expect(stats.level).toBe(8)
    expect(stats.xp).toBe(556)
  })
})

describe('parseCars', () => {
  const p2raw = readFileSync(join(__dirname, '../profile2.cms21b'))
  const p2ab  = p2raw.buffer.slice(p2raw.byteOffset, p2raw.byteOffset + p2raw.byteLength)

  it('finds cars and their parts with conditions', () => {
    const save = decode(p2ab)
    const cars = parseCars(save)
    expect(cars.length).toBeGreaterThan(0)
    
    // Check first car "Morena Bizzarini"
    const morena = cars[0]
    expect(morena.parts.length).toBeGreaterThan(0)
    
    const firstPart = morena.parts[0]
    expect(firstPart.name).toBeDefined()
    expect(firstPart.condition).toBeGreaterThanOrEqual(0)
    expect(firstPart.condition).toBeLessThanOrEqual(1)
    expect(firstPart.offset).toBeGreaterThan(0)
  })
})
