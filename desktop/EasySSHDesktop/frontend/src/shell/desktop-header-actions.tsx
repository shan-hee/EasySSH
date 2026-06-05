import { Browser } from "@wailsio/runtime"
import { Button } from "@/components/ui/button"
import { ThemeMenu } from "@/components/theme-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Github } from "@easyssh/ssh-workspace/desktop"

const githubUrl = "https://github.com/shan-hee/EasySSH"
const githubTooltip = "在 GitHub 上打开项目"

function openGithub() {
  void Browser.OpenURL(githubUrl).catch((error) => {
    console.error("Failed to open GitHub:", error)
  })
}

export function DesktopHeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={githubTooltip} onClick={openGithub}>
            <Github />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{githubTooltip}</TooltipContent>
      </Tooltip>

      <ThemeMenu />
    </div>
  )
}
