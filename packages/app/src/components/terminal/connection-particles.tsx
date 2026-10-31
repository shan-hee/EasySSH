import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowLeftRight,
  Check,
  Globe,
  KeyRound,
  LockKeyhole,
  Network,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  SquareTerminal,
  Ticket,
  Unplug,
  UserRoundCheck,
  X,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { AnimatedStateText } from "@/components/motion/animated-state-text"
import { contrastRatio } from "@/lib/color-utils"
import { cn } from "@/lib/utils"
import { ConnectionStatus } from "./connection-status"

export type ConnectionParticlesPhase = "connecting" | "success" | "failed"

/** 连接阶段，决定循环展示的图标组和状态文字。 */
export type ConnectionParticlesStage =
  | "preparing"
  | "transport"
  | "session"
  | "auth"
  | "reconnecting"
  | "connected"
  | "failed"

type ParticleTone = "dark" | "light"

interface ConnectionParticlesProps {
  phase: ConnectionParticlesPhase
  stage: ConnectionParticlesStage
  /** 连接目标（用户名@地址），显示在状态文字下方。 */
  serverName?: string
  /** 终端底色，用来选择深浅两套粒子和文字配色；不铺遮罩，直接画在终端上。 */
  background: string
  onFinished?: () => void
}

interface ShapeSample {
  points: Float32Array
  pixel: number
}

interface ParticleIcon {
  setTone: (tone: ParticleTone) => void
  setState: (phase: ConnectionParticlesPhase, stage: ConnectionParticlesStage, icons: ShapeSample[]) => void
  destroy: () => void
}

interface ParticleIconOptions {
  /** 图标占位框；粒子图标与它对齐。 */
  anchor: HTMLElement
  onIconsShown: (stage: ConnectionParticlesStage) => void
  onDissolve: () => void
  onFinished: () => void
  onContextLost: () => void
}

const TAU = Math.PI * 2
const CAM_Z = 6
// 粒子直径（CSS 像素），与图标尺寸一样固定，不随面板大小变化。
const PARTICLE_PX = 1
const ICON_COUNT = 2400
const STRIDE = 10
// 入场只改变透明度，不作为阶段切换或终端就绪的前置条件。
const ENTER_DURATION = 0.16
// 消散时间（秒），与着色器里的最大延迟 + 最长淡出时间保持一致。
const DISSOLVE_DURATION = 0.3
// 结果动画使用短过渡，避免快速连接后仍长时间显示连接提示。
const RESULT_HOLD = 0.12
const RESULT_MORPH_DURATION = 0.18
const RESULT_MORPH_DELAY = 0.04
const MORPH_DURATION = 0.6
const MORPH_DELAY = 0.3
const MORPH_BULGE = 0.12
const ICON_SETTLED = MORPH_DELAY + MORPH_DURATION
// 连接期间每个图标成形后停留的时间；进入终态时跳过剩余阶段。
const ICON_HOLD = 0.5
const FAIL_DIM_DURATION = 0.12
// 图标 24×24 视框对应 1 个世界单位；采样时加粗描边，粒子组成后更容易认。
const ICON_STROKE = 3
const ICON_SAMPLE_SCALE = 8
const ICON_DEPTH = 0.18

// 每个阶段一组图标，组内循环切换。
const STAGE_ICONS: Record<ConnectionParticlesStage, LucideIcon[]> = {
  preparing: [ShieldCheck, Ticket],
  transport: [Globe, Network, ArrowLeftRight],
  session: [Server, Plug, SquareTerminal],
  auth: [KeyRound, LockKeyhole, UserRoundCheck],
  reconnecting: [Unplug, RefreshCw],
  connected: [Check],
  failed: [X],
}

const STAGE_MESSAGES: Record<ConnectionParticlesStage, string> = {
  preparing: "connectionLoaderPreparing",
  transport: "connectionLoaderTransport",
  session: "connectionLoaderSsh",
  auth: "connectionLoaderAuthenticating",
  reconnecting: "connectionLoaderReconnecting",
  connected: "connectionLoaderConnected",
  failed: "connectionLoaderFailed",
}

