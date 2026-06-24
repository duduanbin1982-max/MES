import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^vue$/, replacement: path.resolve(__dirname, 'src/vue-shim.js') }
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 3891,
    proxy: {
      '/api': {
        target: 'http://localhost:3890',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue-router', 'pinia'],
          'vendor-element': ['element-plus', '@element-plus/icons-vue'],
          'vendor-echarts': ['echarts', 'vue-echarts']
        }
      }
    }
  }
})
