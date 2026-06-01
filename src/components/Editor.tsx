import { useRef, useImperativeHandle, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { callCommand } from '@milkdown/utils'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  wrapInBlockquoteCommand,
  toggleLinkCommand,
  insertImageCommand,
  isMarkSelectedCommand,
  isNodeSelectedCommand,
  strongSchema,
  emphasisSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  codeBlockSchema,
  blockquoteSchema,
} from '@milkdown/kit/preset/commonmark'
import {
  toggleStrikethroughCommand,
  strikethroughSchema,
} from '@milkdown/kit/preset/gfm'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'

import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/classic.css'
import '@milkdown/crepe/theme/classic-dark.css'

export interface ActiveState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  heading: number | null
  bulletList: boolean
  orderedList: boolean
  codeBlock: boolean
  blockquote: boolean
}

export interface EditorHandle {
  ready: boolean
  getMarkdown: () => string
  toggleBold: () => void
  toggleItalic: () => void
  toggleStrikethrough: () => void
  setHeading: (level: 1 | 2 | 3) => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  insertCodeBlock: () => void
  toggleBlockquote: () => void
  insertLink: (href: string) => void
  insertImage: (src: string, alt?: string) => void
  getActiveState: () => ActiveState
}

const defaultActive: ActiveState = {
  bold: false,
  italic: false,
  strikethrough: false,
  heading: null,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  blockquote: false,
}

interface EditorInnerProps {
  defaultValue: string
  onChange: (markdown: string) => void
  editorRef: React.RefObject<EditorHandle | null>
}

function EditorInner({ defaultValue, onChange, editorRef }: EditorInnerProps) {
  const crepeRef = useRef<Crepe | null>(null)

  const { get } = useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue,
      features: {
        'block-edit': false,
        toolbar: false,
        'top-bar': false,
      },
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChange(markdown)
      })
    })

    crepeRef.current = crepe
    return crepe
  }, [])

  const [initialized, setInitialized] = useState(false)
  if (!initialized && get()) {
    setInitialized(true)
  }

  useImperativeHandle(editorRef, () => ({
    ready: initialized,
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
    toggleBold: () => { get()?.action(callCommand(toggleStrongCommand.key)) },
    toggleItalic: () => { get()?.action(callCommand(toggleEmphasisCommand.key)) },
    toggleStrikethrough: () => { get()?.action(callCommand(toggleStrikethroughCommand.key)) },
    setHeading: (level) => { get()?.action(callCommand(wrapInHeadingCommand.key, level)) },
    toggleBulletList: () => { get()?.action(callCommand(wrapInBulletListCommand.key)) },
    toggleOrderedList: () => { get()?.action(callCommand(wrapInOrderedListCommand.key)) },
    insertCodeBlock: () => { get()?.action(callCommand(createCodeBlockCommand.key)) },
    toggleBlockquote: () => { get()?.action(callCommand(wrapInBlockquoteCommand.key)) },
    insertLink: (href) => { get()?.action(callCommand(toggleLinkCommand.key, { href })) },
    insertImage: (src, alt) => { get()?.action(callCommand(insertImageCommand.key, { src, alt })) },
    getActiveState: () => {
      const editor = get()
      if (!editor) return defaultActive
      return editor.action((ctx) => {
        const commands = ctx.get(commandsCtx)
        const view = ctx.get(editorViewCtx)
        const { $from } = view.state.selection

        let headingLevel: number | null = null
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (node.type.name === 'heading') {
            headingLevel = node.attrs.level as number
            break
          }
        }

        return {
          bold: commands.call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
          italic: commands.call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
          strikethrough: commands.call(isMarkSelectedCommand.key, strikethroughSchema.type(ctx)),
          heading: headingLevel,
          bulletList: commands.call(isNodeSelectedCommand.key, bulletListSchema.type(ctx)),
          orderedList: commands.call(isNodeSelectedCommand.key, orderedListSchema.type(ctx)),
          codeBlock: commands.call(isNodeSelectedCommand.key, codeBlockSchema.type(ctx)),
          blockquote: commands.call(isNodeSelectedCommand.key, blockquoteSchema.type(ctx)),
        }
      })
    },
  }), [get, initialized])

  return <Milkdown />
}

interface EditorProps {
  defaultValue: string
  onChange: (markdown: string) => void
  editorRef: React.RefObject<EditorHandle | null>
}

export default function Editor({ defaultValue, onChange, editorRef }: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorInner
        defaultValue={defaultValue}
        onChange={onChange}
        editorRef={editorRef}
      />
    </MilkdownProvider>
  )
}
