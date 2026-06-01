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
        placeholder="Start writing Markdown..."
        spellCheck={false}
      />
    </div>
  )
}
