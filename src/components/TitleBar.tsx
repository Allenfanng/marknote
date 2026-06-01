interface TitleBarProps {
  filePath: string | null
  isDirty: boolean
  onOpen: () => void
  onSave: () => void
  onNew: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function TitleBar({
  filePath,
  isDirty,
  onOpen,
  onSave,
  onNew,
  theme,
  onToggleTheme,
}: TitleBarProps) {
  const fileName = filePath
    ? filePath.split(/[\\/]/).pop()
    : 'Untitled'

  return (
    <div className="titlebar">
      <div className="titlebar-title">
        MarkNote — {fileName}
        {isDirty && <span className="dirty-dot" />}
      </div>
      <div className="titlebar-actions">
        <button onClick={onNew} title="New (Ctrl+N)">New</button>
        <button onClick={onOpen} title="Open (Ctrl+O)">Open</button>
        <button onClick={onSave} title="Save (Ctrl+S)">Save</button>
        <button onClick={onToggleTheme} title="Toggle theme">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
    </div>
  )
}
