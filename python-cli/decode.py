#!/usr/bin/env python3
"""
Car Mechanic Simulator 2021 (.cms21b) save file decoder/encoder.
Converts binary save <-> JSON for editing.

Usage:
  python decode.py profile0.cms21b          -> outputs profile0.json
  python decode.py profile0.json            -> outputs profile0.cms21b
"""

import struct
import json
import sys
from pathlib import Path


MAGIC = b'PJOOOTER'

# ─────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────

def _is_valid_part_name(s: str) -> bool:
    """Heuristic: a true part name is alphanumeric + underscore + hyphen,
    not a paint descriptor or licence-plate text."""
    if len(s) < 3:
        return False
    if not all(c.isalnum() or c in '_-' for c in s):
        return False  # rejects 'Standard[#000000]' (brackets)
    # Reject ALL-UPPERCASE+digits strings like 'DGR4D37'
    alpha = [c for c in s if c.isalpha()]
    if alpha and all(c.isupper() for c in alpha):
        return False
    return True


def _read_str8(data: bytes, pos: int):
    """Return (string, next_pos)."""
    n = data[pos]
    return data[pos+1:pos+1+n].decode('utf-8', errors='replace'), pos+1+n


def _find_next_entry(data: bytes, start: int) -> int:
    """Scan forward from *start* to find the offset of the next
    valid part-name length byte.  Returns -1 if not found."""
    for size in range(0, min(256, len(data) - start)):
        pos = start + size
        if pos >= len(data):
            break
        n = data[pos]
        if 2 <= n <= 60:
            end = pos + 1 + n
            if end <= len(data):
                cand = data[pos+1:end]
                if all(32 <= b < 127 for b in cand):
                    s = cand.decode('ascii', errors='replace')
                    if _is_valid_part_name(s):
                        return pos
    return -1


# ─────────────────────────────────────────────────────────────
#  Part entry field layout (offsets within binary block)
#
#  All known parts share at least 47 bytes:
#  [0..1]   uint16  part_id
#  [2..8]   7 bytes  unknown flags
#  [9..12]  float32 condition  (0.0=broken … 1.0=perfect)
#  [13..16] float32 quality
#  [17..20] uint32  flag
#  [21..38] 18 bytes unknown
#  [39..42] float32 extra
#  [43..46] 4 bytes tail
#
#  Body / rim parts append 16 more bytes of colour data.
# ─────────────────────────────────────────────────────────────

_STANDARD_SIZE = 47
_BODY_SIZE     = 63     # car_xxx, window, mirror, door…
_RIM_SIZE      = 64

_BODY_PART_PREFIXES = ('car_', 'window', 'mirror', 'door', 'trunk',
                       'hood', 'taillight', 'bumper', 'fender')
_RIM_PREFIXES       = ('rim_', 'tire_', 'wheel_')


def _guess_block_size(name: str) -> int:
    low = name.lower()
    if any(low.startswith(p) for p in _RIM_PREFIXES):
        return _RIM_SIZE
    if any(low.startswith(p) for p in _BODY_PART_PREFIXES):
        return _BODY_SIZE
    return _STANDARD_SIZE


def _decode_block(name: str, block: bytes) -> dict:
    """Decode known fields from binary block bytes."""
    n = len(block)
    entry = {
        'name': name,
        '_raw': block.hex(),
    }

    # Standard fields present in all blocks ≥ 47 bytes
    if n >= 47:
        entry['part_id']   = struct.unpack_from('<H', block, 0)[0]
        entry['condition'] = struct.unpack_from('<f', block, 9)[0]
        entry['quality']   = struct.unpack_from('<f', block, 13)[0]
        entry['flag']      = struct.unpack_from('<I', block, 17)[0]
        entry['extra']     = struct.unpack_from('<f', block, 39)[0]

    # Colour channels present in body/rim blocks ≥ 63 bytes
    if n >= 63:
        entry['paint'] = {
            'r': struct.unpack_from('<f', block, 47)[0],
            'g': struct.unpack_from('<f', block, 51)[0],
            'b': struct.unpack_from('<f', block, 55)[0],
            'a': struct.unpack_from('<f', block, 59)[0],
        }

    return entry


