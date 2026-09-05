/**
 * 图表动作：导出成独立 .svg 文件、打开全屏查看器。
 *
 * 图表预览是 ProseMirror 的 decoration widget（纯 DOM，不在 React 树里），
 * 所以这里统一用「序列化 + 自定义事件」跟 React 侧的组件通信，避免把
 * 编辑器实例拖进 React 依赖里。
 */
import { invoke } from '@tauri-apps/api/core'

/** 全屏查看器事件名；App 监听它并渲染 <DiagramViewer /> */
export const DIAGRAM_ZOOM_EVENT = 'marknote:diagram-zoom'

export interface DiagramZoomDetail {
  /** 已序列化的完整 SVG 源码（含 xml 声明，可直接落盘） */
  svg: string
  /** 标题栏显示用，如「Mermaid 图表」 */
  title: string
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 把页面里的 SVG 元素变成能独立打开的 .svg 文件源码。
 *
 * mermaid 输出的是 `width="100%"` + 内联 `max-width`，直接存盘的话用外部
 * 查看器打开会缩成一条线甚至尺寸为 0，所以这里统一换成 viewBox 里的自然
 * 宽高（固定像素），并清掉百分比/max-width 相关的内联样式。
 */
export function serializeSvg(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const isRelative = (v: string | null) => !v || /%\s*$/.test(v.trim()) || !Number.isFinite(parseFloat(v))
  const rawW = clone.getAttribute('width')
  const rawH = clone.getAttribute('height')

  let width = parseFloat(rawW ?? '')
  let height = parseFloat(rawH ?? '')

  if (isRelative(rawW) || isRelative(rawH)) {
    const viewBox = (clone.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    if (viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
      if (isRelative(rawW)) width = viewBox[2]
      if (isRelative(rawH)) height = viewBox[3]
    }
  }

  if (Number.isFinite(width) && width > 0) clone.setAttribute('width', String(Math.round(width)))
  else clone.removeAttribute('width')
  if (Number.isFinite(height) && height > 0) clone.setAttribute('height', String(Math.round(height)))
  else clone.removeAttribute('height')

  for (const prop of ['max-width', 'max-height', 'width', 'height']) {
    clone.style.removeProperty(prop)
  }

  const xml = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`
}

/** 浏览器环境（vite dev，没有 Tauri 后端）下退化成直接下载 */
function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 弹出保存对话框把 SVG 写到磁盘。
 * 返回 null 表示用户取消了，true / false 表示是否落盘成功。
 */
export async function exportSvgFile(
  svg: SVGSVGElement,
  defaultName: string,
): Promise<boolean | null> {
  const content = serializeSvg(svg)
  if (!content) return false

  if (!isTauri()) {
    downloadTextFile(content, defaultName, 'image/svg+xml')
    return true
  }

  const path = await invoke<string | null>('save_file_as', {
    defaultName,
    title: '导出 SVG 图片',
    filters: [{ name: 'SVG 图片', extensions: ['svg'] }],
  })
  if (!path) return null

  // 对话框不带扩展名时补一个（Windows 上用户可能只输入文件名）
  const finalPath = /\.[A-Za-z0-9]+$/.test(path) ? path : `${path}.svg`
  await invoke('write_file', { path: finalPath, content })
  return true
}

/** 图表预览点击"放大"：通知 React 打开全屏查看器 */
export function openDiagramViewer(detail: DiagramZoomDetail): void {
  document.dispatchEvent(new CustomEvent<DiagramZoomDetail>(DIAGRAM_ZOOM_EVENT, { detail }))
}
