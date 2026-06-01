import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Editor from './components/Editor'
import TitleBar from './components/TitleBar'
import './App.css'

function App() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState('# Welcome to MarkNote\n\nStart typing...\n')
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  })

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const handleOpen = useCallback(async () => {
    try {
      const path = await invoke<string | null>('open_file_dialog')
      if (path) {
        const text = await invoke<string>('read_file', { path })
        setFilePath(path)
        setContent(text)
        setIsDirty(false)
      }
    } catch (e) {
      console.error('Open failed:', e)
    }
  }, [])

  const handleSave = useCallback(async () => {
    try {
      let path = filePath
      if (!path) {
        path = await invoke<string | null>('save_file_dialog')
        if (!path) return
      }
      await invoke('write_file', { path, content })
      setFilePath(path)
      setIsDirty(false)
    } catch (e) {
      console.error('Save failed:', e)
    }
  }, [filePath, content])

  const handleNew = useCallback(() => {
    setFilePath(null)
    setContent('# Untitled\n\n')
    setIsDirty(false)
  }, [])

  const handleChange = useCallback((_markdown: string) => {
    setIsDirty(true)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleNew()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleOpen, handleNew])

  return (
    <div className="app">
      <TitleBar
        filePath={filePath}
        isDirty={isDirty}
        onOpen={handleOpen}
        onSave={handleSave}
        onNew={handleNew}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="editor-container">
        <Editor
          key={content}
          defaultValue={content}
          onChange={handleChange}
        />
      </main>
    </div>
  )
}

export default App
