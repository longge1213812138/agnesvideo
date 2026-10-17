import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base 用相对路径，产物既能被本地静态服务托管，也能直接 file:// 打开（见 ADR-0001）
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
