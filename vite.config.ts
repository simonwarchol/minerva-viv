import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve('./src/main.tsx'),
      name: 'MinervaViv',
      // the proper extensions will be added
      fileName: 'minerva-viv',
    },
  },
  plugins: [react()],
})
