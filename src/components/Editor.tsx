import { useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'

// Crepe themes
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/classic.css'
import '@milkdown/crepe/theme/classic-dark.css'

interface EditorProps {
  defaultValue?: string
  onChange?: (markdown: string) => void
}

function EditorInner({ defaultValue = '', onChange }: EditorProps) {
  const crepeRef = useRef<Crepe | null>(null)

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue,
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChange?.(markdown)
      })
    })

    crepeRef.current = crepe
    return crepe
  }, [])

  return <Milkdown />
}

export default function Editor({ defaultValue, onChange }: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorInner defaultValue={defaultValue} onChange={onChange} />
    </MilkdownProvider>
  )
}
