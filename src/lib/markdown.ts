/**
 * 统一的 Markdown → HTML 渲染（即时预览 + 导出 HTML/PDF 共用）。
 *
 * v1.9 起用手写的 markdownToHtml 正则版退役，改用 markdown-it：
 *  - 渲染结果与编辑器（Milkdown/CommonMark）行为一致，不再各说各话
 *  - 链接/URL 由 markdown-it 的 validateLink 负责，javascript: 等默认拦截
 *  - ```svg 代码块就地渲染成内联 SVG；```mermaid 由调用方先经
 *    prepareDiagrams 渲染成 \uE000n\uE001 占位符，渲染后回填
 */
import MarkdownIt from 'markdown-it'
import { escapeHtml, sanitizeSvg, diagramPlaceholderRegex } from './diagram'
import { resolveImgSrc } from './imgSrc'

/** 占位符（与 diagram.ts 共用同一套私用区字符） */
export function diagramPlaceholder(index: number): string {
  return `\uE000${index}\uE001`
}

const md: MarkdownIt = new MarkdownIt({
  html: false, // 不渲染原始 HTML 标签（防 XSS，与编辑器行为一致）
  linkify: true,
  breaks: false,
})

// data:image/ 放行（粘贴图片的兜底路径产生 data URI），其余 data: 仍拦截
const baseValidateLink = md.validateLink
md.validateLink = (url: string): boolean => {
  if (/^data:image\//i.test(url)) return true
  if (typeof baseValidateLink === 'function') return baseValidateLink(url)
  return true
}

// ```svg → 内联渲染；其余语言走默认 code fence
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (lang === 'svg') {
    const svg = sanitizeSvg(token.content.replace(/\r?\n$/, ''))
    if (svg) return `<div class="diagram-svg">${svg}</div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}

// 图片 src：相对/绝对本地路径 → asset:// URL（imgBaseDir 为 null 时原样输出）
const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const srcIdx = token.attrIndex('src')
  if (srcIdx >= 0 && token.attrs) {
    const baseDir = (env as { imgBaseDir?: string | null } | undefined)?.imgBaseDir ?? null
    token.attrs[srcIdx][1] = resolveImgSrc(token.attrs[srcIdx][1], baseDir)
  }
  return defaultImage(tokens, idx, options, env, self)
}

/**
 * 渲染 markdown 为 HTML。
 * @param md markdown 原文
 * @param diagramBlocks prepareDiagrams 预渲染的图表 HTML（按占位符下标回填）
 * @param imgBaseDir 文档所在目录（本地图片解析用）；导出时为 null（保持相对路径）
 */
export function renderMarkdown(
  source: string,
  diagramBlocks: string[] = [],
  imgBaseDir: string | null = null,
): string {
  // 先摘出 YAML frontmatter，否则 markdown-it 会把 --- 之间的行渲染成
  // 段落/表格，结尾 --- 变成 hr
  let frontmatterHtml = ''
  let body = source
  const fmMatch = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (fmMatch) {
    frontmatterHtml = `<pre class="frontmatter">${escapeHtml(fmMatch[1])}</pre>`
    body = source.slice(fmMatch[0].length)
  }

  const html = md.render(body, { imgBaseDir })
  if (diagramBlocks.length === 0) return frontmatterHtml + html
  // 回填图表占位符（markdown-it 会把私用区字符原样带进文本节点）
  return (
    frontmatterHtml +
    html.replace(
      diagramPlaceholderRegex,
      (_m: string, i: string) => diagramBlocks[Number(i)] ?? '',
    )
  )
}
