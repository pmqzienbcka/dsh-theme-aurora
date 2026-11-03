// Enumerates installed font families on Windows the way a native app does:
// walk the system and per-user font directories and read each sfnt `name`
// table. No dependency, no permission prompt — this runs in the Host process.
//
// Each entry keeps two names:
//   family — the name handed to CSS (`font-family`), preferring the English
//            family record that Chromium matches most reliably;
//   label  — the name shown in the picker, preferring a Chinese record, then a
//            Chinese file name, so Chinese fonts are not listed as "SSRouHei".
//            Any name record whose text carries CJK counts as a Chinese label,
//            including Mac-platform and non-zh-CN Windows language records.
import fs from 'node:fs'
import path from 'node:path'

const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x74746366]) // 1.0, 'true', 'OTTO', 'ttcf'
const CJK = /[\u3400-\u9fff]/

/** UTF-16BE (Windows) or Latin-1 (Mac) `name` record decoding. */
function decodeName(buf, platformId, offset, length) {
  const slice = buf.subarray(offset, offset + length)
  if (platformId === 3 || platformId === 0) {
    let out = ''
    for (let i = 0; i + 1 < slice.length; i += 2) out += String.fromCharCode(slice.readUInt16BE(i))
    return out
  }
  return slice.toString('latin1')
}

/**
 * Read the family and display names from one sfnt font file.
 * @param file - absolute path to a .ttf/.otf/.ttc file.
 * @returns `{ family, label }` pairs.
 */
export function readFontNames(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 12) return []
  const version = buf.readUInt32BE(0)
  if (!SFNT_VERSIONS.has(version)) return []

  const bases = []
  if (version === 0x74746366) {
    const count = Math.min(buf.readUInt32BE(8), 8)
    for (let i = 0; i < count; i += 1) {
      const at = 12 + i * 4
      if (at + 4 <= buf.length) bases.push(buf.readUInt32BE(at))
    }
  } else {
    bases.push(0)
  }

  const basename = path.basename(file, path.extname(file)).trim()
  const fileLabel = CJK.test(basename) ? basename : null
  const found = []

  for (const base of bases) {
    if (base + 12 > buf.length) continue
    const numTables = buf.readUInt16BE(base + 4)
    for (let t = 0; t < numTables; t += 1) {
      const rec = base + 12 + t * 16
      if (rec + 16 > buf.length) break
      if (buf.toString('latin1', rec, rec + 4) !== 'name') continue
      const table = buf.readUInt32BE(rec + 8)
      if (table + 6 > buf.length) continue
      const count = buf.readUInt16BE(table + 2)
      const strings = table + buf.readUInt16BE(table + 4)

      let enTypo = null
      let enFamily = null
      let enFull = null
      let mac = null
      let zhFamily = null
      let zhFull = null

      for (let r = 0; r < count; r += 1) {
        const at = table + 6 + r * 12
        if (at + 12 > buf.length) break
        const platformId = buf.readUInt16BE(at)
        const languageId = buf.readUInt16BE(at + 4)
        const nameId = buf.readUInt16BE(at + 6)
        const length = buf.readUInt16BE(at + 8)
        const offset = strings + buf.readUInt16BE(at + 10)
        if (offset + length > buf.length) continue
        if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue
        const text = decodeName(buf, platformId, offset, length).trim()
        if (text.length === 0) continue

        if (platformId === 3 && languageId === 0x0804) {
          if (nameId === 16) zhFamily = text
          else if (nameId === 1) zhFamily = zhFamily ?? text
          else if (nameId === 4) zhFull = zhFull ?? text
        } else if (platformId === 3 && languageId === 0x0409) {
          if (nameId === 16) enTypo = text
          else if (nameId === 1) enFamily = enFamily ?? text
          else if (nameId === 4) enFull = enFull ?? text
        } else if (platformId === 1 && mac === null && (nameId === 1 || nameId === 16)) {
          mac = text
        }
        // Any record carrying a Chinese name is a display candidate even when
        // it sits under a Mac or non-zh-CN Windows language id: many Chinese
        // fonts ship exactly one localized record and nothing else.
        if (CJK.test(text)) {
          if (nameId === 4) zhFull = zhFull ?? text
          else zhFamily = zhFamily ?? text
        }
      }

      const family = enTypo ?? enFamily ?? mac ?? zhFamily
      if (!family) break
      const label = zhFamily ?? zhFull ?? fileLabel ?? enFull ?? family
      found.push({ family, label })
      break
    }
  }
  return found
}

/**
 * Enumerate every installed font visible to this user, so that a font with a
 * Chinese display name sorts before the Latin ones.
 * @param env - environment carrying WINDIR and LOCALAPPDATA.
 * @returns sorted unique `{ family, label }` entries.
 */
export function listFonts(env = process.env) {
  const windir = env.WINDIR ?? 'C:\\Windows'
  const localAppData = env.LOCALAPPDATA ?? ''
  const dirs = [path.join(windir, 'Fonts')]
  if (localAppData) dirs.push(path.join(localAppData, 'Microsoft', 'Windows', 'Fonts'))

  /** @type {Map<string, { family: string, label: string }>} */
  const byFamily = new Map()
  for (const dir of dirs) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(ttf|otf|ttc)$/i.test(entry.name)) continue
      try {
        for (const name of readFontNames(path.join(dir, entry.name))) {
          const key = name.family.toLowerCase()
          const previous = byFamily.get(key)
          // Prefer the entry whose display label is Chinese.
          if (!previous || (!CJK.test(previous.label) && CJK.test(name.label))) byFamily.set(key, name)
        }
      } catch {
        // A malformed or locked font must not hide the rest of the list.
      }
    }
  }

  const all = [...byFamily.values()]
  const chinese = all.filter((item) => CJK.test(item.label)).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
  const latin = all.filter((item) => !CJK.test(item.label)).sort((a, b) => a.label.localeCompare(b.label, 'en'))
  return [...chinese, ...latin]
}
