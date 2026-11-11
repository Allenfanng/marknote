import { useEffect, useMemo, useState } from 'react'

interface StatusBarProps {
  content: string
  fontSize: number
  /** 活动标签 id：切换标签时清空选中统计（而非每次输入都清） */
  tabId: string
}

function countStats(text: string): { chars: number; words: number } {
  // Remove markdown syntax for cleaner counting
  const clean = text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/[#*_~`>[\]()!|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Character count: all non-whitespace characters
  const chars = clean.replace(/\s/g, '').length

  // Word count: CJK characters counted individually, English words by spaces
  const cjkMatch = clean.match(/[一-鿿㐀-䶿豈-﫿]/g)
  const cjkCount = cjkMatch ? cjkMatch.length : 0
  const withoutCjk = clean.replace(/[一-鿿㐀-䶿豈-﫿]/g, ' ')
  const enWords = withoutCjk.split(/\s+/).filter((w) => w.length > 0)
  const enCount = enWords.length

  return { chars, words: cjkCount + enCount }
}

// Read the current text selection. Textareas (source mode) are not exposed by
// window.getSelection, so their selection is read via selectionStart/End; the
// WYSIWYG editor is a real contenteditable DOM and works with getSelection.
function readSelection(target: EventTarget | null): string {
  if (target instanceof HTMLTextAreaElement) {
    return target.value.slice(target.selectionStart, target.selectionEnd)
  }
  return window.getSelection()?.toString() ?? ''
}

declare global {
  interface Window {
    /** index.html 启动打点（performance.now 快照） */
    __appStart?: number
  }
}

export default function StatusBar({ content, fontSize, tabId }: StatusBarProps) {
  const [selectionText, setSelectionText] = useState('')
  const [startupMs, setStartupMs] = useState(0)

  useEffect(() => {
    const handler = (e: Event) => setSelectionText(readSelection(e.target))
    // `selectionchange` covers contenteditable (WYSIWYG) and modern Chromium
    // textareas; `select` is the classic fallback for textarea selections.
    document.addEventListener('selectionchange', handler)
    document.addEventListener('select', handler)
    return () => {
      document.removeEventListener('selectionchange', handler)
      document.removeEventListener('select', handler)
    }
  }, [])

  // 切换标签时丢弃 stale 选中统计。依赖 tabId 而非 content：
  // 依赖 content 会让每次输入都清空「已选 X 词」（T1-10）。
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 标签切换时一次性重置，非级联
  useEffect(() => { setSelectionText('') }, [tabId])

  // 字数统计防抖 300ms：避免每次按键全文跑多趟正则（大文档输入卡顿）
  const [debouncedContent, setDebouncedContent] = useState(content)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 300)
    return () => clearTimeout(t)
  }, [content])
  const stats = useMemo(() => countStats(debouncedContent), [debouncedContent])
  const selectionWords = useMemo(
    () => (selectionText ? countStats(selectionText).words : null),
    [selectionText]
  )

  // 启动耗时在 mount 后读一次（render 期调用 performance.now() 属不纯函数）
  useEffect(() => {
    const start = window.__appStart
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount 时一次性计算
    if (start) setStartupMs(Math.round(performance.now() - start))
  }, [])

  return (
    <div className="status-bar">
      {selectionWords !== null && (
        <>
          <span className="status-item status-selection">已选: {selectionWords} 词</span>
          <span className="status-divider">|</span>
        </>
      )}
      <span className="status-item">字符: {stats.chars}</span>
      <span className="status-divider">|</span>
      <span className="status-item">词数: {stats.words}</span>
      <span className="status-divider">|</span>
      <span className="status-item">软件启动时间：{startupMs}ms</span>
      <span className="status-divider">|</span>
      <span className="status-item">字号: {fontSize}px (Ctrl+滚轮缩放)</span>
    </div>
  )
}