const PALETTES: Record<ParticleTone, Record<"uBase" | "uHigh", number[]>> = {
  dark: {
    uBase: [0.24, 0.7, 0.84],
    uHigh: [0.62, 0.95, 1],
  },
  // 浅色底上加性混合会被白底吃掉，改用普通叠加和更深的墨色。
  light: {
    uBase: [0.02, 0.3, 0.42],
    uHigh: [0, 0.18, 0.28],
  },
}
// 浅色底上细小粒子容易发虚，整体加一点不透明度。
const TONE_GAIN: Record<ParticleTone, number> = { dark: 1, light: 1.6 }

const VERT = `
  precision highp float;
  attribute vec3 aPos;     // 图标过渡起点
  attribute vec3 aTo;      // 图标过渡终点
  attribute vec4 aRnd;     // x: 过渡延迟 0-1, y: 相位, z: 尺寸随机, w: 亮度随机
  uniform float uTime, uOut, uMorph, uDim, uGain, uSize, uFx, uFy, uCamZ;
  uniform float uMorphDuration, uMorphDelay;
  uniform vec2 uCenter;
  uniform vec3 uBase, uHigh;
  varying vec3 vColor;
  varying float vAlpha;

  const float PI = 3.14159265;
  float clamp01(float x) { return clamp(x, 0.0, 1.0); }
  float smooth01(float x) { x = clamp01(x); return x * x * (3.0 - 2.0 * x); }
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float easeInOut(float x) {
    x = clamp01(x);
    float y = -2.0 * x + 2.0;
    return x < 0.5 ? 4.0 * x * x * x : 1.0 - y * y * y / 2.0;
  }

  void main() {
    float rOut = hash(aRnd.w * 5.71 + aRnd.y * 1.37);
    float rSpeed = hash(aRnd.z * 6.13 + aRnd.y * 2.71);
    float rCurve = hash(aRnd.w * 9.73 + aRnd.z * 4.19);

    // 收尾时每颗粒子在不同时刻就地淡出
    float kOut = clamp01((uOut - rOut * 0.06) / (0.16 + 0.08 * rSpeed));

    // 图标之间：从上一个图标的位置重组到下一个，途中略微鼓起
    float m = easeInOut((uMorph - aRnd.x * uMorphDelay) / uMorphDuration);
    vec3 bulge = sin(m * PI) * ${MORPH_BULGE.toFixed(2)} * vec3(cos(aRnd.y), sin(aRnd.y), aRnd.z - 0.5);
    vec3 target = mix(aPos, aTo, m) + bulge;
    target.xy += 0.004 * vec2(sin(uTime * 0.9 + aRnd.y * 20.0), cos(uTime * 0.7 + aRnd.y * 31.0));

    float twinkle = 0.5 + 0.5 * sin(uTime * (4.0 + 6.0 * rSpeed) + aRnd.y * 40.0);
    float glow = 0.55 + 0.45 * sin(uTime * (1.2 + aRnd.y * 2.5) + aRnd.y * 80.0);

    vec3 pos = target;
    float a = 0.85 * glow;

    // 消散：轻微漂移，边淡出边闪烁
    float sOut = smooth01(kOut);
    vec3 drift = vec3(cos(aRnd.y * 3.0 + rOut * 6.0), sin(aRnd.y * 3.0 + rOut * 6.0), rCurve - 0.5);
    pos += (drift * 0.12 + normalize(pos + 0.0001) * 0.05) * sOut;
    a *= (1.0 - sOut) * (1.0 + 0.8 * sOut * twinkle);

    vec3 col = mix(uBase, uHigh, aRnd.w * aRnd.w * aRnd.w);
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDim * 0.7);
    a *= 1.0 - uDim * 0.45;

    float w = uCamZ - pos.z;
    gl_Position = vec4(pos.x * uFx + uCenter.x * w, pos.y * uFy + uCenter.y * w, 0.0, w);

    float ps = uSize * (0.7 + 0.6 * aRnd.z) * uCamZ / w;
    gl_PointSize = max(ps, 1.0);
    vAlpha = a * uGain * min(ps * ps, 1.0);
    vColor = col;
  }
`

