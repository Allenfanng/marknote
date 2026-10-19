import type { RefObject } from 'react'

interface SourceViewProps {
  value: string
  onChange: (value: string) => void
  /** 供 App 层读取/恢复滚动位置与光标（标签页切换记忆） */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export default function SourceView({ value, onChange, textareaRef }: SourceViewProps) {
  return (
    <div className="source-view">
      <textarea
        ref={textareaRef}
        className="source-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="开始编写 Markdown…"
        spellCheck={false}
      />
    </div>
  )
}
