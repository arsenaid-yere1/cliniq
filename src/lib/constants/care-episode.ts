export const CARE_EPISODE_STATUSES = ['active', 'discharged', 'cancelled'] as const

export type CareEpisodeStatus = (typeof CARE_EPISODE_STATUSES)[number]