def _encode_block(entry: dict) -> bytes:
    """Rebuild binary block, patching editable fields back into _raw."""
    block = bytearray(bytes.fromhex(entry['_raw']))

    if len(block) >= 47 and 'condition' in entry:
        struct.pack_into('<f', block, 9,  entry['condition'])
    if len(block) >= 47 and 'quality' in entry:
        struct.pack_into('<f', block, 13, entry['quality'])
    if len(block) >= 47 and 'flag' in entry:
        struct.pack_into('<I', block, 17, entry['flag'])
    if len(block) >= 47 and 'extra' in entry:
        struct.pack_into('<f', block, 39, entry['extra'])

    if len(block) >= 63 and 'paint' in entry:
        p = entry['paint']
        struct.pack_into('<f', block, 47, p['r'])
        struct.pack_into('<f', block, 51, p['g'])
        struct.pack_into('<f', block, 55, p['b'])
        struct.pack_into('<f', block, 59, p['a'])

    return bytes(block)


# ─────────────────────────────────────────────────────────────
#  Parts section
# ─────────────────────────────────────────────────────────────

def parse_parts_section(data: bytes, start: int) -> tuple:
    """Parse one parts section.  Returns (section_dict, end_pos)."""
    pos = start
    sn_len = data[pos]
    section_name = data[pos+1:pos+1+sn_len].decode('utf-8', errors='replace')
    pos += 1 + sn_len

    count = struct.unpack_from('<I', data, pos)[0]
    pos += 4

    parts = []
    for i in range(count):
        # Read part name
        name_len = data[pos]
        name = data[pos+1:pos+1+name_len].decode('utf-8', errors='replace')
        pos += 1 + name_len

        data_start = pos

        # Determine binary block size.
        # Strategy: try the size we'd expect from the name first;
        # if the byte at that offset looks like the start of the next
        # valid entry, use it.  Otherwise scan dynamically.
        if i < count - 1:
            guessed = _guess_block_size(name)
            candidate = data_start + guessed
            # verify: is the byte at `candidate` a valid next-entry length?
            ok = False
            if candidate < len(data):
                n = data[candidate]
                if 2 <= n <= 60:
                    end = candidate + 1 + n
                    if end <= len(data):
                        cand_str = data[candidate+1:end]
                        if (all(32 <= b < 127 for b in cand_str) and
                                _is_valid_part_name(cand_str.decode('ascii','replace'))):
                            ok = True
            if not ok:
                # Fall back to dynamic scan
                next_off = _find_next_entry(data, data_start)
                guessed = next_off - data_start if next_off != -1 else guessed
            block_size = guessed
        else:
            # Last entry: scan for end-of-section or use heuristic
            block_size = _guess_block_size(name)
            # Try to confirm: scan for next valid-name string
            next_off = _find_next_entry(data, data_start + 1)
            if next_off != -1 and (next_off - data_start) in range(40, 150):
                block_size = next_off - data_start

        block = data[data_start:data_start + block_size]
        parts.append(_decode_block(name, block))
        pos = data_start + block_size

    return {'section_name': section_name, 'parts': parts}, pos


def encode_parts_section(section: dict) -> bytes:
    buf = bytearray()
    sn = section['section_name'].encode('utf-8')
    buf.append(len(sn))
    buf.extend(sn)
    buf.extend(struct.pack('<I', len(section['parts'])))
    for p in section['parts']:
        nm = p['name'].encode('utf-8')
        buf.append(len(nm))
        buf.extend(nm)
        buf.extend(_encode_block(p))
    return bytes(buf)


# ─────────────────────────────────────────────────────────────
#  Header  (magic + date + profile_name + raw bytes up through
#           the 0xff padding block that precedes the section)
# ─────────────────────────────────────────────────────────────

