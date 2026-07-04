import React from 'react';
import { cn } from "@/lib/utils";

interface FileProps {
  color?: string;
  size?: number;
  fileType?: string;
  icon?: React.ReactNode;
  className?: string;
  isFocused?: boolean;
}

const isHexColor = (color: string): boolean => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim());

const mixColor = (color: string, mixWith: 'black' | 'white', percent: number): string => {
  const colorAmount = Math.max(0, Math.min(100, Math.round((1 - percent) * 100)));
  return `color-mix(in oklab, ${color} ${colorAmount}%, ${mixWith})`;
};

const darkenColor = (hex: string, percent: number): string => {
  if (!isHexColor(hex)) {
    return mixColor(hex, 'black', percent);
  }

  let color = hex.startsWith('#') ? hex.slice(1) : hex;
  if (color.length === 3) {
    color = color
      .split('')
      .map(c => c + c)
      .join('');
  }
  const num = parseInt(color, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.max(0, Math.min(255, Math.floor(r * (1 - percent))));
  g = Math.max(0, Math.min(255, Math.floor(g * (1 - percent))));
  b = Math.max(0, Math.min(255, Math.floor(b * (1 - percent))));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

const lightenColor = (hex: string, percent: number): string => {
  if (!isHexColor(hex)) {
    return mixColor(hex, 'white', percent);
  }

  let color = hex.startsWith('#') ? hex.slice(1) : hex;
  if (color.length === 3) {
    color = color
      .split('')
      .map(c => c + c)
      .join('');
  }
  const num = parseInt(color, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.max(0, Math.min(255, Math.floor(r + (255 - r) * percent)));
  g = Math.max(0, Math.min(255, Math.floor(g + (255 - g) * percent)));
  b = Math.max(0, Math.min(255, Math.floor(b + (255 - b) * percent)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

const File: React.FC<FileProps> = ({
  color = 'var(--chart-1)',
  size = 1,
  fileType = '',
  icon,
  className = '',
  isFocused = false
}) => {
  const fileBodyColor = color;
  const fileFoldColor = darkenColor(color, 0.15);
  const fileAccentColor = lightenColor(color, 0.2);
  const fileShadowColor = darkenColor(color, 0.3);

  const fileStyle: React.CSSProperties = {
    '--file-body-color': fileBodyColor,
    '--file-fold-color': fileFoldColor,
    '--file-accent-color': fileAccentColor,
    '--file-shadow-color': fileShadowColor,
    '--file-mark-color': 'color-mix(in oklab, var(--foreground) 86%, var(--file-body-color))',
    '--file-mark-surface': 'color-mix(in oklab, var(--background) 24%, transparent)',
    '--file-mark-muted': 'color-mix(in oklab, var(--background) 32%, transparent)',
  } as React.CSSProperties;

  const wrapperClassName = cn(
    "group/file transition-transform duration-200 ease-in hover:-translate-y-2",
    isFocused && "-translate-y-2",
    className
  );
  const bodyClassName = cn(
    "relative h-[90px] w-[70px] overflow-hidden rounded-lg bg-[var(--file-body-color)] shadow-[0_4px_8px_color-mix(in_oklab,var(--file-shadow-color)_18%,transparent)] transition-shadow duration-200 ease-in group-hover/file:shadow-[0_8px_16px_color-mix(in_oklab,var(--file-shadow-color)_26%,transparent)]",
    isFocused && "shadow-[0_8px_16px_color-mix(in_oklab,var(--file-shadow-color)_26%,transparent)]"
  );
  const foldClassName = cn(
    "absolute right-0 top-0 h-5 w-5 rounded-bl-lg bg-[var(--file-fold-color)] shadow-[-2px_2px_4px_color-mix(in_oklab,var(--file-shadow-color)_18%,transparent)] transition-all duration-200 ease-in before:absolute before:right-0 before:top-0 before:h-0 before:w-0 before:border-b-[20px] before:border-r-[20px] before:border-solid before:border-b-transparent before:[border-right-color:var(--file-accent-color)] before:content-[''] group-hover/file:rounded-br-lg",
    isFocused && "rounded-br-lg"
  );
  const linesClassName = cn(
    "absolute bottom-[15px] left-[10%] right-[10%] opacity-70 transition-opacity duration-200 ease-in group-hover/file:opacity-100",
    isFocused && "opacity-100"
  );
  const scaleStyle = {
    transform: `scale(${size})`,
  };

  return (
    <div className={wrapperClassName}>
      <div style={scaleStyle}>
        <div className="cursor-pointer" style={fileStyle}>
          <div className={bodyClassName}>
            <div className={foldClassName}></div>
            <div className="absolute left-[5%] right-[5%] top-[25px] flex h-[30px] items-center justify-center [will-change:auto]">
              {icon && <div className="flex items-center justify-center text-base text-[var(--file-mark-color)] [will-change:auto]">{icon}</div>}
              {fileType && !icon && (
                <div className="rounded bg-[var(--file-mark-surface)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--file-mark-color)] [will-change:auto]">
                  {fileType}
                </div>
              )}
            </div>
            <div className={linesClassName}>
              <div className="mb-1 h-[3px] w-full rounded-sm bg-[var(--file-mark-muted)]"></div>
              <div className="mb-1 h-[3px] w-[85%] rounded-sm bg-[var(--file-mark-muted)]"></div>
              <div className="mb-1 h-[3px] w-[60%] rounded-sm bg-[var(--file-mark-muted)]"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default File;
