interface SourceViewProps {
  value: string
  onChange: (value: string) => void
}

export default function SourceView({ value, onChange }: SourceViewProps) {
  return (
    <div className="source-view">
      <textarea
        className="source-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="开始编写 Markdown…"
        spellCheck={false}
      />
    </div>
  )
}
