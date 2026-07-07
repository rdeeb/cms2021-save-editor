#!/usr/bin/env python3
"""
CMS21 Save Editor -- interactive CLI

Usage:
  python editor.py profile0.cms21b
"""

import json
import struct
import sys
from pathlib import Path
from decode import decode, encode, tail_stats_offset, tail_skill_points_offset


def _bar(v: float, width: int = 20) -> str:
    filled = round(v * width)
    return '[' + '#' * filled + '.' * (width - filled) + ']'


def _pct(v: float) -> str:
    return f'{v * 100:5.1f}%'


def list_parts(parts: list, filter_worn: bool = False) -> None:
    print(f"\n{'#':>3}  {'Name':<42} {'Cond':>6}  Bar")
    print('-' * 78)
    for i, p in enumerate(parts):
        if 'condition' not in p:
            continue
        c = p['condition']
        if filter_worn and c >= 0.5:
            continue
        bar = _bar(c)
        print(f"{i+1:>3}. {p['name']:<42} {_pct(c)}  {bar}")


def repair_all(parts: list) -> int:
    count = 0
    for p in parts:
        if 'condition' in p and p['condition'] < 1.0:
            p['condition'] = 1.0
            count += 1
    return count


def repair_one(parts: list, idx: int) -> bool:
    p = parts[idx]
    if 'condition' not in p:
        print(f'  Part #{idx+1} ({p["name"]}) has no condition field.')
        return False
    old = p['condition']
    p['condition'] = 1.0
    print(f'  Repaired {p["name"]}: {_pct(old)} -> 100.0%')
    return True


def set_condition(parts: list, idx: int, value: float) -> bool:
    p = parts[idx]
    if 'condition' not in p:
        print(f'  Part #{idx+1} ({p["name"]}) has no condition field.')
        return False
    old = p['condition']
    p['condition'] = max(0.0, min(1.0, value))
    print(f'  {p["name"]}: {_pct(old)} -> {_pct(p["condition"])}')
    return True


def show_header(hdr: dict) -> None:
    print(f"\n  Profile : {hdr['profile_name']}")
    print(f"  Save date: {hdr['save_year']}-{hdr['save_month']:02d}")
    print(f"  Version  : {hdr['version']}")


# -- Player stats helpers ----------------------------------------------------

def _tail_u32(tail: bytes, off: int) -> int:
    return struct.unpack_from('<I', tail, off)[0]


def _tail_set_u32(save: dict, off: int, value: int) -> None:
    raw = bytearray(bytes.fromhex(save['_tail_raw']))
    struct.pack_into('<I', raw, off, value)
    save['_tail_raw'] = raw.hex()


