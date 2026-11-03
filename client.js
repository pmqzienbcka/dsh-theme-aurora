/**
 * Client half of the Aurora theme bundle.
 *
 * Owns everything visual:
 *   - a generated stylesheet that repaints the layout columns with the user's
 *     background images, tint, opacity, fonts and (later) glass and radius;
 *   - a "主题外观" page registered into `settings.section`.
 *
 * The layout columns are discovered at runtime: their CSS-module class hashes
 * change on every build, so the prefix is read from the layout plugin's own
 * injected stylesheet instead of being hard-coded.
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-aurora',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /* ------------------------------------------------------------------ */
    /* Config                                                              */
    /* ------------------------------------------------------------------ */

    const CONFIG_KEY = 'dsh.aurora.theme.v1'
    const DB_NAME = 'dsh-aurora-theme'
    const DB_STORE = 'images'

    const MODES = {
      fill: { label: '填充', size: 'cover', repeat: 'no-repeat' },
      fit: { label: '适应', size: 'contain', repeat: 'no-repeat' },
      stretch: { label: '拉伸', size: '100% 100%', repeat: 'no-repeat' },
      tile: { label: '平铺', size: 'auto', repeat: 'repeat' },
      center: { label: '居中', size: 'auto', repeat: 'no-repeat' },
    }

    const TINTS = [
      { id: 'auto', label: '自动取色', rgb: null },
      { id: 'ink', label: '墨黑', rgb: [10, 12, 18] },
      { id: 'ocean', label: '深海蓝', rgb: [40, 62, 108] },
      { id: 'dusk', label: '暮光紫', rgb: [74, 58, 112] },
      { id: 'aurora', label: '极光青', rgb: [46, 118, 112] },
      { id: 'ember', label: '暖沙', rgb: [122, 92, 62] },
      { id: 'paper', label: '米白', rgb: [226, 220, 208] },
    ]

    const TEXT_COLORS = [
      { value: '', label: '默认' },
      { value: '#e8f0ff', label: '月白' },
      { value: '#ffffff', label: '纯白' },
      { value: '#a9b6cc', label: '银灰' },
      { value: '#4de3c1', label: '极光青' },
      { value: '#ffcf8f', label: '暖黄' },
      { value: '#1a1c22', label: '墨黑' },
    ]

    const FONT_FALLBACK = [
      'Microsoft YaHei',
      '微软雅黑',
      'Segoe UI',
      '等线',
      '宋体',
      '黑体',
      '楷体',
      '仿宋',
      'Arial',
      'Consolas',
      'Times New Roman',
      'Courier New',
    ]

    function surfaceDefaults() {
      return { mode: 'fill', opacity: 25, tint: 'auto', blur: 0 }
    }

    function glassDefaults() {
      return { enabled: false, blur: 16 }
    }

    /** One freely placed picture: position in viewport px plus a width scale. */
    function placementDefaults(id) {
      return { id, x: 120, y: 120, scale: 100 }
    }

    function defaults() {
      return {
        v: 1,
        enabled: true,
        center: surfaceDefaults(),
        sidebar: surfaceDefaults(),
        text: { family: '', size: 0, color: '' },
        glass: { sidebar: glassDefaults(), header: glassDefaults() },
        radius: { scale: 100 },
        placements: [],
      }
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    function sanitize(raw) {
      const base = defaults()
      if (!raw || typeof raw !== 'object') return base
      const out = base
      out.enabled = raw.enabled !== false
      for (const key of ['center', 'sidebar']) {
        const src = raw[key] && typeof raw[key] === 'object' ? raw[key] : {}
        out[key] = {
          mode: MODES[src.mode] ? src.mode : base[key].mode,
          opacity: Number.isFinite(src.opacity) ? clamp(Math.round(src.opacity), 0, 100) : base[key].opacity,
          tint: TINTS.some((t) => t.id === src.tint) ? src.tint : base[key].tint,
          blur: Number.isFinite(src.blur) ? clamp(Math.round(src.blur), 0, 40) : 0,
        }
      }
      const text = raw.text && typeof raw.text === 'object' ? raw.text : {}
      out.text = {
        family: typeof text.family === 'string' ? text.family : '',
        size: Number.isFinite(text.size) ? clamp(Math.round(text.size), 0, 32) : 0,
        color: typeof text.color === 'string' ? text.color : '',
      }
      const glass = raw.glass && typeof raw.glass === 'object' ? raw.glass : {}
      for (const key of ['sidebar', 'header']) {
        const src = glass[key] && typeof glass[key] === 'object' ? glass[key] : {}
        out.glass[key] = {
          enabled: src.enabled === true,
          blur: Number.isFinite(src.blur) ? clamp(Math.round(src.blur), 0, 40) : 16,
        }
      }
      const radius = raw.radius && typeof raw.radius === 'object' ? raw.radius : {}
      out.radius = {
        scale: Number.isFinite(radius.scale) ? clamp(Math.round(radius.scale), 40, 200) : 100,
      }
      const placements = Array.isArray(raw.placements) ? raw.placements : []
      out.placements = placements
        .filter((item) => item && typeof item.id === 'string' && item.id.length > 0)
        .slice(0, 24)
        .map((item) => ({
          id: item.id,
          x: Number.isFinite(item.x) ? Math.round(item.x) : 120,
          y: Number.isFinite(item.y) ? Math.round(item.y) : 120,
          scale: Number.isFinite(item.scale) ? clamp(Math.round(item.scale), 10, 400) : 100,
        }))
      return out
    }

    function loadConfig() {
      try {
        const raw = window.localStorage.getItem(CONFIG_KEY)
        return sanitize(raw ? JSON.parse(raw) : null)
      } catch {
        return defaults()
      }
    }

    function saveConfig(config) {
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      } catch {
        /* storage full or blocked: the session keeps the in-memory value */
      }
    }

    /* ------------------------------------------------------------------ */
    /* Image storage (IndexedDB, original bytes)                           */
    /* ------------------------------------------------------------------ */

    function openDb() {
      return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    async function readImage(key) {
      try {
        const db = await openDb()
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readonly')
          const request = tx.objectStore(DB_STORE).get(key)
          request.onsuccess = () => resolve(request.result ?? null)
          request.onerror = () => reject(request.error)
        })
      } catch {
        return null
      }
    }

    async function writeImage(key, blob) {
      try {
        const db = await openDb()
        await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readwrite')
          tx.objectStore(DB_STORE).put(blob, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } catch {
        /* ignore: the preview still works for this session */
      }
    }

    async function deleteImage(key) {
      try {
        const db = await openDb()
        await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readwrite')
          tx.objectStore(DB_STORE).delete(key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } catch {
        /* ignore */
      }
    }

    /**
     * Keep the original bytes, and derive a screen-sized copy for rendering.
     * A 40 MB / 8000 px image is fine on disk but a 256 MB decode on the GPU
     * thread; the display copy caps that at a couple of thousand pixels, which
     * is above what the viewport can show anyway.
     */
    const MAX_RENDER_SIDE = 3840

    /**
     * Scale for the display copy: never below what `cover` needs to fill the
     * viewport, never above 1, and capped at MAX_RENDER_SIDE on the long edge.
     * Capping by the long edge alone made portrait images render at a few
     * hundred pixels wide and then blow up 4x under `cover` — that read as
     * "blurry at 1px".
     */
    function renderScale(width, height) {
      const dpr = window.devicePixelRatio || 1
      const cover = Math.max((window.innerWidth * dpr) / width, (window.innerHeight * dpr) / height)
      const cap = Math.min(1, MAX_RENDER_SIDE / Math.max(width, height))
      return Math.min(1, Math.max(cap, cover))
    }

    async function prepareImage(blob) {
      const source = await createImageBitmap(blob)
      const width = source.width
      const height = source.height
      const scale = renderScale(width, height)
      let render = blob
      if (scale < 0.995) {
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        try {
          // Halve repeatedly instead of one 5x jump: a single naive resample
          // from a huge source loses far more detail than the target size does.
          let current = source
          let currentWidth = width
          let currentHeight = height
          while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
            const half = new OffscreenCanvas(Math.round(currentWidth / 2), Math.round(currentHeight / 2))
            const halfContext = half.getContext('2d')
            halfContext.imageSmoothingEnabled = true
            halfContext.imageSmoothingQuality = 'high'
            halfContext.drawImage(current, 0, 0, half.width, half.height)
            const bitmap = await createImageBitmap(half)
            if (current !== source) current.close?.()
            current = bitmap
            currentWidth = half.width
            currentHeight = half.height
          }
          const canvas = new OffscreenCanvas(targetWidth, targetHeight)
          const context = canvas.getContext('2d')
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          context.drawImage(current, 0, 0, targetWidth, targetHeight)
          if (current !== source) current.close?.()
          render = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 })
        } catch {
          render = blob
        }
      }
      source.close?.()
      if (!(render instanceof Blob)) render = blob
      return { original: blob, render, width, height, v: 3 }
    }

    function megabytes(bytes) {
      if (!bytes) return ''
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    }

    function describeImage(record) {
      if (!record) return ''
      const scaled = record.render && record.render !== record.original
      const head = record.width + '×' + record.height
      const size = megabytes(record.original?.size)
      return size ? head + ' · ' + size + (scaled ? ' · 显示用副本' : '') : head
    }

    /* ------------------------------------------------------------------ */
    /* Store                                                               */
    /* ------------------------------------------------------------------ */

    /** Image slots for the two background surfaces. */
    const IMAGE_KEYS = ['center', 'sidebar']
    const SURFACE_KEYS = ['center', 'sidebar']

    const store = {
      config: loadConfig(),
      blobs: { center: null, sidebar: null },
      urls: { center: '', sidebar: '' },
      /** Freely placed pictures, keyed by placement id. */
      placements: {},
      /** True while the arrange mode is on; never persisted. */
      editing: false,
      listeners: new Set(),
      notify() {
        for (const listener of this.listeners) listener()
      },
    }

    function useStoreVersion() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((n) => n + 1)
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      }, [])
    }

    function releaseUrls() {
      for (const key of IMAGE_KEYS) {
        const record = store.blobs[key]
        if (record && record.url) {
          URL.revokeObjectURL(record.url)
          record.url = ''
        }
        if (record && record.blurUrl) {
          URL.revokeObjectURL(record.blurUrl)
          record.blurUrl = ''
        }
        store.urls[key] = ''
      }
    }

    /** A record is usable only when one of its image parts is a real Blob. */
    function imageBlobOf(record) {
      if (!record || typeof record !== 'object') return null
      if (record.render instanceof Blob) return record.render
      if (record.original instanceof Blob) return record.original
      // Records written by an earlier revision are bare blobs.
      if (record instanceof Blob) return record
      return null
    }

    /** Bake a blurred copy of the display image; CSS blur would hit the text. */
    async function blurBlob(blob, px) {
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      context.filter = 'blur(' + px + 'px)'
      context.drawImage(bitmap, 0, 0)
      bitmap.close?.()
      return canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    }

    /**
     * Blur actually applied to a surface's picture. With a sidebar image the
     * picture is painted *on* the column, so a `backdrop-filter` has nothing
     * behind it to blur; folding the glass radius into the image bake gives the
     * frosted result while keeping the text sharp.
     */
    function effectiveBlur(key) {
      const base = store.config[key]?.blur ?? 0
      const glass = key === 'sidebar' ? store.config.glass?.sidebar : null
      return glass?.enabled ? Math.max(base, glass.blur || 0) : base
    }

    /** Blurred variants are cached on the record, keyed by radius. */
    async function ensureBlur(key) {
      const record = store.blobs[key]
      const px = effectiveBlur(key)
      if (!record || px <= 0) return
      if (record.blurPx === px && record.blurBlob) return
      try {
        record.blurBlob = await blurBlob(imageBlobOf(record) ?? record.render, px)
        record.blurPx = px
      } catch {
        record.blurBlob = null
        record.blurPx = 0
      }
    }

    function buildUrls() {
      for (const key of IMAGE_KEYS) {
        const record = store.blobs[key]
        const blob = imageBlobOf(record)
        if (record && !blob) {
          // Unusable leftover: drop it rather than break the render pass.
          store.blobs[key] = null
          store.urls[key] = ''
          continue
        }
        if (record && !record.url) record.url = URL.createObjectURL(blob)
        store.urls[key] = record ? pickUrl(record, effectiveBlur(key)) : ''
      }
    }

    /** The URL to paint: the blurred bake when the radius matches, else the base. */
    function pickUrl(record, px) {
      if (!record) return ''
      if (px > 0 && record.blurBlob && record.blurPx === px) {
        if (!record.blurUrl) record.blurUrl = URL.createObjectURL(record.blurBlob)
        return record.blurUrl
      }
      return record.url || ''
    }

    /** Recompute only the paint URLs after a config or blur change. */
    function refreshUrls() {
      for (const key of IMAGE_KEYS) {
        const record = store.blobs[key]
        store.urls[key] = record ? pickUrl(record, effectiveBlur(key)) : ''
      }
    }

    /* ------------------------------------------------------------------ */
    /* Runtime stylesheet                                                  */
    /* ------------------------------------------------------------------ */

    const RUNTIME_STYLE_ID = 'dsh-aurora-runtime'
    const UI_STYLE_ID = 'dsh-aurora-ui'

    function styleElement() {
      let element = document.getElementById(RUNTIME_STYLE_ID)
      if (!element) {
        element = document.createElement('style')
        element.id = RUNTIME_STYLE_ID
        element.dataset.aurora = 'runtime'
        document.head.appendChild(element)
      }
      return element
    }

    function uiStyleElement(css) {
      let element = document.getElementById(UI_STYLE_ID)
      if (!element) {
        element = document.createElement('style')
        element.id = UI_STYLE_ID
        element.dataset.aurora = 'ui'
        document.head.appendChild(element)
      }
      if (typeof css === 'string') element.textContent = css
      return element
    }

    /** Class prefix of the layout's CSS modules, read from its own sheet. */
    function layoutPrefix() {
      for (const sheet of document.querySelectorAll('style[data-plugin-css]')) {
        const id = sheet.getAttribute('data-plugin-css') || ''
        if (!id.endsWith('AppFrame.module.css')) continue
        const match = /\.([A-Za-z0-9_-]+)_frame\b/.exec(sheet.textContent || '')
        if (match) return match[1]
      }
      return null
    }

    /**
     * The panel inside a column usually paints its own opaque background,
     * which would hide the column's image. Find that one cover (the first
     * child roughly filling the column and painting a background) and mark it
     * so the stylesheet can clear it.
     */
    function findCover(root) {
      if (!root) return null
      const box = root.getBoundingClientRect()
      const base = box.width * box.height
      if (base <= 0) return null
      const walk = (node, depth) => {
        if (depth > 10) return null
        for (const child of node.children) {
          const rect = child.getBoundingClientRect()
          // Recurse through zero-sized wrappers (`display: contents`, absolute
          // layers): they still host the real panel further down.
          if (rect.width >= 80 && rect.height >= 80) {
            const ratio = (rect.width * rect.height) / base
            const paint = window.getComputedStyle(child).backgroundColor
            const painted = paint && paint !== 'rgba(0, 0, 0, 0)' && paint !== 'transparent'
            if (ratio >= 0.85 && painted) {
              return child
            }
          }
          const deeper = walk(child, depth + 1)
          if (deeper) return deeper
        }
        return null
      }
      return walk(root, 0)
    }

    function discoverSurfaces() {
      const prefix = layoutPrefix()
      if (!prefix) return { center: null, sidebar: null, frame: null }
      const frame = document.querySelector('.' + prefix + '_frame')
      const center = document.querySelector('.' + prefix + '_centerCol')
      const sidebar = document.querySelector('.' + prefix + '_sidebarCol')
      for (const [name, element] of [['center', center], ['sidebar', sidebar], ['frame', frame]]) {
        if (!element) continue
        if (element.getAttribute('data-aurora-surface') !== name) {
          element.setAttribute('data-aurora-surface', name)
        }
      }
      for (const [name, element] of [['center', center], ['sidebar', sidebar]]) {
        if (!element) continue
        const marked = element.querySelector('[data-aurora-surface="' + name + '-content"]')
        if (marked) continue
        try {
          const cover = findCover(element)
          if (cover) cover.setAttribute('data-aurora-surface', name + '-content')
        } catch {
          /* a cover we cannot find just leaves the column's own fill in place */
        }
      }

      markGlassTargets(center, sidebar)
      return { center, sidebar, frame }
    }

    /**
     * Glass targets: the sidebar column and the conversation header (the row
     * that owns the view tabs: 对话 / 轨迹). When glass is off the header is
     * simply cleared, so the picture runs through it.
     */
    function markGlassTargets(center, sidebar) {
      if (sidebar) {
        if (store.config.glass.sidebar.enabled) sidebar.setAttribute('data-aurora-glass', 'sidebar')
        else if (sidebar.getAttribute('data-aurora-glass') === 'sidebar') sidebar.removeAttribute('data-aurora-glass')
      }
      if (!center) return
      const tabs = center.querySelector('[class*="_tabs"]')
      const header = tabs ? tabs.closest('[class*="_header"]') : null
      if (!header) return
      const wanted = store.config.glass.header.enabled ? 'header' : 'bar'
      if (header.getAttribute('data-aurora-glass') !== wanted) {
        header.setAttribute('data-aurora-glass', wanted)
      }
    }

    const INTERACTIVE = 'button,a,[role="button"],[role="option"],[role="menuitem"],[role="tab"]'

    function paints(node) {
      const computed = window.getComputedStyle(node)
      const color = computed.backgroundColor
      const image = computed.backgroundImage
      return (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') ||
        (image && image !== 'none')
    }

    /**
     * Mark grey translucent panes, scoped to `root` so a mutation pass only
     * touches the nodes that just appeared instead of the whole tree.
     *
     * Rows are never marked: their fill appears on hover and an attribute would
     * freeze that look (the bug where hovered sessions stayed highlighted).
     */
    function markWithin(root) {
      if (!root || root.nodeType !== 1) return
      const scope = root.matches('[data-aurora-glass]') ? root : null
      const nodes = scope ? [scope] : [...root.querySelectorAll('*')]

      for (const node of nodes) {
        const cls = String(node.className || '')
        if (/_newSession(\s|$)/.test(cls)) node.setAttribute('data-aurora-glass', 'action')

        if (!node.getAttribute('data-aurora-glass') && cls.includes('_bubble')) {
          const rect = node.getBoundingClientRect()
          if (rect.height >= 20 && paints(node)) node.setAttribute('data-aurora-glass', 'bubble')
        }

        if (!node.getAttribute('data-aurora-glass') && cls.includes('_card') && !cls.includes('md-code-block')) {
          const rect = node.getBoundingClientRect()
          if (rect.height >= 32 && rect.height <= 220 && paints(node)) {
            node.setAttribute('data-aurora-glass', 'card')
            // The card's own header often sits beside or inside it with its
            // own fill; clear any painted descendant of comparable height.
            for (const inner of node.querySelectorAll('*')) {
              const innerRect = inner.getBoundingClientRect()
              if (innerRect.height < 16 || innerRect.width < 60) continue
              if (paints(inner)) inner.setAttribute('data-aurora-glass', 'card-part')
            }
            const parent = node.parentElement
            if (parent) {
              for (const sibling of parent.children) {
                if (sibling === node || sibling.getAttribute('data-aurora-glass')) continue
                const sibRect = sibling.getBoundingClientRect()
                if (Math.abs(sibRect.height - rect.height) > 4) continue
                if (paints(sibling)) sibling.setAttribute('data-aurora-glass', 'card-part')
              }
            }
          }
        }
      }

      // Sidebar: never paint a pane — the shell's own translucent bands are the
      // thing we are trying to remove, so anything painted there goes clear.
      const sidebar = document.querySelector('[data-aurora-surface="sidebar"]')
      if (sidebar) {
        const sb = sidebar.getBoundingClientRect()
        const inSidebar = (node) => node === sidebar || sidebar.contains(node)
        let budget = 900
        for (const node of nodes) {
          if (budget-- <= 0) break
          if (!inSidebar(node)) continue
          if (node === sidebar || node.getAttribute('data-aurora-glass')) continue
          if (node.closest(INTERACTIVE)) continue
          const rect = node.getBoundingClientRect()
          if (rect.width < sb.width * 0.6 || rect.height < 20 || rect.height > 200) continue
          if (!paints(node)) continue
          node.setAttribute('data-aurora-glass', 'bar')
        }
      }

      // A bar pinned to a column's top edge hides the picture; clear it.
      for (const surface of ['center', 'sidebar']) {
        const column = document.querySelector('[data-aurora-surface="' + surface + '"]')
        if (!column) continue
        const cb = column.getBoundingClientRect()
        const inColumn = (node) => node === column || column.contains(node)
        let budget = 900
        for (const node of nodes) {
          if (budget-- <= 0) break
          if (!inColumn(node)) continue
          if (node === column || node.getAttribute('data-aurora-glass')) continue
          const rect = node.getBoundingClientRect()
          if (rect.height < 16 || rect.height > 140) continue
          if (rect.width < cb.width * 0.7) continue
          const cls = String(node.className || '')
          const isHeader = /_(header|toolbar|topbar)(\s|$)/.test(cls)
          if (!isHeader && Math.abs(rect.top - cb.top) > 14) continue
          if (!isHeader && rect.width < cb.width * 0.85) continue
          if (!paints(node)) continue
          node.setAttribute('data-aurora-glass', 'bar')
        }
      }
    }

    /** `cover` geometry for one box: scaled size and the centring offsets. */
    function coverGeometry(boxWidth, boxHeight, imageWidth, imageHeight) {
      const w = Math.max(1, boxWidth)
      const h = Math.max(1, boxHeight)
      if (!imageWidth || !imageHeight) return { width: w, height: h, x: 0, y: 0 }
      const scale = Math.max(w / imageWidth, h / imageHeight)
      const width = imageWidth * scale
      const height = imageHeight * scale
      return { width, height, x: (w - width) / 2, y: (h - height) / 2 }
    }

    /**
     * The Windows titlebar strip sits above both columns and owns no picture of
     * its own once the shell's fill is cleared. Split it at the sidebar edge:
     * `::before` paints the left half (the sidebar's image and veil), `::after`
     * paints the right half (the conversation's image and veil) and repeats the
     * header's glass blur, so the top of the window matches what is below it.
     */
    function stripRules() {
      const sidebar = document.querySelector('[data-aurora-surface="sidebar"]')
      const center = document.querySelector('[data-aurora-surface="center"]')
      const frame = document.querySelector('[data-aurora-surface="frame"]')
      if (!center || !frame) return []
      const side = sidebar ?? center

      const strip = parseFloat(window.getComputedStyle(frame).paddingTop) || 0
      const sideBox = { w: side.clientWidth, h: side.clientHeight }
      const centerBox = { w: center.clientWidth, h: center.clientHeight }
      const px = (value) => Math.round(value) + 'px'

      const sideBlur = store.config.glass.sidebar
      const headerBlur = store.config.glass.header

      const hasSidebar = Boolean(store.urls.sidebar)
      const continuous = !hasSidebar

      if (continuous) {
        // The frame paints picture + veil across the whole window, the strip
        // included, so the strip only has to clear the shell's own fill. The
        // top edge deliberately gets no glass of its own: the blur of two
        // adjacent layers never met seamlessly, so the strip stays plain.
        return [
          '[data-windows-titlebar] [data-aurora-surface="frame"]::before{' +
          'background:none !important;backdrop-filter:none !important}',
        ]
      }

      const sideImage = store.blobs.sidebar ?? store.blobs.center
      const centerImage = store.blobs.center ?? store.blobs.sidebar
      const left = coverGeometry(sideBox.w, sideBox.h, sideImage?.width, sideImage?.height)
      const right = coverGeometry(centerBox.w, centerBox.h, centerImage?.width, centerImage?.height)
      const alpha = clamp(store.config.center.opacity, 0, 100) / 100
      const sideAlpha = clamp(store.config.sidebar.opacity, 0, 100) / 100
      // Same veil as the columns: a black wash that reaches pure black at 100.
      const centerTint = 'rgba(0,0,0,' + alpha + ')'
      const sideTint = 'rgba(0,0,0,' + sideAlpha + ')'
      const headerTint = headerBlur?.enabled ? 'rgba(16,18,24,.32)' : 'transparent'
      // The strip sits one titlebar above the columns, so the same cover
      // geometry lands at `y + strip` inside the pseudo-element.
      const sideY = left.y + strip
      const centerY = right.y + strip

      return [
        [
          '[data-windows-titlebar] [data-aurora-surface="frame"]::before{',
          'background-color:transparent !important;',
          'background-image:linear-gradient(' + sideTint + ',' + sideTint + '),url("' + (store.urls.sidebar || store.urls.center) + '") !important;',
          'background-size:' + px(sideBox.w) + ' ' + px(sideBox.h) + ',' + px(left.width) + ' ' + px(left.height) + ' !important;',
          'background-position:left 0 top 0,left ' + px(left.x) + ' top ' + px(sideY) + ' !important;',
          'background-repeat:no-repeat !important;',
          'filter:' + (sideBlur?.enabled ? 'blur(' + (sideBlur.blur || 0) + 'px)' : 'none') + ' !important;',
          '}',
        ].join(''),
        [
          '[data-windows-titlebar] [data-aurora-surface="frame"]::after{',
          'content:"" !important;pointer-events:none !important;',
          'position:absolute !important;top:0;bottom:auto;right:0;height:' + px(strip) + ';left:' + px(sideBox.w) + ';',
          'background-color:' + headerTint + ' !important;',
          'background-image:linear-gradient(' + centerTint + ',' + centerTint + '),url("' + (store.urls.center || store.urls.sidebar) + '") !important;',
          'background-size:' + px(centerBox.w) + ' ' + px(centerBox.h) + ',' + px(right.width) + ' ' + px(right.height) + ' !important;',
          'background-position:left 0 top 0,left ' + px(right.x) + ' top ' + px(centerY) + ' !important;',
          'background-repeat:no-repeat !important;',
          'filter:' + (headerBlur?.enabled ? 'blur(' + (headerBlur.blur || 0) + 'px)' : 'none') + ' !important;',
          '}',
        ].join(''),
      ]
    }

    /**
     * The veil over a picture: 0 darkens nothing, 100 turns it pure black. A
     * chosen tint adds a faint colour wash underneath, but it can never keep
     * the picture from going black at the top of the range.
     */
    function veilLayers(surface) {
      const settings = store.config[surface]
      const darken = clamp(settings.opacity, 0, 100) / 100
      const layers = []
      const preset = TINTS.find((tint) => tint.id === settings.tint)
      if (preset && preset.rgb) {
        const wash = 'rgba(' + preset.rgb.join(',') + ',.22)'
        layers.push('linear-gradient(' + wash + ',' + wash + ')')
      }
      const veil = 'rgba(0,0,0,' + darken + ')'
      layers.push('linear-gradient(' + veil + ',' + veil + ')')
      return layers.join(',')
    }

    function surfaceRule(surface, url) {
      const settings = store.config[surface]
      const mode = MODES[settings.mode] ?? MODES.fill
      const overlay = veilLayers(surface)
      const image = url ? 'url("' + url + '")' : 'none'
      return [
        '[data-aurora-surface="' + surface + '"]{',
        'background-color:transparent !important;',
        // The layout owns `.xxx_centerCol{background:...}` with the same
        // specificity, so these need !important to win regardless of which
        // stylesheet was injected first.
        'background-image:' + overlay + ',' + image + ' !important;',
        'background-size:' + mode.size + ' !important;',
        'background-repeat:' + mode.repeat + ' !important;',
        'background-position:center center !important;',
        'background-attachment:local;',
        '}',
      ].join('')
    }

    /**
     * Continuous mode: one element paints the picture *and* its veil across the
     * whole window, titlebar strip included, so the top can never fall out of
     * step with the columns below.
     */
    function frameRule(url) {
      const settings = store.config.center
      const mode = MODES[settings.mode] ?? MODES.fill
      const overlay = veilLayers('center')
      return [
        '[data-aurora-surface="frame"]{',
        'background-color:transparent !important;',
        'background-image:' + overlay + ',url("' + url + '") !important;',
        'background-size:' + mode.size + ' !important;',
        'background-repeat:' + mode.repeat + ' !important;',
        'background-position:center center !important;',
        '}',
      ].join('')
    }

    function buildCss() {
      const config = store.config
      if (!config.enabled) return ''
      const rules = []

      const centerUrl = store.urls.center
      const sidebarUrl = store.urls.sidebar

      if (centerUrl && !sidebarUrl) {
        // No sidebar image: the frame paints the picture and its veil across
        // the whole window, so columns and titlebar strip share one layer.
        rules.push(frameRule(centerUrl))
        rules.push('[data-aurora-surface="center"],[data-aurora-surface="sidebar"]{background-color:transparent !important;background-image:none !important}')
      } else {
        if (centerUrl) rules.push(surfaceRule('center', centerUrl))
        if (sidebarUrl) rules.push(surfaceRule('sidebar', sidebarUrl))
      }

      const radiusScale = (config.radius?.scale ?? 100) / 100
      if (radiusScale !== 1) {
        const base = radiusBaseValues()
        const tokens = RADIUS_TOKENS
          .filter((token) => Number.isFinite(base[token]))
          .map((token) => '--dsw-radius-' + token + ':' + (base[token] * radiusScale).toFixed(2) + 'px')
        if (tokens.length > 0) rules.push('html:root{' + tokens.join(';') + '}')
      }
      if (centerUrl || sidebarUrl) {
        for (const rule of stripRules()) {
          rules.push(rule)
        }
      }
      if (!centerUrl && !sidebarUrl) {
        rules.push('[data-aurora-surface]{background-image:none !important}')
      }
      // Panels that cover a column's image get cleared so the image shows.
      rules.push('[data-aurora-surface$="-content"]{background-color:transparent !important;background-image:none !important}')

      // Any top bar: let the picture continue up there instead of painting an
      // opaque shell colour over it. The titlebar strip itself is painted by
      // `stripRule` when the columns carry their own images.
      rules.push('[data-aurora-glass="bar"]{background:none !important}')
      // Clear the titlebar strip's own fill here, unconditionally: the picture
      // layer below it is the only thing that should show up there.
      rules.push('[data-windows-titlebar] [data-aurora-surface="frame"]::before{background:none !important}')
      // The composer seat fades to an opaque strip at the bottom; drop it.
      rules.push('[class*="_composerSeat"]{background:none !important}')
      // The frame's bottom strip (under both columns) also paints a solid fill.
      rules.push('[class*="_bottomRow"]{background:none !important}')

      // Grey translucent panes over the picture.
      rules.push('[data-aurora-glass="action"]{background-color:rgba(74,78,86,.34) !important;border-color:rgba(255,255,255,.12) !important;color:var(--dsw-alias-label-primary) !important}')
      rules.push('[data-aurora-glass="action"]:hover{background-color:rgba(92,96,104,.46) !important}')
      // No backdrop blur on these: the composer area repaints on hover, and a
      // backdrop-filter there made the page flicker while the send/stop button
      // was live. A flat translucent fill reads the same over a still picture.
      // Cards stay flat: the composer area repaints on hover and a backdrop
      // filter there made the page flicker. The message bubble is away from
      // that repaint, so it keeps its acrylic blur.
      rules.push('[data-aurora-glass="card"]{background:rgba(30,32,38,.55) !important;border-color:rgba(255,255,255,.07) !important}')
      rules.push('[data-aurora-glass="card-part"]{background:none !important}')
      rules.push('[data-aurora-glass="bubble"]{background:rgba(30,32,38,.55) !important;backdrop-filter:blur(14px) saturate(1.15) !important;-webkit-backdrop-filter:blur(14px) saturate(1.15) !important}')

      // The Windows titlebar layout rounds the centre column's top-left and
      // leaves a gap; the picture should run edge to edge instead.
      rules.push(':root{--dsh-windows-content-radius:0px}')
      rules.push('[data-aurora-surface="center"],[data-aurora-surface="sidebar"],[data-aurora-surface="frame"]{border-radius:0 !important}')

      // Real frosted glass: the sidebar column and the conversation header
      // blur whatever is painted behind them (the frame's picture), with an
      // independent switch and blur radius per surface.
      for (const [key, attribute] of [['sidebar', 'sidebar'], ['header', 'header']]) {
        const glass = config.glass[key]
        if (!glass || !glass.enabled) continue
        const blur = Number.isFinite(glass.blur) ? glass.blur : 16
        rules.push(
          '[data-aurora-glass="' + attribute + '"]{backdrop-filter:blur(' + blur + 'px) saturate(1.2) !important;' +
          '-webkit-backdrop-filter:blur(' + blur + 'px) saturate(1.2) !important;' +
          'background-color:rgba(16,18,24,.32) !important}',
        )
      }

      // Inline code chips read as near-black boxes against the picture. A token
      // override alone did not take (the dark palette declares its own value on
      // the root element), so paint them directly: a `code` whose parent is not
      // `pre` is exactly the inline chip, and block code keeps its own style.
      rules.push('body :not(pre) > code{background-color:rgb(74,76,84) !important;border-color:rgba(255,255,255,.10) !important}')

      const body = ['--dsw-alias-markdown-inline-code:rgb(74,76,84)']
      if (config.text.family) {
        const family = config.text.family.replace(/["\\]/g, '')
        body.push('--dsh-font-family-text:"' + family + '"')
      }
      if (config.text.size > 0) {
        body.push('--dsh-content-font-size:' + config.text.size + 'px')
      }
      if (config.text.color) {
        body.push('--dsw-alias-label-primary:' + config.text.color)
        body.push('--dsw-alias-label-secondary:' + config.text.color)
      }
      // The layout plugin writes the font size and font family straight onto
      // `body` with `style.setProperty`, and an inline declaration outranks any
      // stylesheet rule — only `!important` here can override it. The palette
      // tokens are ordinary `body` rules, matched by `html:root body`.
      if (body.length > 0) {
        const declarations = body.map((entry) => entry + ' !important')
        rules.push('html:root,html:root body{' + declarations.join(';') + ';}')
      }

      return rules.join('\n')
    }

    const PLACEMENT_BASE_WIDTH = 240

    /** A fullscreen window or a maximized one both leave room for the pictures. */
    function windowIsMaximized() {
      if (document.documentElement.hasAttribute('data-fullscreen')) return true
      const width = window.screen?.availWidth ?? 0
      const height = window.screen?.availHeight ?? 0
      if (!width || !height) return false
      return window.outerWidth >= width - 8 && window.outerHeight >= height - 8
    }

    /**
     * Save the placement list without touching the rest of the config. The
     * items must stay the same objects the page has bound to: `sanitize`
     * returns copies, and a later drag would then move a detached object.
     */
    function persistPlacements() {
      saveConfig(store.config)
      store.notify()
    }

    /**
     * Freely placed pictures: one `<img>` per placement, positioned in viewport
     * coordinates. In layout mode each one grows a drag surface, a corner
     * handle and a delete button, so the arrangement is made on the real page
     * rather than in a mock preview.
     */
    function createPlacementNode(item) {
      const node = document.createElement('div')
      node.dataset.auroraPlacement = item.id
      node.dataset.auroraOverlay = 'placement'
      // First child of the frame at z-index 0: same paint layer as the columns,
      // but earlier in tree order, so the conversation always covers it.
      node.style.cssText = 'position:absolute;z-index:0;user-select:none;touch-action:none;display:none'
      const image = document.createElement('img')
      image.draggable = false
      image.style.cssText = 'display:block;width:100%;height:auto;border-radius:10px;pointer-events:none'
      node.appendChild(image)
      const frame = document.querySelector('[data-aurora-surface="frame"]')
      const host = frame ?? document.body
      host.insertBefore(node, host.firstChild)
      return node
    }

    function currentPlacement(item) {
      return store.config.placements.find((entry) => entry.id === item.id) ?? item
    }

    function placementDelete(item) {
      const record = store.placements[item.id]
      if (record?.url) URL.revokeObjectURL(record.url)
      delete store.placements[item.id]
      void deleteImage('placement:' + item.id)
      store.config.placements = store.config.placements.filter((entry) => entry.id !== item.id)
      persistPlacements()
      renderPlacements()
    }

    function bindPlacement(node, item) {
      if (node.dataset.auroraBound) return
      node.dataset.auroraBound = '1'
      let mode = null
      let startX = 0
      let startY = 0
      let originX = 0
      let originY = 0
      let originScale = 100

      node.addEventListener('pointerdown', (event) => {
        if (!store.editing || event.button !== 0) return
        const live = currentPlacement(item)
        const onHandle = event.target?.dataset?.auroraHandle === 'resize'
        const onDelete = event.target?.dataset?.auroraHandle === 'delete'
        if (onDelete) {
          event.preventDefault()
          placementDelete(live)
          return
        }
        event.preventDefault()
        node.setPointerCapture?.(event.pointerId)
        mode = onHandle ? 'resize' : 'move'
        startX = event.clientX
        startY = event.clientY
        originX = live.x
        originY = live.y
        originScale = live.scale
      })

      node.addEventListener('pointermove', (event) => {
        if (!mode) return
        const live = currentPlacement(item)
        const dx = event.clientX - startX
        const dy = event.clientY - startY
        if (mode === 'move') {
          live.x = Math.round(Math.min(Math.max(originX + dx, -200), window.innerWidth - 40))
          live.y = Math.round(Math.min(Math.max(originY + dy, -200), window.innerHeight - 40))
        } else {
          const width = PLACEMENT_BASE_WIDTH * (originScale / 100)
          const next = ((width + dx) / PLACEMENT_BASE_WIDTH) * 100
          live.scale = Math.round(Math.min(Math.max(next, 10), 400))
        }
        applyPlacementStyle(node, live)
      })

      const finish = () => {
        if (!mode) return
        mode = null
        persistPlacements()
      }
      node.addEventListener('pointerup', finish)
      node.addEventListener('pointercancel', finish)
    }

    function applyPlacementStyle(node, item) {
      node.style.left = item.x + 'px'
      node.style.top = item.y + 'px'
      node.style.width = Math.round(PLACEMENT_BASE_WIDTH * (item.scale / 100)) + 'px'
    }

    function renderPlacements() {
      const editing = store.editing === true
      const visible = store.config.enabled && windowIsMaximized()
      const wanted = new Set(store.config.placements.map((item) => item.id))
      for (const node of document.querySelectorAll('[data-aurora-placement]')) {
        if (!wanted.has(node.dataset.auroraPlacement)) node.remove()
      }
      for (const item of store.config.placements) {
        const record = store.placements[item.id]
        if (!record) continue
        const node = document.querySelector('[data-aurora-placement="' + item.id + '"]') ?? createPlacementNode(item)
        if (!record.url) record.url = URL.createObjectURL(record.render ?? record.original)
        const image = node.querySelector('img')
        if (image && image.getAttribute('src') !== record.url) image.src = record.url
        bindPlacement(node, item)
        applyPlacementStyle(node, item)
        // Arranging happens above the content so the pointer reaches the
        // picture; once applied it drops to the seat under the chat.
        node.style.zIndex = editing ? '5' : '0'
        node.style.display = editing || visible ? 'block' : 'none'
        node.style.outline = editing ? '1px dashed rgba(255,255,255,.55)' : 'none'
        node.style.cursor = editing ? 'move' : 'default'
        node.style.pointerEvents = editing ? 'auto' : 'none'
        let handle = node.querySelector('[data-aurora-handle="resize"]')
        let bin = node.querySelector('[data-aurora-handle="delete"]')
        if (editing && !handle) {
          handle = document.createElement('div')
          handle.dataset.auroraHandle = 'resize'
          handle.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;border-radius:4px;' +
            'background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);cursor:nwse-resize'
          node.appendChild(handle)
          bin = document.createElement('div')
          bin.dataset.auroraHandle = 'delete'
          bin.textContent = '×'
          bin.style.cssText = 'position:absolute;right:-8px;top:-8px;width:18px;height:18px;border-radius:50%;' +
            'background:#e2574c;color:#fff;font:12px/18px sans-serif;text-align:center;cursor:pointer'
          node.appendChild(bin)
        } else if (!editing && handle) {
          handle.remove()
          bin?.remove()
        }
      }
      updateLayoutBar(editing)
    }

    /**
     * While arranging, a small bar sits at the bottom of the page with the
     * commit button: it applies the layout, leaves arrange mode and hides the
     * handles. Re-entering is a fresh click on the switch.
     */
    function updateLayoutBar(editing) {
      let bar = document.getElementById('dsh-aurora-layout-bar')
      if (!bar) {
        bar = document.createElement('div')
        bar.id = 'dsh-aurora-layout-bar'
        bar.dataset.auroraOverlay = 'layout'
        bar.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:40;' +
          'display:none;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;' +
          'background:rgba(20,22,28,.92);border:0.5px solid rgba(255,255,255,.14);' +
          'box-shadow:0 8px 24px rgba(0,0,0,.35);font:12px/1.4 system-ui,sans-serif;color:#fff'
        const label = document.createElement('span')
        label.textContent = '拖动移动 · 右下角缩放 · × 删除'
        label.style.cssText = 'color:rgba(255,255,255,.7)'
        const done = document.createElement('button')
        done.textContent = '应用布局'
        done.style.cssText = 'appearance:none;border:0;border-radius:8px;padding:6px 14px;' +
          'font:12px/1 system-ui,sans-serif;background:#4c8dff;color:#fff;cursor:pointer'
        done.addEventListener('click', () => {
          store.editing = false
          persistPlacements()
          renderPlacements()
        })
        bar.appendChild(label)
        bar.appendChild(done)
        document.body.appendChild(bar)
      }
      bar.style.display = editing ? 'flex' : 'none'
    }

    const RADIUS_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl', 'panel']
    let radiusBase = null

    /**
     * Corner radii are six CSS variables on the root. Their base values are
     * cached once — reading them after we override would compound the scale on
     * every apply.
     */
    function radiusBaseValues() {
      if (radiusBase) return radiusBase
      const computed = window.getComputedStyle(document.documentElement)
      const found = {}
      for (const token of RADIUS_TOKENS) {
        const value = parseFloat(computed.getPropertyValue('--dsw-radius-' + token))
        if (Number.isFinite(value) && value > 0) found[token] = value
      }
      if (Object.keys(found).length > 0) radiusBase = found
      return found
    }

    function renderRuntime() {
      discoverSurfaces()
      styleElement().textContent = buildCss()
      renderPlacements()
    }

    /**
     * Event-driven maintenance: only nodes that actually appeared are visited,
     * so streaming a long answer costs one small pass per mutation batch
     * instead of a full-tree scan every second.
     */
    let markTimer = null
    let pendingRoots = []

    function scheduleMarks(additions) {
      for (const node of additions) {
        if (node.nodeType === 1) pendingRoots.push(node)
      }
      if (markTimer !== null) return
      markTimer = window.setTimeout(() => {
        markTimer = null
        const roots = pendingRoots.slice(0, 40)
        pendingRoots = []
        try {
          discoverSurfaces()
          for (const root of roots) {
            if (root.isConnected) markWithin(root)
          }
        } catch {
          /* never let marking break the page */
        }
      }, 150)
    }

    function stopMarks() {
      if (markTimer !== null) {
        window.clearTimeout(markTimer)
        markTimer = null
      }
      pendingRoots = []
    }

    function clearRuntime() {
      const element = document.getElementById(RUNTIME_STYLE_ID)
      if (element) element.textContent = ''
      for (const node of document.querySelectorAll('[data-aurora-surface]')) {
        node.removeAttribute('data-aurora-surface')
      }
      for (const node of document.querySelectorAll('[data-aurora-glass]')) {
        node.removeAttribute('data-aurora-glass')
      }
      for (const node of document.querySelectorAll('[data-aurora-overlay]')) {
        node.remove()
      }
    }

    async function bootstrap() {
      for (const key of IMAGE_KEYS) {
        try {
          const stored = await readImage(key)
          if (!stored) {
            store.blobs[key] = null
            continue
          }
          // Records written by an earlier revision are bare blobs.
          let record = stored instanceof Blob ? await prepareImage(stored) : stored
          // Display copies made by the old long-edge cap can be far smaller
          // than `cover` needs; rebuild them from the untouched original.
          if (record && record.v !== 3 && record.original instanceof Blob) {
            try {
              record = await prepareImage(record.original)
              await writeImage(key, record)
            } catch {
              /* keep the old copy if the rebuild fails */
            }
          }
          const blob = imageBlobOf(record)
          if (!blob) {
            store.blobs[key] = null
            continue
          }
          store.blobs[key] = record
        } catch {
          store.blobs[key] = null
        }
      }
      releaseUrls()
      buildUrls()
      for (const key of SURFACE_KEYS) await ensureBlur(key)
      refreshUrls()
      // Placed pictures live under their own keys, next to the surfaces.
      for (const item of store.config.placements) {
        try {
          const stored = await readImage('placement:' + item.id)
          if (!stored) continue
          const record = stored instanceof Blob ? await prepareImage(stored) : stored
          if (imageBlobOf(record)) store.placements[item.id] = record
        } catch {
          /* a missing placement picture just does not render */
        }
      }
      renderRuntime()
      try {
        markWithin(document.body)
      } catch {
        /* marking is best-effort */
      }
      store.notify()
    }

    /* ------------------------------------------------------------------ */
    /* Settings UI                                                         */
    /* ------------------------------------------------------------------ */

    const UI_CSS = `
.aur-page{display:flex;flex-direction:column;gap:18px;padding:4px 2px 32px;color:var(--dsw-alias-label-primary);font-family:inherit}
.aur-head{display:flex;flex-direction:column;gap:6px}
.aur-subrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.aur-switchgroup{display:inline-flex;align-items:center;gap:8px;flex:none}
.aur-switch-label{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}
.aur-title{font-size:16px;font-weight:600;line-height:24px}
.aur-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:18px}
.aur-card{border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:14px}
.aur-cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.aur-cardtitle{font-size:13px;font-weight:600;line-height:20px}
.aur-row{display:flex;align-items:center;gap:12px;min-height:30px}
.aur-rowlabel{font-size:12px;color:var(--dsw-alias-label-secondary);width:76px;flex:none}
.aur-rowbody{display:flex;align-items:center;gap:10px;flex:1;min-width:0;flex-wrap:wrap}
.aur-range{flex:1;min-width:120px;accent-color:var(--dsw-alias-brand-primary);height:18px}
.aur-num{width:64px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;padding:5px 8px;font-size:12px;color:var(--dsw-alias-label-primary);text-align:right}
.aur-unit{font-size:12px;color:var(--dsw-alias-label-secondary);width:26px;flex:none}
.aur-select{background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;padding:5px 8px;font-size:12px;color:var(--dsw-alias-label-primary);min-width:120px;max-width:100%}
.aur-btn{appearance:none;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;line-height:18px}
.aur-btn:hover{background:var(--dsw-alias-bg-layer-1)}
.aur-btn[disabled]{opacity:.5;cursor:default}
.aur-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:600}
.aur-btn-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 84%,var(--dsw-alias-label-primary));border-color:transparent}
.aur-preview{width:148px;height:84px;border-radius:10px;border:0.5px dashed var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-2);background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;overflow:hidden}
.aur-swatch{width:22px;height:22px;border-radius:50%;border:1.5px solid transparent;cursor:pointer;padding:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.aur-swatch[data-active="true"]{border-color:var(--dsw-alias-label-primary)}
.aur-color-input{width:28px;height:22px;padding:0;border:none;background:transparent;cursor:pointer}
.aur-hex{width:92px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;padding:5px 8px;font-size:12px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace}
.aur-sample{border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:12px 14px;font-size:14px;line-height:1.5;color:inherit}
.aur-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 2px 2px;margin-top:2px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.aur-toast{position:fixed;left:50%;top:50%;z-index:60;background:var(--dsw-alias-bg-overlay);border:0.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;padding:11px 20px;border-radius:12px;pointer-events:none;white-space:nowrap;animation:aur-toast 2.4s ease forwards}
@keyframes aur-toast{0%{opacity:0;transform:translate(-50%,-50%) scale(.94)}10%{opacity:1;transform:translate(-50%,-50%) scale(1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-56%) scale(.98)}}
.aur-err{font-size:12px;color:var(--dsw-alias-state-warn-primary)}
.aur-mask{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.aur-dialog{min-width:280px;max-width:380px;box-sizing:border-box;background:var(--dsw-alias-bg-overlay);border:0.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.aur-dialog-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.aur-dialog-actions{display:flex;justify-content:flex-end;gap:10px}
/* Standard Harness switch: 36x20 capsule, 16px thumb, state read from aria-checked. */
.aur-toggle{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.aur-toggle[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.aur-toggle:disabled{cursor:default;opacity:.5}
.aur-toggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.aur-toggle-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
.aur-toggle[aria-checked="false"] .aur-toggle-thumb{background:var(--dsw-alias-switch-thumb)}
.aur-toggle[aria-checked="true"] .aur-toggle-thumb{transform:translateX(16px)}
`

    const CJK_LABEL = /[\u3400-\u9fff]/

    /** Chinese display names first (pinyin order), then Latin names A→Z. */
    function sortFonts(list) {
      const chinese = list
        .filter((font) => CJK_LABEL.test(font.label))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
      const latin = list
        .filter((font) => !CJK_LABEL.test(font.label))
        .sort((a, b) => a.label.localeCompare(b.label, 'en'))
      return [...chinese, ...latin]
    }

    function fallbackFonts() {
      return FONT_FALLBACK.map((name) => ({ family: name, label: name }))
    }

    function useFonts(reloadKey) {
      const [state, setState] = useState(() => ({ list: sortFonts(fallbackFonts()), source: 'fallback' }))
      useEffect(() => {
        let alive = true
        ;(async () => {
          // 1. Host route first: it carries the localized display names.
          try {
            const response = await fetch('/aurora/fonts', { cache: 'no-store' })
            if (!response.ok) throw new Error('http ' + response.status)
            const data = await response.json()
            const raw = Array.isArray(data.fonts)
              ? data.fonts
              : (Array.isArray(data.families) ? data.families.map((family) => ({ family, label: family })) : [])
            const fonts = raw
              .filter((font) => font && typeof font.family === 'string' && font.family.length > 0)
              .map((font) => ({
                family: font.family,
                label: typeof font.label === 'string' && font.label ? font.label : font.family,
              }))
            const unique = []
            const seen = new Set()
            for (const font of fonts) {
              const key = font.family.toLowerCase()
              if (seen.has(key)) continue
              seen.add(key)
              unique.push(font)
            }
            if (alive && unique.length > 0) {
              setState({ list: sortFonts(unique), source: 'host' })
              return
            }
          } catch {
            /* fall through to the browser API */
          }

          // 2. Chromium's Local Font Access API. It only exposes the English
          //    family name, so it is the weaker source and comes second.
          try {
            const query = window.queryLocalFonts
            if (typeof query === 'function') {
              const available = await query()
              const fonts = [...new Set(available.map((font) => font.family).filter(Boolean))]
                .map((family) => ({ family, label: family }))
              if (alive && fonts.length > 0) {
                setState({ list: sortFonts(fonts), source: 'browser' })
                return
              }
            }
          } catch {
            /* permission denied: keep whatever the route produced */
          }
        })()
        return () => {
          alive = false
        }
      }, [reloadKey])
      return state
    }

    function Section(props) {
      return h('section', { className: 'aur-card' },
        h('div', { className: 'aur-cardhead' },
          h('span', { className: 'aur-cardtitle' }, props.title),
          props.extra ?? null,
        ),
        props.children,
      )
    }

    function Row(props) {
      return h('div', { className: 'aur-row' },
        h('span', { className: 'aur-rowlabel' }, props.label),
        h('div', { className: 'aur-rowbody' }, props.children),
      )
    }

    /** Range + number input kept in sync; the number is also the display tail. */
    function Slider(props) {
      const { value, min, max, step = 1, unit = '', onChange, disabled = false } = props
      const set = (next) => {
        if (!Number.isFinite(next)) return
        onChange(clamp(next, min, max))
      }
      return h(React.Fragment, null,
        h('input', {
          className: 'aur-range',
          type: 'range',
          min,
          max,
          step,
          value,
          disabled,
          onChange: (event) => set(Number(event.target.value)),
        }),
        h('input', {
          className: 'aur-num',
          type: 'number',
          min,
          max,
          step,
          value,
          disabled,
          onChange: (event) => set(Number(event.target.value)),
        }),
        unit ? h('span', { className: 'aur-unit' }, unit) : null,
      )
    }

    /** Same geometry and tokens as the Harness switch primitive. */
    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        className: 'aur-toggle',
        disabled: props.disabled,
        onClick: () => props.onChange(!props.checked),
      }, h('span', { className: 'aur-toggle-thumb' }))
    }

    function ImagePicker(props) {
      const { preview, onPick, onClear, empty } = props
      const inputRef = useRef(null)
      return h('div', { className: 'aur-row' },
        h('div', {
          className: 'aur-preview',
          style: preview ? { backgroundImage: 'url("' + preview + '")' } : undefined,
        }, preview ? '' : empty),
        h('div', { className: 'aur-rowbody' },
          h('button', { className: 'aur-btn', onClick: () => inputRef.current?.click() }, preview ? '更换图片' : '选择图片'),
          preview ? h('button', { className: 'aur-btn', onClick: onClear }, '清除') : null,
          h('input', {
            ref: inputRef,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files && event.target.files[0]
              if (file) onPick(file)
              event.target.value = ''
            },
          }),
        ),
      )
    }

    /** One fullscreen side picture: image, size and vertical position. */
    function SurfaceEditor(props) {
      const { surface, draft, pendingPreview, meta, fallback, onPatch, onPick, onClear } = props
      const settings = draft[surface] ?? surfaceDefaults()
      // With no sidebar image the sidebar reuses the conversation page's
      // picture, so its veil and blur follow that surface too.
      const shown = fallback
        ? { ...settings, opacity: draft.center.opacity, blur: draft.center.blur, tint: draft.center.tint, mode: draft.center.mode }
        : settings
      return h(Section, {
        title: surface === 'center' ? '会话页面背景' : '侧边栏背景',
        extra: surface === 'sidebar'
          ? h('span', { className: 'aur-hint' }, '不选图片时沿用会话页图片')
          : null,
      },
        h('div', { className: 'aur-cardhead' },
          h(ImagePicker, {
            preview: pendingPreview,
            empty: '未设置',
            onPick,
            onClear,
          }),
        ),
        meta ? h('div', { className: 'aur-hint' }, meta) : null,
        fallback ? h('div', { className: 'aur-hint' }, '未设图片：缩放、不透明度、色调、模糊度都跟随会话页') : null,
        h(Row, { label: '缩放' },
          h('select', {
            className: 'aur-select',
            value: shown.mode,
            disabled: Boolean(fallback),
            onChange: (event) => onPatch({ mode: event.target.value }),
          }, Object.entries(MODES).map(([id, mode]) => h('option', { key: id, value: id }, mode.label))),
        ),
        h(Row, { label: '压暗' },
          h(Slider, {
            value: shown.opacity,
            min: 0,
            max: 100,
            unit: '%',
            disabled: Boolean(fallback),
            onChange: (value) => onPatch({ opacity: value }),
          }),
          h('span', { className: 'aur-hint' }, '0 原图，100 纯黑'),
        ),
        h(Row, { label: '模糊度' },
          h(Slider, {
            value: shown.blur,
            min: 0,
            max: 40,
            unit: 'px',
            disabled: Boolean(fallback),
            onChange: (value) => onPatch({ blur: value }),
          }),
        ),
        h(Row, { label: '色调' },
          h('select', {
            className: 'aur-select',
            value: shown.tint,
            disabled: Boolean(fallback),
            onChange: (event) => onPatch({ tint: event.target.value }),
          }, TINTS.map((tint) => h('option', { key: tint.id, value: tint.id }, tint.label))),
          h('span', {
            className: 'aur-swatch',
            title: '当前色调',
            style: { backgroundColor: 'rgb(' + (TINTS.find((t) => t.id === shown.tint)?.rgb ?? [24, 28, 40]).join(',') + ')' },
          }),
        ),
      )
    }

    /** Keeps a render error visible instead of leaving the section blank. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'aur-page' },
            h('div', { className: 'aur-title' }, '主题外观'),
            h('div', { className: 'aur-err' }, '渲染出错：' + String(this.state.error?.message ?? this.state.error)),
          )
        }
        return this.props.children
      }
    }

    function AuroraSection(props) {
      return h(Boundary, null, h(Page, props))
    }

    function Page(props) {
      useStoreVersion()
      const [fontReload, setFontReload] = useState(0)
      const fonts = useFonts(fontReload)
      const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(store.config)))
      const [pending, setPending] = useState({})
      const [toast, setToast] = useState(null)
      const [busy, setBusy] = useState(false)
      const toastSeq = useRef(0)
      const pageRef = useRef(null)
      const placementInputRef = useRef(null)

      const showToast = useCallback((text) => {
        const id = (toastSeq.current += 1)
        // Centre on this section's content column, not the whole window: the
        // settings panel is offset left, so a viewport centre reads as skewed.
        const rect = pageRef.current?.getBoundingClientRect()
        const left = rect ? Math.round(rect.left + rect.width / 2) : Math.round(window.innerWidth / 2)
        setToast({ id, text, left })
        window.setTimeout(() => {
          setToast((current) => (current && current.id === id ? null : current))
        }, 2400)
      }, [])

      const patchSurface = useCallback((surface, patch) => {
        setDraft((current) => ({ ...current, [surface]: { ...current[surface], ...patch } }))
      }, [])

      const patchGlass = useCallback((key, patch) => {
        setDraft((current) => ({
          ...current,
          glass: { ...current.glass, [key]: { ...current.glass[key], ...patch } },
        }))
      }, [])

      const [confirming, setConfirming] = useState(null)
      const askConfirm = useCallback((message, action) => setConfirming({ message, action }), [])

      const pick = useCallback(async (surface, file) => {
        try {
          showToast('正在处理图片…')
          const record = await prepareImage(file)
          const url = URL.createObjectURL(record.render)
          setPending((current) => {
            const previous = current[surface]
            if (previous && previous.url) URL.revokeObjectURL(previous.url)
            return { ...current, [surface]: { record, url } }
          })
          showToast(record.render === record.original ? '图片已载入，点应用生效' : '已生成显示用副本，点应用生效')
        } catch (error) {
          showToast('这张图片无法读取：' + String(error?.message ?? error))
        }
      }, [showToast])

      const clear = useCallback((surface) => {
        askConfirm('清除这张背景图片？', () => {
          setPending((current) => {
            const previous = current[surface]
            if (previous && previous.url) URL.revokeObjectURL(previous.url)
            return { ...current, [surface]: null }
          })
        })
      }, [askConfirm])

      /** Add pictures as freely placed layers; the existing ones stay put. */
      const addPlacements = async (files) => {
        const added = []
        for (const file of files) {
          try {
            showToast('正在处理图片…')
            const record = await prepareImage(file)
            const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
            await writeImage('placement:' + id, record)
            store.placements[id] = record
            added.push({ ...placementDefaults(id), x: 80 + added.length * 24, y: 80 + added.length * 24 })
          } catch {
            /* one bad file must not stop the rest */
          }
        }
        if (added.length === 0) return
        store.config.placements = [...store.config.placements, ...added]
        store.editing = true
        persistPlacements()
        renderPlacements()
        showToast('已添加 ' + added.length + ' 张图片，进入布局模式')
      }

      const clearPlacements = () => {
        askConfirm('清除所有放置的图片？此操作不可撤销。', () => {
          for (const item of [...store.config.placements]) placementDelete(item)
          store.editing = false
          renderPlacements()
          store.notify()
          showToast('已清除所有放置的图片')
        })
      }

      const previewOf = (surface) => {
        const entry = pending[surface]
        if (entry === null) return ''
        if (entry) return entry.url
        return store.urls[surface]
      }

      const apply = async () => {
        if (busy) return
        setBusy(true)
        try {
          for (const surface of IMAGE_KEYS) {
            const entry = pending[surface]
            if (entry === undefined) continue
            if (entry === null) {
              await deleteImage(surface)
              const record = store.blobs[surface]
              if (record?.url) URL.revokeObjectURL(record.url)
              if (record?.blurUrl) URL.revokeObjectURL(record.blurUrl)
              store.blobs[surface] = null
              store.urls[surface] = ''
            } else {
              await writeImage(surface, entry.record)
              const previous = store.blobs[surface]
              if (previous?.url && previous !== entry.record) URL.revokeObjectURL(previous.url)
              if (previous?.blurUrl && previous !== entry.record) URL.revokeObjectURL(previous.blurUrl)
              entry.record.url = entry.url
              entry.record.blurBlob = null
              entry.record.blurPx = 0
              store.blobs[surface] = entry.record
            }
          }
          // Placements are edited on the live page and saved immediately, so
          // apply must not overwrite them with this form's older snapshot.
          store.config = sanitize({ ...draft, placements: store.config.placements })
          for (const surface of SURFACE_KEYS) await ensureBlur(surface)
          refreshUrls()
          saveConfig(store.config)
          setPending({})
          renderRuntime()
          try {
            markWithin(document.body)
          } catch {
            /* marking is best-effort */
          }
          store.notify()
          showToast('已应用')
        } finally {
          setBusy(false)
        }
      }

      const reset = () => {
        askConfirm('恢复默认会清除背景图片与所有设置，确定继续？', () => {
          for (const surface of IMAGE_KEYS) {
            const entry = pending[surface]
            if (entry && entry.url) URL.revokeObjectURL(entry.url)
          }
          setPending({ center: null, sidebar: null })
          setDraft(defaults())
          showToast('已恢复默认，点应用生效')
        })
      }

      const metaOf = (surface) => {
        const entry = pending[surface]
        if (entry === null) return ''
        if (entry) return describeImage(entry.record)
        return describeImage(store.blobs[surface])
      }

      const familyOptions = useMemo(() => {
        const list = fonts.list.slice()
        const current = draft.text.family
        if (current && !list.some((font) => font.family === current)) {
          list.unshift({ family: current, label: current })
        }
        return list
      }, [fonts.list, draft.text.family])

      return h('div', { className: 'aur-page', ref: pageRef },
        h('div', { className: 'aur-head' },
          h('div', { className: 'aur-title' }, '主题外观'),
          h('div', { className: 'aur-subrow' },
            h('div', { className: 'aur-hint' }, '背景图片按原图保存，不做重新压缩'),
            h('div', { className: 'aur-switchgroup' },
              h('span', {
                className: 'aur-switch-label',
                onClick: () => setDraft((current) => ({ ...current, enabled: !current.enabled })),
              }, '启用'),
              h(Switch, {
                checked: draft.enabled,
                onChange: (next) => setDraft((current) => ({ ...current, enabled: next })),
              }),
            ),
          ),
        ),

        h(SurfaceEditor, {
          key: 'center',
          surface: 'center',
          draft,
          pendingPreview: previewOf('center'),
          meta: metaOf('center'),
          onPatch: (patch) => patchSurface('center', patch),
          onPick: (file) => pick('center', file),
          onClear: () => clear('center'),
        }),

        h(SurfaceEditor, {
          key: 'sidebar',
          surface: 'sidebar',
          draft,
          pendingPreview: previewOf('sidebar'),
          meta: metaOf('sidebar'),
          fallback: !previewOf('sidebar'),
          onPatch: (patch) => patchSurface('sidebar', patch),
          onPick: (file) => pick('sidebar', file),
          onClear: () => clear('sidebar'),
        }),

        h(Section, { title: '毛玻璃' },
          h('div', { className: 'aur-hint' }, '只模糊背后的图片，不影响文字；关闭时该区域保持完全透明'),
          h(Row, { label: '侧边栏' },
            h(Switch, {
              checked: draft.glass.sidebar.enabled,
              onChange: (next) => patchGlass('sidebar', { enabled: next }),
            }),
            h('span', { className: 'aur-hint' }, '模糊度'),
            h(Slider, {
              value: draft.glass.sidebar.blur,
              min: 0,
              max: 40,
              unit: 'px',
              onChange: (value) => patchGlass('sidebar', { blur: value }),
            }),
          ),
          h(Row, { label: '会话顶栏' },
            h(Switch, {
              checked: draft.glass.header.enabled,
              onChange: (next) => patchGlass('header', { enabled: next }),
            }),
            h('span', { className: 'aur-hint' }, '模糊度'),
            h(Slider, {
              value: draft.glass.header.blur,
              min: 0,
              max: 40,
              unit: 'px',
              onChange: (value) => patchGlass('header', { blur: value }),
            }),
          ),
        ),

        h(Section, { title: '圆角' },
          h('div', { className: 'aur-hint' }, '整体缩放界面的圆角：100% 为原始设计，数值越小越方正'),
          h(Row, { label: '缩放' },
            h(Slider, {
              value: draft.radius.scale,
              min: 40,
              max: 200,
              unit: '%',
              onChange: (value) => setDraft((current) => ({ ...current, radius: { scale: value } })),
            }),
          ),
        ),

        h(Section, { title: '图片层' },
          h('div', { className: 'aur-hint' }, '添加后进入布局模式：在页面上直接拖动移动、拖右下角缩放、点右上角 × 删除；只在窗口最大化时显示'),
          h(Row, { label: '添加' },
            h('button', {
              className: 'aur-btn',
              onClick: () => placementInputRef.current?.click(),
            }, '选择图片…'),
            h('input', {
              ref: placementInputRef,
              type: 'file',
              accept: 'image/*',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                const files = [...(event.target.files ?? [])]
                if (files.length > 0) addPlacements(files)
                event.target.value = ''
              },
            }),
            h('span', { className: 'aur-hint' }, store.config.placements.length + ' 张'),
          ),
          h(Row, { label: '布局模式' },
            h(Switch, {
              checked: store.editing === true,
              onChange: (next) => {
                store.editing = next
                renderPlacements()
                store.notify()
                // The panel covers the page; step aside so the pictures can be
                // dragged where they are actually going to sit.
                if (next) props.close?.()
              },
            }),
            h('button', { className: 'aur-btn', onClick: clearPlacements }, '清除所有图片'),
          ),
        ),

        h(Section, { title: '文字' },
          h(Row, { label: '字体' },
            h('select', {
              className: 'aur-select',
              value: draft.text.family,
              onChange: (event) => setDraft((current) => ({ ...current, text: { ...current.text, family: event.target.value } })),
            },
              h('option', { value: '' }, '默认'),
              familyOptions.map((font) => h('option', { key: font.family, value: font.family, title: font.family }, font.label)),
            ),
            h('span', { className: 'aur-hint' },
              fonts.source === 'host'
                ? fonts.list.length + ' 个本机字体'
                : fonts.source === 'browser'
                  ? fonts.list.length + ' 个字体（浏览器接口，无中文名）'
                  : '通用列表 · 未能读取本机字体',
            ),
            h('button', {
              className: 'aur-btn',
              onClick: () => setFontReload((n) => n + 1),
              title: '重新从本机读取字体列表',
            }, '刷新字体'),
          ),
          h(Row, { label: '字号' },
            h(Slider, {
              value: draft.text.size || 14,
              min: 10,
              max: 24,
              unit: 'px',
              onChange: (value) => setDraft((current) => ({ ...current, text: { ...current.text, size: value } })),
            }),
          ),
          h(Row, { label: '颜色' },
            TEXT_COLORS.map((color) => h('button', {
              key: color.label,
              className: 'aur-swatch',
              title: color.label,
              'data-active': draft.text.color === color.value,
              style: {
                backgroundColor: color.value || 'transparent',
                borderStyle: color.value ? 'solid' : 'dashed',
                borderColor: color.value ? 'transparent' : 'var(--dsw-alias-border-l2)',
              },
              onClick: () => setDraft((current) => ({ ...current, text: { ...current.text, color: color.value } })),
            })),
            h('input', {
              className: 'aur-color-input',
              type: 'color',
              value: /^#[0-9a-f]{6}$/i.test(draft.text.color) ? draft.text.color : '#e8f0ff',
              onChange: (event) => setDraft((current) => ({ ...current, text: { ...current.text, color: event.target.value } })),
            }),
            h('input', {
              className: 'aur-hex',
              value: draft.text.color,
              placeholder: '#rrggbb',
              onChange: (event) => {
                const value = event.target.value.trim()
                setDraft((current) => ({ ...current, text: { ...current.text, color: value } }))
              },
            }),
          ),
          h('div', {
            className: 'aur-sample',
            style: {
              fontFamily: draft.text.family ? '"' + draft.text.family + '"' : undefined,
              fontSize: (draft.text.size || 14) + 'px',
              color: draft.text.color || undefined,
            },
          }, '永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭 — The quick brown fox jumps over the lazy dog. 0123456789'),
        ),

        h('div', { className: 'aur-footer' },
          h('button', { className: 'aur-btn', onClick: reset, disabled: busy }, '恢复默认'),
          h('button', { className: 'aur-btn aur-btn-primary', onClick: apply, disabled: busy }, busy ? '应用中…' : '应用'),
        ),

        toast ? h('div', { key: toast.id, className: 'aur-toast', style: { left: toast.left + 'px' } }, toast.text) : null,

        confirming
          ? h('div', { className: 'aur-mask', onClick: () => setConfirming(null) },
            h('div', { className: 'aur-dialog', onClick: (event) => event.stopPropagation() },
              h('div', { className: 'aur-dialog-text' }, confirming.message),
              h('div', { className: 'aur-dialog-actions' },
                h('button', { className: 'aur-btn', onClick: () => setConfirming(null) }, '取消'),
                h('button', {
                  className: 'aur-btn aur-btn-primary',
                  onClick: () => {
                    const action = confirming.action
                    setConfirming(null)
                    action()
                  },
                }, '确定'),
              ),
            ),
          )
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* Plugin entry                                                        */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots'],
      apply(ctx) {
        uiStyleElement(UI_CSS)

        ctx.effect(() => {
          return () => {
            document.getElementById(RUNTIME_STYLE_ID)?.remove()
            document.getElementById(UI_STYLE_ID)?.remove()
          }
        })

        // Drop the palette forced by the previous revision of this bundle.
        const theme = ctx.get('theme')
        if (theme) {
          try {
            if (theme.getTheme().preference === 'aurora') theme.setTheme('system')
          } catch {
            /* the theme service may still be registering */
          }
        }

        ctx.effect(() => {
          bootstrap()
          const observer = new MutationObserver((records) => {
            const additions = []
            for (const record of records) {
              for (const node of record.addedNodes) additions.push(node)
            }
            if (additions.length > 0) scheduleMarks(additions)
          })
          observer.observe(document.body, { childList: true, subtree: true })
          // Side pictures appear only in fullscreen; follow that flag.
          const fullscreenObserver = new MutationObserver(() => renderRuntime())
          fullscreenObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-fullscreen'],
          })
          const onResize = () => renderRuntime()
          window.addEventListener('resize', onResize)
          return () => {
            observer.disconnect()
            fullscreenObserver.disconnect()
            window.removeEventListener('resize', onResize)
            stopMarks()
            clearRuntime()
            releaseUrls()
          }
        })

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({
            name: 'settings.section',
            id: 'aurora-theme',
            order: 30,
            label: () => '主题外观',
          }, AuroraSection),
        )
      },
    }
  },
})
