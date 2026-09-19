import 'server-only'
/** Enable only after the database, model evaluation, and manual rollout gates pass. */
export function qualityReviewV3Enabled() {
  return process.env.QUALITY_REVIEW_V3_ENABLED === 'true'
}
