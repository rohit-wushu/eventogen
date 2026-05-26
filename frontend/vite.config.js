import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Trigger reload for proxy target change

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const proxyTarget = env.VITE_API_PROXY_TARGET || 'https://ap.eletsonline.com'

    return {
        plugins: [react()],
        server: {
            proxy: {
                '/api': {
                    target: proxyTarget,
                    changeOrigin: true,
                    secure: false,
                },
                '/uploads': {
                    target: proxyTarget,
                    changeOrigin: true,
                    secure: false,
                }
            }
        }
    }
})
