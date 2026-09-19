import nextEnv from '@next/env'
const { loadEnvConfig } = nextEnv
import { spawnSync } from 'node:child_process'
// Load local server credentials before Vitest sets NODE_ENV=test. Never print them.
loadEnvConfig(process.cwd())
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Model credentials unavailable')
const result = spawnSync('npx', ['vitest', 'run', 'src/lib/qc/evaluation/consistency.live.test.ts'], {
  stdio:'inherit',env:{...process.env,RUN_QC_MODEL_EVAL:'1'},
})
process.exit(result.status ?? 1)
