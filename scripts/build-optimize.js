#!/usr/bin/env node
// 轻量构建优化脚本（占位说明）
// 说明：主要优化策略已在 vite.config.js 中配置（splitVendorChunk、手动分包、双压缩、分析插件）。
// 本脚本当前只调用标准构建，避免重复逻辑。

import { spawn } from 'node:child_process';

function detectPM() {
  const ua = process.env.npm_config_user_agent || '';
  if (ua.includes('pnpm')) return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (ua.includes('yarn')) return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

const pm = detectPM();
const args = pm.includes('yarn') ? ['build'] : ['run', 'build'];
const proc = spawn(pm, args, { stdio: 'inherit' });
proc.on('exit', code => process.exit(code ?? 0));