def parse_header(data: bytes) -> tuple:
    """Returns (header_dict, pos_of_section_start)."""
    assert data[:8] == MAGIC, f'Bad magic: {data[:8]!r}'
    year   = struct.unpack_from('<H', data, 8)[0]
    month  = data[10]
    nl     = data[11]
    name   = data[12:12+nl].decode('utf-8', errors='replace')
    pos    = 12 + nl

    raw_start = pos

    # Skip non-ff bytes, then skip all ff bytes
    while pos < len(data) and data[pos] != 0xff:
        pos += 1
    while pos < len(data) and data[pos] == 0xff:
        pos += 1

    header_raw = data[raw_start:pos]
    version    = _extract_version(header_raw)

    hdr = {
        'magic':        MAGIC.decode('ascii'),
        'save_year':    year,
        'save_month':   month,
        'profile_name': name,
        'version':      version,
        '_header_raw':  header_raw.hex(),
    }
    return hdr, pos


def _extract_version(raw: bytes) -> str:
    for i in range(len(raw) - 8):
        n = raw[i]
        if 3 <= n <= 16:
            b = raw[i+1:i+1+n]
            try:
                s = b.decode('ascii')
                stripped = s.rstrip('wWbB')
                parts = stripped.split('.')
                if len(parts) >= 2 and all(p.isdigit() for p in parts if p):
                    return s
            except Exception:
                pass
    return ''


def encode_header(hdr: dict) -> bytes:
    buf = bytearray()
    buf.extend(MAGIC)
    buf.extend(struct.pack('<H', hdr['save_year']))
    buf.append(hdr['save_month'])
    nm = hdr['profile_name'].encode('utf-8')
    buf.append(len(nm))
    buf.extend(nm)
    buf.extend(bytes.fromhex(hdr['_header_raw']))
    return bytes(buf)


# ─────────────────────────────────────────────────────────────
#  Top-level decode / encode
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
#  Tail section helpers  (dynamic-offset lookups)
#
#  The tail_raw blob is everything after the parts section.
#  Several sub-sections live at variable positions because the
#  content before them (car records, mission data) grows with
#  play.  We locate each section by searching for unique byte
#  signatures rather than using hard-coded offsets.
# ─────────────────────────────────────────────────────────────

# Signature: last IEEE-754 NaN sentinel (5c fe ff ff) followed
# immediately by float32(30.0).  Appears once per save right
# before the player-stats block.
_STATS_ANCHOR = b'\x5c\xfe\xff\xff\x00\x00\xf0\x41'

# Unique prefix of the garage items list: uint32(23) + str8 "paintshop"
_GARAGE_NEEDLE = b'\x17\x00\x00\x00\x09paintshop'

# First skill name is always "fast_movement"
_SKILL_NEEDLE  = b'fast_movement'

# Ordered list of garage item names (and their byte lengths) –
# used to skip past the name strings when computing the state offset.
_GARAGE_NAMES = [
    'paintshop','scraps','dyno','warehouse','path_test','car_wash',
    'unlock_tablet','unlock_obd','unlock_fuel','unlock_electronic',
    'garage_upgrade','garage_customization','lifter','unlock_cylinder',
    'unlock_tires','brake_lathe','repair_parts','welder','battery',
    'crane','repair_body','bus_upgrade','windowtint',
]


def tail_stats_offset(tail: bytes) -> int:
    """Return byte offset of money within tail_raw (uint32 LE).
    Level is at +4 (stored as level-1), XP is at +8."""
    idx = tail.rfind(_STATS_ANCHOR)
    if idx == -1:
        raise ValueError('Stats anchor not found – unexpected save format')
    return idx + 17   # anchor(8) + float(4) + float(4) + 1 pad byte


def tail_garage_state_offset(tail: bytes) -> int:
    """Return offset of the first 8-byte garage state record in tail_raw."""
    goff = tail.find(_GARAGE_NEEDLE)
    if goff == -1:
        raise ValueError('Garage section not found in tail')
    pos = goff + 4              # skip count uint32
    for name in _GARAGE_NAMES:
        pos += 1 + len(name)   # skip length-byte + name bytes
    pos += 4                    # skip second count uint32
    return pos


def tail_skill_points_offset(tail: bytes) -> int:
    """Return offset of the skill-points-available uint32 in tail_raw.
    This value sits immediately before the garage items count."""
    goff = tail.find(_GARAGE_NEEDLE)
    if goff == -1:
        raise ValueError('Garage section not found in tail')
    return goff - 4


