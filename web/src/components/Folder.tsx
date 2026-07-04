import React from 'react';
import { cn } from "@/lib/utils";

interface FolderProps {
  color?: string;
  size?: number;
  items?: React.ReactNode[];
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

const Folder: React.FC<FolderProps> = ({ color = 'var(--chart-1)', size = 1, items = [], className = '', isFocused = false }) => {
  const maxItems = 3;
  const papers = items.slice(0, maxItems);
  while (papers.length < maxItems) {
    papers.push(null);
  }

  // 禁用展开功能 - 始终保持关闭状态
  const open = false;

  const folderBackColor = darkenColor(color, 0.08);
  const paper1 = 'color-mix(in oklab, var(--card) 82%, var(--muted))';
  const paper2 = 'color-mix(in oklab, var(--card) 90%, var(--muted))';
  const paper3 = 'var(--card)';

  const folderStyle: React.CSSProperties = {
    '--folder-color': color,
    '--folder-back-color': folderBackColor,
    '--paper-1': paper1,
    '--paper-2': paper2,
    '--paper-3': paper3
  } as React.CSSProperties;

  const scaleStyle = { transform: `scale(${size})` };
  const folderClassName = cn(
    "group/folder cursor-pointer transition-all duration-200 ease-in",
    !open && !isFocused && "hover:-translate-y-2",
    isFocused && "-translate-y-2"
  );
  const paperClassName = cn(
    "absolute bottom-[10%] left-1/2 z-[2] h-[80%] w-[70%] -translate-x-1/2 translate-y-[10%] rounded-[10px] bg-[var(--paper-1)] transition-all duration-300 ease-in-out group-hover/folder:translate-y-0",
    isFocused && "translate-y-0"
  );
  const frontBaseClassName = "absolute z-[3] h-full w-full origin-bottom rounded-[5px_10px_10px_10px] bg-[var(--folder-color)] transition-all duration-300 ease-in-out";
  const frontClassName = cn(
    frontBaseClassName,
    !isFocused && "group-hover/folder:skew-x-[15deg] group-hover/folder:scale-y-[0.6]",
    isFocused && "skew-x-[15deg] scale-y-[0.6]"
  );
  const rightFrontClassName = cn(
    frontBaseClassName,
    !isFocused && "group-hover/folder:-skew-x-[15deg] group-hover/folder:scale-y-[0.6]",
    isFocused && "-skew-x-[15deg] scale-y-[0.6]"
  );

  return (
    <div style={scaleStyle} className={className}>
      <div className={folderClassName} style={folderStyle}>
        <div className="relative h-20 w-[100px] rounded-[0_10px_10px_10px] bg-[var(--folder-back-color)] after:absolute after:bottom-[98%] after:left-0 after:z-0 after:h-2.5 after:w-[30px] after:rounded-[5px_5px_0_0] after:bg-[var(--folder-back-color)] after:content-['']">
          {papers.map((item, i) => (
            <div
              key={i}
              className={cn(
                paperClassName,
                i === 1 && "h-[70%] w-[80%] bg-[var(--paper-2)]",
                i === 2 && "h-[60%] w-[90%] bg-[var(--paper-3)]"
              )}
            >
              {item}
            </div>
          ))}
          <div className={frontClassName} />
          <div className={rightFrontClassName} />
        </div>
      </div>
    </div>
  );
};

export default Folder;
