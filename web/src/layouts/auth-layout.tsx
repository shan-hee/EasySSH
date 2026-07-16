
import { Outlet } from "react-router-dom"
import { useTheme } from "@/components/theme-provider"
import LightRays from "@/components/LightRays"
import { AuthI18nProvider } from "@/providers/auth-i18n-provider"

export default function AuthLayout() {
  const { resolvedTheme } = useTheme()

  const isLightTheme = resolvedTheme === "light"
  const raysColor = isLightTheme ? "#3b82f6" : "#ffffff"
  const raysOpacity = isLightTheme ? "opacity-30" : "opacity-60"

  return (
    <AuthI18nProvider>
      <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden bg-background p-6 md:p-10">
        <div className="absolute inset-0 z-0">
          <LightRays
            raysOrigin="top-center"
            raysColor={raysColor}
            raysSpeed={1}
            lightSpread={0.3}
            rayLength={3}
            fadeDistance={2}
            saturation={1}
            followMouse={true}
            mouseInfluence={0.1}
            noiseAmount={0}
            distortion={0}
            pulsating={false}
            className={raysOpacity}
          />
        </div>

        {/* 表单内容区域 */}
        <div className="relative z-10 w-full max-w-sm">
          <Outlet />
        </div>
      </div>
    </AuthI18nProvider>
  )
}