def tail_skills_offset(tail: bytes) -> int:
    """Return offset of the skills-count uint32 in tail_raw."""
    idx = tail.find(_SKILL_NEEDLE)
    if idx == -1:
        raise ValueError('Skills section not found in tail')
    return idx - 1 - 4   # back over the name-length byte and the count uint32


def parse_tail_skills(tail: bytes) -> list[dict]:
    """Parse the skills section and return a list of skill dicts.

    Each dict:  { name, purchased, tiers: [bool, …] }

    Record encoding (variable-length):
      uint32  data_len   – number of data bytes that follow
      byte[0]            – 1 if the skill is purchased, else 0
      byte[1..data_len-1] – one byte per tier slot (1 = that tier bought)
    """
    pos = tail_skills_offset(tail)
    count = struct.unpack_from('<I', tail, pos)[0]
    pos += 4
    names = []
    for _ in range(count):
        n = tail[pos]
        names.append(tail[pos+1:pos+1+n].decode('utf-8', errors='replace'))
        pos += 1 + n
    _count2 = struct.unpack_from('<I', tail, pos)[0]
    pos += 4
    skills = []
    for name in names:
        data_len = struct.unpack_from('<I', tail, pos)[0]
        data     = tail[pos+4:pos+4+data_len]
        pos += 4 + data_len
        purchased = bool(data[0]) if data else False
        tiers     = [bool(b) for b in data[1:]] if len(data) > 1 else []
        skills.append({'name': name, 'purchased': purchased, 'tiers': tiers})
    return skills


def encode_tail_skills(tail: bytes, skills: list[dict]) -> bytes:
    """Patch skill data back into tail_raw bytes.
    *skills* must be in the same order / length as the original."""
    buf = bytearray(tail)
    pos = tail_skills_offset(buf)
    count = struct.unpack_from('<I', buf, pos)[0]
    pos += 4
    names = []
    for _ in range(count):
        n = buf[pos]
        names.append(buf[pos+1:pos+1+n].decode('utf-8', errors='replace'))
        pos += 1 + n
    pos += 4   # skip count2
    for i, name in enumerate(names):
        data_len = struct.unpack_from('<I', buf, pos)[0]
        s = skills[i] if i < len(skills) else None
        if s is not None:
            new_data = bytes([1 if s['purchased'] else 0] +
                             [1 if t else 0 for t in s['tiers']])
            # data_len is fixed per slot; zero-pad / truncate to match
            new_data = new_data[:data_len].ljust(data_len, b'\x00')
            buf[pos+4:pos+4+data_len] = new_data
        pos += 4 + data_len
    return bytes(buf)


def decode(filepath: str) -> dict:
    data = Path(filepath).read_bytes()

    result = {}
    result['header'], section_start = parse_header(data)

    result['parts_sections'] = []
    pos = section_start
    if pos < len(data):
        section, pos = parse_parts_section(data, pos)
        result['parts_sections'].append(section)

    result['_tail_raw'] = data[pos:].hex()
    return result


def encode(save: dict) -> bytes:
    buf = bytearray()
    buf.extend(encode_header(save['header']))
    for section in save['parts_sections']:
        buf.extend(encode_parts_section(section))
    buf.extend(bytes.fromhex(save['_tail_raw']))
    return bytes(buf)


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = Path(sys.argv[1])

    if src.suffix.lower() == '.json':
        save = json.loads(src.read_text(encoding='utf-8'))
        out = src.with_suffix('.cms21b')
        out.write_bytes(encode(save))
        print(f'Written {out}  ({out.stat().st_size} bytes)')

    else:
        save = decode(str(src))
        out = src.with_suffix('.json')
        out.write_text(json.dumps(save, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'Written {out}')

        for sec in save['parts_sections']:
            parts = sec['parts']
            worn = [p for p in parts if 'condition' in p and p['condition'] < 0.5]
            print(f"  Section '{sec['section_name']}': {len(parts)} parts, "
                  f"{len(worn)} worn (<50%)")
            for p in worn[:8]:
                print(f"    {p['name']:<40}  {p['condition']*100:.1f}%")
            if len(worn) > 8:
                print(f"    … and {len(worn)-8} more")


if __name__ == '__main__':
    main()
