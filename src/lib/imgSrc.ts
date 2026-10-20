/**
 * 本地图片路径解析：把 markdown 里的相对/绝对本地图片路径转换为
 * Tauri asset protocol URL（http://asset.localhost/<encoded>），使
 * WebView 里也能显示磁盘上的图片。
 *
 * 三条链路共用：
 *  - WYSIWYG（Editor.tsx 的 image nodeView）
 *  - 编辑器加载期的即时预览（App.tsx markdownToHtml）
 *  - 导出 HTML 时保持原样（相对路径 + assets/ 同目录放置即可显示），不转换
 */
import { convertFileSrc } from '@tauri-apps/api/core'

/** 已经是 WebView 可直接加载的协议 */
const ABSOLUTE_URL = /^(https?:|data:|blob:|asset:|file:|http:\/\/asset\.localhost)/i
/** Windows 盘符绝对路径（C:\ / C:/）或 UNC（\\server\share） */
const WIN_ABSOLUTE = /^([a-zA-Z]:[\\/]|\\\\)/
/** Unix 绝对路径 */
const UNIX_ABSOLUTE = /^\//

/** 文档所在目录（filePath 去掉最后一段）；无文件路径返回 null */
export function getDocDir(filePath: string | null): string | null {
  if (!filePath) return null
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  if (idx <= 0) return null
  return filePath.slice(0, idx)
}

/** 极简路径 join：统一斜杠、消解 ./ 与 ../（够用于文档相对图片，不追求全覆盖） */
export function joinRelPath(baseDir: string, rel: string): string {
  const baseParts = baseDir.replace(/\\/g, '/').split('/')
  // Windows 盘符（C:）保留；网络位置（//server）保留
  const isUnc = baseDir.startsWith('\\\\') || baseDir.startsWith('//')
  const parts = isUnc ? baseParts.slice(2) : baseParts[1]?.endsWith(':') ? baseParts.slice(1) : baseParts
  const prefix = isUnc ? '//' : baseParts[1]?.endsWith(':') ? `${baseParts[0]}/` : ''

  const stack = [...parts.filter(Boolean)]
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      // 不越过根
      if (stack.length > 0 && !stack[stack.length - 1].endsWith(':')) stack.pop()
    } else {
      stack.push(seg)
    }
  }
  return prefix + stack.join('/')
}

/** markdown 里的 src（可能已被 HTML 转义）→ WebView 可加载的 URL */
export function resolveImgSrc(rawSrc: string, docDir: string | null): string {
  const src = rawSrc.replace(/&amp;/g, '&').trim()
  if (!src) return rawSrc
  if (ABSOLUTE_URL.test(src)) return src
  if (WIN_ABSOLUTE.test(src)) return safeConvert(src)
  if (UNIX_ABSOLUTE.test(src)) return safeConvert(src)
  if (docDir) return safeConvert(joinRelPath(docDir, src))
  // 文档未保存（无目录可参照）：原样返回，交给浏览器（大概率显示占位）
  return src
}

/** 非 Tauri 环境（纯 vite dev）下 convertFileSrc 会抛错，兜底原样返回 */
function safeConvert(absPath: string): string {
  try {
    if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) return absPath
    return convertFileSrc(absPath)
  } catch {
    return absPath
  }
}