const FRAG = `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float m = min(smoothstep(1.0, 0.2, dot(c, c) * 4.0) * vAlpha, 1.0);
    gl_FragColor = vec4(vColor * m, m);
  }
`

const UNIFORMS = [
  "uTime", "uOut", "uMorph", "uDim", "uGain", "uSize", "uFx", "uFy", "uCamZ",
  "uMorphDuration", "uMorphDelay",
  "uCenter", "uBase", "uHigh",
] as const

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
const easeInOutCubic = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function svgShapeToPath(node: Element) {
  const attr = (name: string) => Number(node.getAttribute(name) ?? 0)
  const path = new Path2D()
  switch (node.tagName.toLowerCase()) {
    case "path":
      return new Path2D(node.getAttribute("d") ?? "")
    case "circle":
      path.arc(attr("cx"), attr("cy"), attr("r"), 0, TAU)
      return path
    case "ellipse":
      path.ellipse(attr("cx"), attr("cy"), attr("rx"), attr("ry"), 0, 0, TAU)
      return path
    case "rect":
      path.roundRect(attr("x"), attr("y"), attr("width"), attr("height"), attr("rx"))
      return path
    case "line":
      path.moveTo(attr("x1"), attr("y1"))
      path.lineTo(attr("x2"), attr("y2"))
      return path
    case "polyline":
    case "polygon": {
      const values = (node.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number)
      for (let i = 0; i + 1 < values.length; i += 2) {
        if (i === 0) path.moveTo(values[i], values[i + 1])
        else path.lineTo(values[i], values[i + 1])
      }
      if (node.tagName.toLowerCase() === "polygon") path.closePath()
      return path
    }
    default:
      return null
  }
}

// 把渲染出来的 lucide 图标在离屏 canvas 上加粗描边后按像素采样，坐标单位为图标视框边长。
function sampleIcon(svg: SVGSVGElement): ShapeSample | null {
  const size = 24 * ICON_SAMPLE_SCALE
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null

  ctx.scale(ICON_SAMPLE_SCALE, ICON_SAMPLE_SCALE)
  ctx.lineWidth = ICON_STROKE
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.strokeStyle = "#fff"
  ctx.fillStyle = "#fff"
  for (const node of Array.from(svg.children)) {
    const path = svgShapeToPath(node)
    if (!path) continue
    ctx.stroke(path)
    if (node.getAttribute("fill") === "currentColor") ctx.fill(path)
  }

  const { data } = ctx.getImageData(0, 0, size, size)
  const pixel = 1 / size
  const points: number[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] > 127) {
        points.push((x - size / 2) * pixel, -(y - size / 2) * pixel)
      }
    }
  }
  return points.length > 0 ? { points: Float32Array.from(points), pixel } : null
}

function sortedByX(positions: Float32Array, count: number) {
  return Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => positions[a * 3] - positions[b * 3])
}

function compileProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram()
  const shaders = ([[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const).map(([type, source]) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    return shader
  })
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[ConnectionParticles] shader link failed:", gl.getProgramInfoLog(program))
    shaders.forEach((shader) => gl.deleteShader(shader))
    gl.deleteProgram(program)
    return null
  }
  return { program, shaders }
}

