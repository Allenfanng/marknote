import { useEffect, useMemo, useState } from 'react'

interface StatusBarProps {
  content: string
  fontSize: number
}

function countStats(text: string): { chars: number; words: number } {
  // Remove markdown syntax for cleaner counting
  const clean = text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/[#*_~`>\[\]\(\)!\-|]/g, '')
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

export default function StatusBar({ content, fontSize }: StatusBarProps) {
  const [selectionText, setSelectionText] = useState('')

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

  // Switching tabs rebuilds the editor — drop the stale selection.
  useEffect(() => { setSelectionText('') }, [content])

  const stats = useMemo(() => countStats(content), [content])
  const selectionWords = useMemo(
    () => (selectionText ? countStats(selectionText).words : null),
    [selectionText]
  )
  const startupMs = useMemo(() => {
    const start = (window as any).__appStart as number | undefined
    return start ? Math.round(performance.now() - start) : 0
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
