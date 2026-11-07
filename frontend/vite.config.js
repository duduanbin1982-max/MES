import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      dts: false,
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
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
    chunkSizeWarningLimit: 1200,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/vue-router/') || id.includes('/node_modules/pinia/')) return 'vendor-vue'
          if (id.includes('/node_modules/echarts/') || id.includes('/node_modules/zrender/')) return 'vendor-echarts'
          if (id.includes('/node_modules/element-plus/') || id.includes('/node_modules/@element-plus/icons-vue/')) return 'vendor-element'
        }
      }
    }
  }
})
