// Minimal read-only asar inspector: parses the Electron asar header and can
// list entries or extract single files. No third-party dependency.
import fs from 'node:fs'
import path from 'node:path'

const ASAR = 'E:\\DSH NEXT\\resources\\app.asar'

function readHeader(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const first = head.readUInt32LE(0)
    const pickleSize = head.readUInt32LE(4)
    let jsonLen = head.readUInt32LE(8)
    let jsonStart = 12
    let text = head.subarray(jsonStart, jsonStart + Math.min(jsonLen, 16)).toString('utf8')
    if (!text.trimStart().startsWith('{')) {
      // Archived padding variant: JSON begins at offset 8 + own size field.
      jsonLen = head.readUInt32LE(12)
      jsonStart = 16
    }
    const json = Buffer.alloc(jsonLen)
    fs.readSync(fd, json, 0, jsonLen, jsonStart)
    const header = JSON.parse(json.toString('utf8'))
    const dataOffset = 8 + pickleSize - 4
    return { fd, header, dataOffset, first, pickleSize, jsonLen }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const key = prefix ? `${prefix}/${name}` : name
    if (child.files) walk(child, key, out)
    else out.push({ path: key, size: child.size ?? 0, offset: child.offset })
  }
}

const { fd, header, dataOffset } = readHeader(ASAR)
const files = []
walk(header, '', files)

const [mode, ...rest] = process.argv.slice(2)
if (mode === 'list') {
  const prefix = (rest[0] ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  const hits = files.filter((f) => f.path.startsWith(prefix)).slice(0, 400)
  for (const f of hits) console.log(`${f.size}\t${f.path}`)
  console.log(`-- ${hits.length} shown / ${files.filter((f) => f.path.startsWith(prefix)).length} total`)
} else if (mode === 'find') {
  const needle = (rest[0] ?? '').toLowerCase()
  const hits = files.filter((f) => f.path.toLowerCase().includes(needle))
  for (const f of hits.slice(0, 400)) console.log(`${f.size}\t${f.path}`)
  console.log(`-- ${hits.length} matches`)
} else if (mode === 'extract') {
  const target = rest[0].replace(/\\/g, '/')
  const out = rest[1]
  const entry = files.find((f) => f.path === target)
  if (!entry) {
    console.error(`not in asar: ${target}`)
    process.exit(2)
  }
  const payload = Buffer.alloc(entry.size)
  fs.readSync(fd, payload, 0, entry.size, dataOffset + Number(entry.offset))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, payload)
  console.log(`wrote ${out} (${entry.size} bytes)`)
} else {
  console.log('usage: list <prefix> | find <substring> | extract <asarPath> <outPath>')
}
fs.closeSync(fd)
