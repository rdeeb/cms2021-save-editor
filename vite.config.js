import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // './' makes asset paths relative so the build works on GitHub Pages
  // (or any subdirectory) without configuration changes.
  base: './',
})
