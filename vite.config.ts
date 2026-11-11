import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-lucide'
          }
          // mermaid / katex 不再强制命名合块：
          //  - mermaid 由 diagram.ts 的 import('mermaid') 自然切成异步块，按需加载
          //  - katex 随 Crepe latex 特性进 Editor 异步块
          // 此前把两者合进 vendor-mermaid，而 latex 静态依赖 katex，导致该 3.35MB
          // 块被入口静态引用 + modulepreload，懒加载失效、冷启动多加载 3.35MB。
        },
      },
    },
  },
})