// 每次新建 canvas：同一个 canvas 释放上下文后无法再取到可用的 WebGL 上下文（StrictMode 会重复挂载）。
function createParticleIcon(container: HTMLElement, options: ParticleIconOptions): ParticleIcon | null {
  const canvas = document.createElement("canvas")
  canvas.setAttribute("aria-hidden", "true")
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%"
  container.appendChild(canvas)
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  })
  const compiled = gl && compileProgram(gl)
  if (!gl || !compiled) {
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    canvas.remove()
    return null
  }
  const { program, shaders } = compiled
  gl.useProgram(program)

  const uniform = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.clearColor(0, 0, 0, 0)
  gl.uniform1f(uniform.uCamZ, CAM_Z)

  // 粒子：from(3) to(3) rnd(4)，切换图标时把当前位置写回 from 再过渡到新 to。
  const iconData = new Float32Array(ICON_COUNT * STRIDE)
  for (let i = 0; i < ICON_COUNT; i++) {
    iconData.set([Math.random(), Math.random() * TAU, Math.random(), Math.random()], i * STRIDE + 6)
  }
  const iconBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, iconBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, iconData, gl.DYNAMIC_DRAW)
  const attributes: [string, number, number][] = [["aPos", 3, 0], ["aTo", 3, 12], ["aRnd", 4, 24]]
  attributes.forEach(([name, size, offset]) => {
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset)
  })

  let phase: ConnectionParticlesPhase = "connecting"
  let hasIcon = false
  let iconGroup: ShapeSample[] = []
  let iconIndex = 0
  let groupQueue: { stage: ConnectionParticlesStage, icons: ShapeSample[] }[] = []
  let nextIconAt = ICON_HOLD
  let clock = 0
  let lastFrame = 0
  let morphStart = -100
  let morphDuration = MORPH_DURATION
  let morphDelay = MORPH_DELAY
  let resultSettledAt: number | null = null
  let isDissolving = false
  let dpr = 1
  let frameId = 0

  const iconTargets = (sample: ShapeSample) => {
    const out = new Float32Array(ICON_COUNT * 3)
    const count = sample.points.length / 2
    for (let i = 0; i < ICON_COUNT; i++) {
      const j = (Math.random() * count) | 0
      out[i * 3] = sample.points[j * 2] + (Math.random() - 0.5) * sample.pixel
      out[i * 3 + 1] = sample.points[j * 2 + 1] + (Math.random() - 0.5) * sample.pixel
      out[i * 3 + 2] = (Math.random() - 0.5) * ICON_DEPTH
    }
    return out
  }

  const applyIcon = (sample: ShapeSample) => {
    const targets = iconTargets(sample)
    if (!hasIcon) {
      for (let i = 0; i < ICON_COUNT; i++) {
        const o = i * STRIDE
        iconData.set(targets.subarray(i * 3, i * 3 + 3), o)
        iconData.set(targets.subarray(i * 3, i * 3 + 3), o + 3)
      }
    } else {
      // 按着色器同样的公式算出当前位置，打断进行中的过渡也不会跳变。
      const elapsed = clock - morphStart
      const current = new Float32Array(ICON_COUNT * 3)
      for (let i = 0; i < ICON_COUNT; i++) {
        const o = i * STRIDE
        const m = easeInOutCubic((elapsed - iconData[o + 6] * morphDelay) / morphDuration)
        const bulge = Math.sin(m * Math.PI) * MORPH_BULGE
        const phaseRnd = iconData[o + 7]
        current[i * 3] = iconData[o] + (iconData[o + 3] - iconData[o]) * m + bulge * Math.cos(phaseRnd)
        current[i * 3 + 1] = iconData[o + 1] + (iconData[o + 4] - iconData[o + 1]) * m + bulge * Math.sin(phaseRnd)
        current[i * 3 + 2] = iconData[o + 2] + (iconData[o + 5] - iconData[o + 2]) * m + bulge * (iconData[o + 8] - 0.5)
      }
      // 新旧位置都按 x 排序后配对，粒子大体就近移动，从左到右重组成新图标。
      const order = sortedByX(current, ICON_COUNT)
      const targetOrder = sortedByX(targets, ICON_COUNT)
      for (let k = 0; k < ICON_COUNT; k++) {
        const i = order[k]
        const target = targetOrder[k]
        iconData.set(current.subarray(i * 3, i * 3 + 3), i * STRIDE)
        iconData.set(targets.subarray(target * 3, target * 3 + 3), i * STRIDE + 3)
      }
      morphStart = clock
    }
    // 先按旧速度采样当前位置，再切换结果动画的速度，打断过渡也能连续衔接。
    morphDuration = phase === "connecting" ? MORPH_DURATION : RESULT_MORPH_DURATION
    morphDelay = phase === "connecting" ? MORPH_DELAY : RESULT_MORPH_DELAY
    gl.uniform1f(uniform.uMorphDuration, morphDuration)
    gl.uniform1f(uniform.uMorphDelay, morphDelay)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, iconData)
    hasIcon = true
  }

  const showGroup = (stage: ConnectionParticlesStage, icons: ShapeSample[]) => {
    iconGroup = icons
    iconIndex = 0
    const wasShowingIcon = hasIcon
    applyIcon(icons[0])
    if (phase !== "connecting") {
      resultSettledAt = clock + (wasShowingIcon ? morphDuration + morphDelay : 0)
    }
    options.onIconsShown(stage)
  }

  // 图标按占位框的尺寸和位置投影。
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    const bounds = canvas.getBoundingClientRect()
    const box = options.anchor.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(bounds.width * dpr))
    canvas.height = Math.max(1, Math.round(bounds.height * dpr))
    gl.viewport(0, 0, canvas.width, canvas.height)
    const halfWidth = Math.max(1, bounds.width) / 2
    const halfHeight = Math.max(1, bounds.height) / 2
    const unit = Math.max(1, box.width)
    gl.uniform1f(uniform.uFx, (unit * CAM_Z) / halfWidth)
    gl.uniform1f(uniform.uFy, (unit * CAM_Z) / halfHeight)
    gl.uniform2f(
      uniform.uCenter,
      (box.left + box.width / 2 - bounds.left) / halfWidth - 1,
      1 - (box.top + box.height / 2 - bounds.top) / halfHeight,
    )
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resizeObserver.observe(options.anchor)
  resize()

  let finished = false
  const finish = () => {
    finished = true
    cancelAnimationFrame(frameId)
    options.onFinished()
  }

  const frame = (now: number) => {
    frameId = requestAnimationFrame(frame)
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 1 / 20) : 0
    lastFrame = now
    clock += dt

    // 终态跳过中间阶段，用当前粒子位置连续变形成结果图标。
    if (phase === "connecting" ? clock >= nextIconAt : groupQueue.length > 0) {
      const next = groupQueue.shift()
      if (next) {
        showGroup(next.stage, next.icons)
      } else if (iconGroup.length > 1) {
        iconIndex = (iconIndex + 1) % iconGroup.length
        applyIcon(iconGroup[iconIndex])
      }
      nextIconAt = clock + ICON_SETTLED + ICON_HOLD
    }

    // 从结果图标完成变形后计时，保证先完整显示、停留，再消散。
    const resultElapsed = resultSettledAt === null ? -1 : clock - resultSettledAt
    const out = resultSettledAt === null ? -1 : resultElapsed - RESULT_HOLD
    const dim = phase === "failed" ? smoothstep(0, FAIL_DIM_DURATION, resultElapsed) : 0
    if (out >= 0 && !isDissolving) {
      isDissolving = true
      options.onDissolve()
    }

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(uniform.uTime, clock)
    gl.uniform1f(uniform.uOut, out)
    gl.uniform1f(uniform.uMorph, clock - morphStart)
    gl.uniform1f(uniform.uDim, dim)
    gl.uniform1f(uniform.uSize, PARTICLE_PX * dpr)
    gl.drawArrays(gl.POINTS, 0, ICON_COUNT)

    if (out >= DISSOLVE_DURATION) {
      finish()
    }
  }
  frameId = requestAnimationFrame(frame)

  const handleContextLost = () => {
    cancelAnimationFrame(frameId)
    if (!finished) options.onContextLost()
  }
  canvas.addEventListener("webglcontextlost", handleContextLost)

  return {
    setTone(tone) {
      Object.entries(PALETTES[tone]).forEach(([name, color]) => {
        gl.uniform3fv(uniform[name as keyof typeof uniform], color)
      })
      gl.uniform1f(uniform.uGain, TONE_GAIN[tone])
      if (tone === "dark") {
        gl.blendFunc(gl.ONE, gl.ONE)
      } else {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      }
    },
    setState(nextPhase, stage, icons) {
      if (icons.length === 0 || phase !== "connecting") return
      if (nextPhase !== "connecting") {
        // 状态和结果图标一起提交，清除中间阶段；退场计时由实际变形进度决定。
        phase = nextPhase
        groupQueue = []
      }
      if (!hasIcon) {
        showGroup(stage, icons)
        return
      }
      groupQueue.push({ stage, icons })
    },
    destroy() {
      finished = true
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      canvas.removeEventListener("webglcontextlost", handleContextLost)
      gl.deleteBuffer(iconBuffer)
      shaders.forEach((shader) => gl.deleteShader(shader))
      gl.deleteProgram(program)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
    },
  }
}

