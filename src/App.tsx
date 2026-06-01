import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import Editor, { type EditorHandle } from './components/Editor'
import TitleBar from './components/TitleBar'
import Toolbar from './components/Toolbar'
import SourceView from './components/SourceView'
import './App.css'

const MD_EXTENSIONS = ['.md', '.markdown', '.txt']

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase()
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function openFileInNewWindow(filePath: string) {
  const label = `marknote-${Date.now()}`
  const url = `/?file=${encodeURIComponent(filePath)}`
  new WebviewWindow(label, {
    url,
    title: filePath.split(/[\\/]/).pop() ?? 'MarkNote',
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    center: true,
  })
}

function App() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState('# Welcome to MarkNote\n\nStart typing...\n')
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  })
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg')
  const editorRef = useRef<EditorHandle | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Source mode content (separate from WYSIWYG to allow round-trip)
  const [sourceContent, setSourceContent] = useState(content)

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const loadFile = useCallback(async (path: string) => {
    try {
      const text = await invoke<string>('read_file', { path })
      setFilePath(path)
      setContent(text)
      setSourceContent(text)
      setIsDirty(false)
    } catch (e) {
      console.error('Failed to load file:', e)
    }
  }, [])

  // On startup, check if this window was opened with a file parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fileParam = params.get('file')
    if (fileParam) loadFile(fileParam)
  }, [loadFile])

  const handleOpen = useCallback(async () => {
    try {
      const path = await invoke<string | null>('open_file_dialog')
      if (path) await loadFile(path)
    } catch (e) {
      console.error('Open failed:', e)
    }
  }, [loadFile])

  const handleSave = useCallback(async () => {
    try {
      let path = filePath
      if (!path) {
        path = await invoke<string | null>('save_file_dialog')
        if (!path) return
      }
      // Get current content based on view mode
      const currentContent = viewMode === 'source' ? sourceContent : content
      await invoke('write_file', { path, content: currentContent })
      setFilePath(path)
      setIsDirty(false)
    } catch (e) {
      console.error('Save failed:', e)
    }
  }, [filePath, content, sourceContent, viewMode])

  const handleNew = useCallback(() => {
    setFilePath(null)
    const initial = '# Untitled\n\n'
    setContent(initial)
    setSourceContent(initial)
    setIsDirty(false)
  }, [])

  const handleEditorChange = useCallback((markdown: string) => {
    setContent(markdown)
    setIsDirty(true)
  }, [])

  const handleSourceChange = useCallback((value: string) => {
    setSourceContent(value)
    setIsDirty(true)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === 'wysiwyg') {
        // WYSIWYG -> Source: sync content from editor
        const md = editorRef.current?.getMarkdown() ?? content
        setSourceContent(md)
        return 'source'
      } else {
        // Source -> WYSIWYG: sync content from source
        setContent(sourceContent)
        setEditorReady(false)
        return 'wysiwyg'
      }
    })
  }, [content, sourceContent])

  // Poll for editor readiness (needed because Milkdown creates async)
  useEffect(() => {
    if (editorReady || viewMode !== 'wysiwyg') return
    const id = setInterval(() => {
      if (editorRef.current?.ready) {
        setEditorReady(true)
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [editorReady, viewMode])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      } else if (mod && e.key === 'n') {
        e.preventDefault()
        handleNew()
      } else if (mod && e.key === '/') {
        e.preventDefault()
        toggleViewMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleOpen, handleNew, toggleViewMode])

  // Tauri v2 drag-drop — open dropped file in a new window
  useEffect(() => {
    const webview = getCurrentWebview()
    const unlistenPromise = webview.onDragDropEvent((event) => {
      if (event.payload.type === 'enter') {
        setIsDragging(true)
      } else if (event.payload.type === 'drop') {
        setIsDragging(false)
        const mdFile = event.payload.paths.find(isMarkdownFile)
        if (mdFile) openFileInNewWindow(mdFile)
      } else if (event.payload.type === 'leave') {
        setIsDragging(false)
      }
    })
    return () => {
      unlistenPromise.then((fn) => fn())
    }
  }, [])

  return (
    <div className="app">
      <TitleBar
        filePath={filePath}
        isDirty={isDirty}
        theme={theme}
        onToggleTheme={toggleTheme}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
      />
      <Toolbar
        editor={editorRef.current}
        disabled={viewMode === 'source' || !editorReady}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
      />
      {viewMode === 'wysiwyg' ? (
        <main className="editor-container">
          <Editor
            key={content}
            defaultValue={content}
            onChange={handleEditorChange}
            editorRef={editorRef}
          />
        </main>
      ) : (
        <SourceView value={sourceContent} onChange={handleSourceChange} />
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">Drop to open in new window</div>
        </div>
      )}
    </div>
  )
}

export default App
