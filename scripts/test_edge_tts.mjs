#!/usr/bin/env node
// Keep the historical entry point using the production implementation.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const result = spawnSync('pnpm', ['tts:smoke', ...process.argv.slice(2)], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
