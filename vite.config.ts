import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { audioWorklet } from './vite/audio-worklet.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), audioWorklet()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