export function ConnectionParticles({
  phase,
  stage,
  serverName,
  background,
  onFinished,
}: ConnectionParticlesProps) {
  const { t } = useTranslation("terminal")
  const shouldReduceMotion = useReducedMotion()
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const iconSourceRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<ParticleIcon | null>(null)
  const onFinishedRef = useRef(onFinished)
  const [isUnsupported, setIsUnsupported] = useState(false)
  const [isDissolving, setIsDissolving] = useState(false)
  const iconStage = phase === "success" ? "connected" : phase === "failed" ? "failed" : stage
  // 文字跟着实际显示的图标组切换，避免文字已经换阶段、图标还停在上一组。
  const [shownStage, setShownStage] = useState(iconStage)
  const shouldUseFallback = isUnsupported || !!shouldReduceMotion
  const tone: ParticleTone = useMemo(
    () => contrastRatio("#000000", background) > contrastRatio("#ffffff", background) ? "light" : "dark",
    [background],
  )

  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    const host = canvasHostRef.current
    const anchor = anchorRef.current
    if (shouldUseFallback || !host || !anchor) return

    const particles = createParticleIcon(host, {
      anchor,
      onIconsShown: setShownStage,
      onDissolve: () => setIsDissolving(true),
      onFinished: () => onFinishedRef.current?.(),
      onContextLost: () => setIsUnsupported(true),
    })
    if (!particles) {
      setIsUnsupported(true)
      return
    }
    particlesRef.current = particles
    return () => {
      particles.destroy()
      particlesRef.current = null
    }
  }, [shouldUseFallback])

  useEffect(() => {
    particlesRef.current?.setTone(tone)
  }, [tone, shouldUseFallback])

  // 隐藏渲染的是当前阶段的图标组，提交后读取 SVG 采样成粒子点。
  useEffect(() => {
    const source = iconSourceRef.current
    if (!particlesRef.current || !source) return
    const icons = Array.from(source.querySelectorAll("svg"), sampleIcon)
      .filter((icon): icon is ShapeSample => icon !== null)
    particlesRef.current.setState(phase, iconStage, icons)
  }, [phase, iconStage, shouldUseFallback])

  // 显示静态图标和状态文字时没有退场动画，直接结束。
  useEffect(() => {
    if (shouldUseFallback && phase !== "connecting") {
      onFinishedRef.current?.()
    }
  }, [phase, shouldUseFallback])

  if (shouldUseFallback) {
    return phase === "connecting" ? (
      <ConnectionStatus
        icon={STAGE_ICONS[stage][0]}
        serverName={serverName}
        message={t(STAGE_MESSAGES[stage])}
      />
    ) : null
  }

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: ENTER_DURATION, ease: "easeOut" }}
    >
      <div ref={iconSourceRef} hidden aria-hidden="true">
        {STAGE_ICONS[iconStage].map((Icon, index) => <Icon key={`${iconStage}-${index}`} />)}
      </div>
      <div ref={canvasHostRef} aria-hidden="true" className="absolute inset-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
        <div ref={anchorRef} aria-hidden="true" className="size-16 shrink-0" />
        {/* 退场时跟粒子一起淡出 */}
        <div
          className={cn(
            "flex max-w-full flex-col items-center gap-1 transition-opacity duration-200",
            isDissolving && "opacity-0",
          )}
        >
          <p
            role="status"
            aria-live="polite"
            className={cn("max-w-full truncate text-sm", tone === "dark" ? "text-white/70" : "text-black/60")}
          >
            <AnimatedStateText value={shownStage}>{t(STAGE_MESSAGES[shownStage])}</AnimatedStateText>
          </p>
          {serverName && (
            <p className={cn("max-w-full truncate font-mono text-xs", tone === "dark" ? "text-white/40" : "text-black/40")}>
              {serverName}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
