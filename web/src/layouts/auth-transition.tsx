
import { FadeIn } from "@/components/motion/fade-in"
import { motionTransitions } from "@/lib/motion"

export default function AuthTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <FadeIn transition={motionTransitions.fade}>
      {children}
    </FadeIn>
  )
}
