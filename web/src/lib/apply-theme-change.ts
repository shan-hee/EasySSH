let cleanupFrame: number | undefined
let transitionStyle: HTMLStyleElement | undefined

// Apply tokens and theme mode in the same paint without animating old colors into new ones.
export function applyThemeChange(update: () => void) {
  if (cleanupFrame !== undefined) cancelAnimationFrame(cleanupFrame)
  if (!transitionStyle) {
    transitionStyle = document.createElement("style")
    transitionStyle.textContent = "*,*::before,*::after{transition:none!important}"
    document.head.appendChild(transitionStyle)
  }
  try {
    update()
  } finally {
    // Resolve new styles while transitions are disabled, before allowing another paint.
    void window.getComputedStyle(document.documentElement).color
    cleanupFrame = requestAnimationFrame(() => {
      cleanupFrame = requestAnimationFrame(() => {
        transitionStyle?.remove()
        transitionStyle = undefined
        cleanupFrame = undefined
      })
    })
  }
}
