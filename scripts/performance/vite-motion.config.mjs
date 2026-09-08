import { fileURLToPath } from 'node:url'

export default {
  root: fileURLToPath(new URL('../../web/performance', import.meta.url)),
  build: {
    outDir: process.env.PERF_MOTION_DIST || '/tmp/easyssh-terminal-perf/motion-dist',
    emptyOutDir: true,
  },
}
