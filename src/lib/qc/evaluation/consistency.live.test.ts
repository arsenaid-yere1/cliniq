import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { loadEnvConfig } from '@next/env'
import { consistencyFixtures, consistencySnapshot } from './consistency-fixtures'
import { generateGroundedQualityReview } from '@/lib/claude/generate-quality-review'
import { serializeReviewInput } from '../review-input'

// Explicit opt-in: this calls the configured model with synthetic data and incurs API usage.
// RUN_QC_MODEL_EVAL=1 npm test -- src/lib/qc/evaluation/consistency.live.test.ts
loadEnvConfig(process.cwd())
describe.skipIf(process.env.RUN_QC_MODEL_EVAL !== '1')('qc-v3 live consistency evaluation', () => {
  it('reviews a synthetic request larger than the former byte limit', async () => {
    const fixture = consistencyFixtures.find(item => item.rule === 'anatomy_consistency')!
    const snapshot = consistencySnapshot(fixture,true)
    snapshot.notes[0].sections.subjective += '\n' + 'Historical education entry: the documented plan was reviewed with the patient.\n'.repeat(4000)
    const inputBytes = Buffer.byteLength(serializeReviewInput(snapshot))
    expect(inputBytes).toBeGreaterThan(240_000)
    const result = await generateGroundedQualityReview(snapshot)
    const directory='thoughts/shared/research/quality-review-evaluation/qc-v3'
    mkdirSync(directory,{recursive:true})
    writeFileSync(`${directory}/large-input.json`,JSON.stringify({evaluated_at:new Date().toISOString(),input_bytes:inputBytes,result:result.data ?? {error:result.error}},null,2)+'\n')
    expect(result.error).toBeUndefined()
    expect(result.data?.findings.some(f => f.rule_id === 'anatomy_consistency')).toBe(true)
  },300_000)
  it.each(consistencyFixtures)('$rule detects seeded conflict and accepts clean control',async fixture => {
    expect(process.env.ANTHROPIC_API_KEY, 'Model credentials required').toBeTruthy()
    const conflict=await generateGroundedQualityReview(consistencySnapshot(fixture,true))
    const clean=await generateGroundedQualityReview(consistencySnapshot(fixture,false))
    const directory='thoughts/shared/research/quality-review-evaluation/qc-v3'
    mkdirSync(directory,{recursive:true})
    writeFileSync(`${directory}/${fixture.rule}.json`,JSON.stringify({version:'qc-v3',evaluated_at:new Date().toISOString(),configured_model:'claude-opus-4-7',fixture,conflict:conflict.data ?? {error:conflict.error},control:clean.data ?? {error:clean.error}},null,2)+'\n')
    expect(conflict.error).toBeUndefined()
    expect(conflict.data?.findings.some(f => f.rule_id === fixture.rule), JSON.stringify(conflict.data)).toBe(true)
    expect(clean.error).toBeUndefined()
    expect(clean.data?.findings,JSON.stringify(clean.data)).toEqual([])
  },300_000)
})
