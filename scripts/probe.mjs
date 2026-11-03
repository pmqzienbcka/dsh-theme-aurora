// Bundle probe: prints CSS tag ids, class maps and CSS rules matching a pattern.
import fs from 'node:fs'

const [file, mode, ...rest] = process.argv.slice(2)
const src = fs.readFileSync(file, 'utf8')

if (mode === 'tags') {
  const ids = [...src.matchAll(/data-plugin-css[^"']*["']([^"']+\.css)["']/g)].map((m) => m[1])
  console.log([...new Set(ids)].join('\n'))
} else if (mode === 'classes') {
  const map = {}
  for (const m of src.matchAll(/"([a-zA-Z][\w-]*)":\s*"([A-Za-z0-9]+_[A-Za-z][\w-]*)"/g)) {
    map[m[1]] = m[2]
  }
  const needle = rest[0]
  for (const [k, v] of Object.entries(map)) {
    if (!needle || v.includes(needle) || k.includes(needle)) console.log(`${k} -> ${v}`)
  }
} else if (mode === 'css') {
  const needle = new RegExp(rest[0], 'g')
  const seen = new Set()
  for (const m of src.matchAll(/const css(?:\$\d+)?\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    const css = JSON.parse('"' + m[1] + '"')
    for (const rule of css.split('}')) {
      if (needle.test(rule) && !seen.has(rule)) {
        seen.add(rule)
        console.log(rule.slice(0, 400))
      }
    }
  }
} else if (mode === 'module') {
  const name = rest[0]
  const at = src.indexOf(name)
  if (at < 0) {
    console.log('module not found')
    process.exit(1)
  }
  const start = src.lastIndexOf('const css', at)
  const eq = src.indexOf('"', src.indexOf('=', start))
  const end = src.indexOf('";', eq)
  const css = JSON.parse('"' + src.slice(eq + 1, end).replace(/\\"/g, '\\"') + '"')
  console.log(css.replace(/\}/g, '}\n'))
} else {
  console.log('usage: tags | classes [needle] | css <regex> | module <CssName>')
}
