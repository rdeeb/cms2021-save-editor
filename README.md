# CMS21 Save Editor

> **Learning project** — This was built as a hands-on exercise to understand how binary file formats work: reading/writing little-endian integers, IEEE-754 floats, length-prefixed strings, and locating data by byte-pattern signatures rather than hardcoded offsets. The `.cms21b` save format made for a good real-world target since it's complex enough to be interesting but small enough to reverse-engineer without tooling.

A save-file editor for **Car Mechanic Simulator 2021** that runs entirely in your browser — no installation, no Python, no server.

> **Always back up your save files before editing.**
> Default save location on Windows:
> `%USERPROFILE%\AppData\LocalLow\Red Dot Games\Car Mechanic Simulator 2021\Saves\`

---

## Using the hosted version

The easiest way — just open the link, drag in your save, make edits, and download.

> [Online save editor](https://rdeeb.github.io/cms2021-save-editor/)

Your save file never leaves your computer. Everything is processed locally in the browser.

---

## Features

| Category | What you can edit |
|---|---|
| **Player stats** | Money (credits), level, XP, available skill points |
| **Skills** | Individual skill purchased/unlocked state, per-tier flags |
| **Garage upgrades** | Lock / unlock any of the 23 garage items (dyno, paint shop, OBD scanner, lifter, etc.) |
| **Parts** | Per-part condition (0–100%), bulk repair all worn parts |

---

## How to use

1. **Open** the editor in your browser.
2. **Drag and drop** your `.cms21b` save file onto the drop zone, or click **Browse file…** to pick it.
3. Edit what you want across the **Overview**, **Garage**, and **Parts** tabs.
4. Click **↓ Download .cms21b** to save the modified file.
5. **Copy the downloaded file** back to your saves folder, replacing the original.

---

## Save file location

| Platform | Path |
|---|---|
| Windows (Steam/Epic) | `%USERPROFILE%\AppData\LocalLow\Red Dot Games\Car Mechanic Simulator 2021\Saves\` |
| Windows (Xbox Game Pass) | `%LOCALAPPDATA%\Packages\RedDotGames.CarMechanicSimulator2021_h6vh6...\SystemAppData\wgs\` |
| Linux (Steam) | `~/.steam/steam/userdata/<id>/1190000/remote/` |

---

### Xbox Game Pass (PC) Specifics

The Game Pass version uses the **Windows Game Save (WGS)** system, which is different from the standard Steam version:

1. **Hash Filenames**: Files in the `wgs` folder have no extensions and use long hexadecimal names (e.g., `551DBD...`).
2. **Identification**: To find your save, look for the largest file (typically 8KB–30KB) in the most recently modified subfolder.
3. **Cloud Sync Override**: Xbox will often overwrite your modified file with the cloud version. To prevent this:
    - **Disconnect from the Internet**.
    - Replace the original hash file with your edited one (**Keep the original hash name!**).
    - Start the game while offline.
    - Once at the main menu, Reconnect to the Internet.
    - Make a small ingame change (e.g., move a car) to trigger a sync.
    - If prompted, choose **"Use Local Save"**.

---

Profiles are named `profile0.cms21b`, `profile1.cms21b`, etc.

---

## Running locally (developers)

You only need **Node.js 18+**. No Python required.

```bash
git clone https://github.com/your-username/cms2021-save-editor.git
cd cms2021-save-editor
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

### Building for production

```bash
npm run build
```

The `dist/` folder is a self-contained static site — host it anywhere (GitHub Pages, Netlify, Cloudflare Pages, etc.).

---

## Deploying to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**.
3. Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

Every push to `main` will automatically rebuild and publish the site.

---

## Project structure

```
cms2021-save-editor/
├── src/                        # React + Vite app sources
│   ├── codec.js                # Binary decoder / encoder (pure JS, no deps)
│   ├── codec.worker.js         # Web Worker wrapper for off-thread decode
│   ├── App.jsx                 # Main app — state, file handling, download
│   ├── App.css
│   ├── main.jsx
│   └── components/
│       ├── DropZone.jsx
│       ├── Overview.jsx
│       ├── Garage.jsx
│       ├── Parts.jsx
│       ├── Skills.jsx
│       ├── Cars.jsx
│       ├── Tooltip.jsx
│       └── DownloadModal.jsx
├── python-cli/                 # Legacy Python CLI (optional, see below)
│   ├── decode.py
│   └── editor.py
├── index.html
├── vite.config.js
└── package.json
```

> `python-cli/decode.py` and `python-cli/editor.py` are a legacy Python CLI for
> power users who prefer the command line. They are not needed to run the web
> app and currently lack the v1.0.39+ save format fixes that the JS codec has.

---

## Binary format notes

The `.cms21b` format uses little-endian integers, IEEE-754 floats, and length-prefixed UTF-8 strings (1-byte length + data). See `src/codec.js` for the full annotated implementation.

**File structure:**
```
Magic         8 bytes   "PJOOOTER"
Header block  variable  profile name, date, version, 0xff padding
Parts section variable  per-part binary records (47 / 63 / 64 bytes each)
Tail section  variable  skills, garage state, car records, player stats
```

**Key offsets in the tail section (all dynamic — located by byte-pattern search):**

| Field | How it's found |
|---|---|
| Stats block (money/level/XP) | Last occurrence of `5c fe ff ff 00 00 f0 41`, then +17 bytes |
| Money | stats_offset + 0, uint32 LE |
| Level | stats_offset + 4, uint32 LE, stored as `level - 1` |
| XP | stats_offset + 8, uint32 LE |
| Skill points | garage_offset − 4, uint32 LE |
| Garage section | First occurrence of `17 00 00 00 09 paintshop`; 23 items × 8 bytes; `byte[0]` = tier/purchase state |
| Skills section | First occurrence of `fast_movement`, back up to the preceding uint32 count |

---

## Contributing

Pull requests are welcome. If you discover new fields or format details, please document them in the PR description.

To run a round-trip sanity check in the browser console:

```js
import { decode, encode } from './src/codec.js'

const buf = await fetch('profile0.cms21b').then(r => r.arrayBuffer())
const save = decode(buf)
const reencoded = encode(save)
console.assert(
  new Uint8Array(buf).every((b, i) => b === reencoded[i]),
  'Round-trip mismatch!'
)
console.log('Round-trip OK')
```

---

## License

MIT — see `LICENSE` file.