def show_stats(save: dict) -> None:
    tail = bytes.fromhex(save['_tail_raw'])
    off  = tail_stats_offset(tail)
    money = _tail_u32(tail, off)
    level = _tail_u32(tail, off + 4) + 1
    xp    = _tail_u32(tail, off + 8)
    sp    = _tail_u32(tail, tail_skill_points_offset(tail))
    print(f"\n  Money        : {money:,} credits")
    print(f"  Level        : {level}")
    print(f"  XP           : {xp}")
    print(f"  Skill points : {sp}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    filepath = Path(sys.argv[1])
    if not filepath.exists():
        print(f'File not found: {filepath}')
        sys.exit(1)

    print(f'\nLoading {filepath} ...')
    save = decode(str(filepath))
    dirty = False

    parts = []
    for sec in save['parts_sections']:
        parts.extend(sec['parts'])

    show_header(save['header'])
    show_stats(save)
    worn = [p for p in parts if 'condition' in p and p['condition'] < 1.0]
    print(f"\n  Total parts : {len(parts)}")
    print(f"  Worn parts  : {len(worn)}")

    HELP = """
Commands:
  list            -- list all parts with condition
  worn            -- list only worn parts (<100%)
  repair all      -- set all parts to 100% condition
  repair <n>      -- repair part #n
  set <n> <0-100> -- set part #n condition to given %
  stats           -- show money / level / XP / skill points
  money <n>       -- set credits to n
  level <n>       -- set player level to n
  xp <n>          -- set current XP to n
  header          -- show save file info
  save            -- overwrite the .cms21b file
  save <path>     -- save to a different file
  json            -- write a .json copy for manual editing
  quit / exit
"""

    print(HELP)

    while True:
        try:
            line = input('> ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line:
            continue

        tokens = line.split()
        cmd = tokens[0].lower()

        if cmd in ('quit', 'exit', 'q'):
            break

        elif cmd == 'help':
            print(HELP)

        elif cmd == 'header':
            show_header(save['header'])

        elif cmd == 'list':
            list_parts(parts, filter_worn=False)

        elif cmd == 'worn':
            list_parts(parts, filter_worn=True)

        elif cmd == 'repair':
            if len(tokens) < 2:
                print('  Usage: repair all  or  repair <n>')
            elif tokens[1].lower() == 'all':
                n = repair_all(parts)
                print(f'  Repaired {n} parts.')
                dirty = True
            else:
                try:
                    idx = int(tokens[1]) - 1
                    if 0 <= idx < len(parts):
                        if repair_one(parts, idx):
                            dirty = True
                    else:
                        print(f'  Index out of range (1-{len(parts)})')
                except ValueError:
                    print('  Invalid part number.')

        elif cmd == 'set':
            if len(tokens) < 3:
                print('  Usage: set <n> <0-100>')
            else:
                try:
                    idx = int(tokens[1]) - 1
                    val = float(tokens[2]) / 100.0
                    if 0 <= idx < len(parts):
                        if set_condition(parts, idx, val):
                            dirty = True
                    else:
                        print(f'  Index out of range (1-{len(parts)})')
                except ValueError:
                    print('  Invalid number.')

        elif cmd == 'stats':
            show_stats(save)

        elif cmd == 'money':
            if len(tokens) < 2:
                print('  Usage: money <n>')
            else:
                try:
                    val = int(tokens[1])
                    if val < 0:
                        raise ValueError
                    tail = bytes.fromhex(save['_tail_raw'])
                    off  = tail_stats_offset(tail)
                    old  = _tail_u32(tail, off)
                    _tail_set_u32(save, off, val)
                    print(f'  Money: {old:,} -> {val:,}')
                    dirty = True
                except ValueError:
                    print('  Invalid amount (must be non-negative integer).')

        elif cmd == 'level':
            if len(tokens) < 2:
                print('  Usage: level <n>')
            else:
                try:
                    val = int(tokens[1])
                    if val < 1:
                        raise ValueError
                    tail = bytes.fromhex(save['_tail_raw'])
                    off  = tail_stats_offset(tail)
                    old  = _tail_u32(tail, off + 4) + 1
                    _tail_set_u32(save, off + 4, val - 1)
                    print(f'  Level: {old} -> {val}')
                    dirty = True
                except ValueError:
                    print('  Invalid level (must be >= 1).')

        elif cmd == 'xp':
            if len(tokens) < 2:
                print('  Usage: xp <n>')
            else:
                try:
                    val = int(tokens[1])
                    if val < 0:
                        raise ValueError
                    tail = bytes.fromhex(save['_tail_raw'])
                    off  = tail_stats_offset(tail)
                    old  = _tail_u32(tail, off + 8)
                    _tail_set_u32(save, off + 8, val)
                    print(f'  XP: {old} -> {val}')
                    dirty = True
                except ValueError:
                    print('  Invalid XP (must be non-negative integer).')

        elif cmd == 'save':
            out = Path(tokens[1]) if len(tokens) > 1 else filepath
            out.write_bytes(encode(save))
            print(f'  Saved to {out}  ({out.stat().st_size} bytes)')
            dirty = False

        elif cmd == 'json':
            out = filepath.with_suffix('.json')
            out.write_text(json.dumps(save, indent=2, ensure_ascii=False), encoding='utf-8')
            print(f'  Written {out}')

        else:
            print(f'  Unknown command: {cmd!r}  (type "help")')

    if dirty:
        ans = input('\n  Unsaved changes. Save now? [y/N] ').strip().lower()
        if ans == 'y':
            filepath.write_bytes(encode(save))
            print(f'  Saved to {filepath}')


if __name__ == '__main__':
    main()
