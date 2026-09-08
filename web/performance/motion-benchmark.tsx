import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { motion } from 'motion/react'
import { motionDurations, motionEase } from '../src/lib/motion'

// A deliberately small reference animation, built separately from the app.
// It establishes the browser's frame pacing floor, not feature equivalence.
function Benchmark() {
  const [open, setOpen] = useState(false)
  return (
    <main style={{ background: '#f7f7f8', height: '100vh', font: '14px sans-serif', overflow: 'hidden' }}>
      <button onClick={() => setOpen(value => !value)} style={{ margin: 16 }}>切换 Motion 面板</button>
      <div style={{ position: 'relative', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
        <motion.aside
          initial={false}
          animate={{ x: open ? 0 : -280, opacity: open ? 1 : 0 }}
          transition={{ duration: motionDurations.content, ease: motionEase }}
          style={{ width: 280, height: '100%', background: '#fff', borderRight: '1px solid #ddd', boxSizing: 'border-box', padding: 16 }}
        >
          <strong>Motion 参考面板</strong>
          {Array.from({ length: 20 }, (_, i) => <p key={i}>参考内容 {i + 1}</p>)}
        </motion.aside>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Benchmark />)
