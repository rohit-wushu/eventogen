import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Trigger reload for proxy target change

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const proxyTarget = env.VITE_API_PROXY_TARGET || 'https://ap.eletsonline.com'

    const isProd = mode === 'production'

    return {
        plugins: [react()],
        // Strip ALL console.* calls and debugger statements from production
        // bundles. Dev builds keep everything intact. Runtime exceptions still
        // surface as red errors in the browser via the engine — only explicit
        // console.log/warn/error/debug calls are removed.
        esbuild: {
            drop: isProd ? ['console', 'debugger'] : [],
        },
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
