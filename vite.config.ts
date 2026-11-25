import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import studioUI from '@nuxt/ui/vite'

const compress = promisify(gzip)
function compressAssets(): Plugin {
  return {
    name: 'studio-gzip-assets',
    async writeBundle(output, bundle) {
      if (!output.dir) return
      const directory = output.dir
      await Promise.all(Object.values(bundle)
        .filter(asset => asset.fileName.startsWith('assets/') && /\.(js|css)$/.test(asset.fileName))
        .map(async asset => {
          const bytes = await compress(asset.type === 'chunk' ? asset.code : asset.source, { level: 9 })
          await writeFile(join(directory, asset.fileName + '.gz'), bytes)
        }))
    },
  }
}

export default defineConfig({
  plugins: [vue(), studioUI({
    router: false, colorMode: false, dts: false, autoImport: false, components: false,
    experimental: { componentDetection: ['Button', 'Textarea', 'ChatPrompt'] },
    ui: { colors: { primary: 'violet', neutral: 'slate' } },
  }), compressAssets()],
  server: { proxy: { '/api': 'http://127.0.0.1:4175' } },
  build: { chunkSizeWarningLimit: 560 }
})
