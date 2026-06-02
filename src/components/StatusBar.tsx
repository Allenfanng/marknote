import { useMemo } from 'react'

interface StatusBarProps {
  content: string
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
  const cjkMatch = clean.match(/[一-鿿㐀-䶿豈-﫿]/g)
  const cjkCount = cjkMatch ? cjkMatch.length : 0
  const withoutCjk = clean.replace(/[一-鿿㐀-䶿豈-﫿]/g, ' ')
  const enWords = withoutCjk.split(/\s+/).filter((w) => w.length > 0)
  const enCount = enWords.length

  return { chars, words: cjkCount + enCount }
}

export default function StatusBar({ content }: StatusBarProps) {
  const stats = useMemo(() => countStats(content), [content])

  return (
    <div className="status-bar">
      <span className="status-item">字符: {stats.chars}</span>
      <span className="status-divider">|</span>
      <span className="status-item">词数: {stats.words}</span>
    </div>
  )
}
