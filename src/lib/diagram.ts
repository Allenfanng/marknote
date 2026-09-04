/**
 * 图表渲染：Mermaid（流程图 / 时序图 / 甘特图等）+ 原生 SVG。
 *
 * mermaid 体积较大（约 1MB），因此只走动态 import —— 只有文档里真的出现
 * mermaid 代码块时才加载，不影响冷启动速度。
 */

const MERMAID_LANGS = new Set(['mermaid', 'mmd'])
const SVG_LANGS = new Set(['svg'])

export type DiagramLang = 'mermaid' | 'svg'

export function getDiagramLang(lang: string): DiagramLang | null {
  const l = lang.trim().toLowerCase()
  if (MERMAID_LANGS.has(l)) return 'mermaid'
  if (SVG_LANGS.has(l)) return 'svg'
  return null
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ------------------------------------------------------------------ *
 * 原生 SVG：清洗后内联
 * ------------------------------------------------------------------ */

/**
 * 解析并清洗一段 SVG 源码：去掉脚本、外部实体、事件属性、javascript: 链接，
 * 并把固定宽高换成可伸缩的 viewBox 布局。非法输入返回空字符串。
 */
export function sanitizeSvg(raw: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return ''

  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return ''

  svg.querySelectorAll('script, foreignObject, iframe, object, embed, use').forEach((n) => n.remove())

  svg.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
      } else if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name)
      }
    }
  })

  // 没有 viewBox 时补一个，保证可以按容器等比缩放；原始宽高保留，
  // 让图按自然尺寸显示（上限交给 .diagram-preview-body 的 max-width）
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '')
    const h = parseFloat(svg.getAttribute('height') ?? '')
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
  }
  return svg.outerHTML
}

/* ------------------------------------------------------------------ *
 * Mermaid：异步渲染 + 按 (主题, 源码) 缓存
 * ------------------------------------------------------------------ */

let mermaidTheme: 'default' | 'dark' = 'default'
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
const svgCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: mermaidTheme,
      })
      return mermaid
    })
  }
  return mermaidPromise
}

/** 切换 mermaid 主题；之后渲染的图会跟着变（缓存按主题分桶）。 */
export function setMermaidTheme(theme: 'light' | 'dark'): void {
  mermaidTheme = theme === 'dark' ? 'dark' : 'default'
  if (mermaidPromise) {
    mermaidPromise.then((mermaid) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mermaidTheme })
    })
  }
}

export function clearDiagramCache(): void {
  svgCache.clear()
}

/** 已渲染过的图直接命中缓存，避免每次重绘都跑一遍 mermaid。 */
export function getCachedMermaid(code: string): string | undefined {
  return svgCache.get(`${mermaidTheme}|${code}`)
}

let renderSeq = 0

export async function renderMermaid(code: string): Promise<string> {
  const key = `${mermaidTheme}|${code}`
  const hit = svgCache.get(key)
  if (hit !== undefined) return hit

  const running = inflight.get(key)
  if (running) return running

  const task = (async () => {
    const mermaid = await loadMermaid()
    const id = `marknote-mermaid-${++renderSeq}`
    const { svg } = await mermaid.render(id, code)
    svgCache.set(key, svg)
    return svg
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

/* ------------------------------------------------------------------ *
 * 导出 / 预览：把 markdown 里的图表代码块换成占位符
 * ------------------------------------------------------------------ */

export interface PreparedDiagrams {
  /** 图表已抽成 \x00DG{n}\x00 占位符的 markdown */
  text: string
  /** 占位符对应的 HTML 片段 */
  blocks: string[]
}

/**
 * 抽出所有 mermaid / svg 代码块并渲染成 HTML，原位置留下 \x00DG{n}\x00
 * 占位符，交给 markdownToHtml 回填。mermaid 是异步的，所以整体也异步
 * —— 只给导出 HTML/PDF 用；编辑器里的即时预览走同步路径，不渲染 mermaid。
 */
export async function prepareDiagrams(md: string): Promise<PreparedDiagrams> {
  // 局部正则：循环体里有 await，共享的全局正则 + lastIndex 在并发调用下会串
  const fence = /```([A-Za-z]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g
  const blocks: string[] = []
  let text = ''
  let lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = fence.exec(md)) !== null) {
    const lang = getDiagramLang(match[1])
    if (!lang) continue

    const code = match[2].replace(/\r?\n$/, '')
    text += md.slice(lastIndex, match.index)
    lastIndex = match.index + match[0].length

    if (lang === 'svg') {
      const svg = sanitizeSvg(code)
      blocks.push(
        svg
          ? `<div class="diagram-svg">${svg}</div>`
          : `<pre><code class="language-svg">${escapeHtml(code)}</code></pre>`
      )
    } else {
      try {
        const svg = await renderMermaid(code)
        blocks.push(`<div class="diagram-mermaid">${svg}</div>`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        blocks.push(
          `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>` +
            `<p class="diagram-error">图表渲染失败：${escapeHtml(msg)}</p>`
        )
      }
    }
    text += `\x00DG${blocks.length - 1}\x00`
  }
  text += md.slice(lastIndex)
  return { text, blocks }
}
