import generatedRoot, { monitor as generatedMonitor } from "./metrics.generated"
import type * as metricsTypes from "./metrics.types"

export const monitor = generatedMonitor as unknown as typeof metricsTypes.monitor

const root = generatedRoot as unknown as { monitor: typeof metricsTypes.monitor }

export default root
