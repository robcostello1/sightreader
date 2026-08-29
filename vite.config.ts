import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { audioWorklet } from './vite/audio-worklet.ts'

// getUserMedia needs a secure context, and only localhost is exempt. Serving to
// another device on the network therefore has to be over HTTPS, so `npm run
// dev:lan` sets LAN=1 and adds a self-signed certificate. Plain `npm run dev`
// stays on HTTP, which is fine because it is reached over localhost.
const overLan = process.env.LAN === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), audioWorklet(), ...(overLan ? [basicSsl()] : [])],
  server: overLan ? { host: true } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
