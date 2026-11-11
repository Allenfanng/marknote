/**
 * 文档大纲：ATX 标题解析（跳过代码块围栏）。
 * 单一来源，供侧边栏大纲与源码模式跳转共用（此前 App 内重复了两套扫描）。
 */
export interface OutlineHeading {
  level: number
  text: string
}

const FENCE = /^(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*)$/

function cleanHeadingText(raw: string): string {
  return raw.replace(/\s+#+\s*$/, '').trim()
}

/** 解析全部 ATX 标题；代码块内的 # 不误判 */
export function parseOutline(content: string): OutlineHeading[] {
  const out: OutlineHeading[] = []
  let inFence = false
  for (const line of content.split('\n')) {
    const trimmed = line.trimStart()
    if (FENCE.test(trimmed)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = line.match(HEADING)
    if (m) out.push({ level: m[1].length, text: cleanHeadingText(m[2]) })
  }
  return out
}

/** 找到指定标题文本所在行号（源码模式跳转用）；未找到返回 -1 */
export function findHeadingLine(content: string, text: string): number {
  let inFence = false
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    if (FENCE.test(trimmed)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = lines[i].match(HEADING)
    if (m && cleanHeadingText(m[2]) === text) return i
  }
  return -1
}