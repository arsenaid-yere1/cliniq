// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { VisitEditorHeader } from '../visit-editor-header'
afterEach(cleanup)
it('keeps the selected historical episode in the return destination and context', () => {
  render(<VisitEditorHeader caseId="case" episodeId="historical" episodeNumber={2} readOnly />)
  expect(screen.getByRole('link', { name: 'All visits' }).getAttribute('href')).toBe('/patients/case/visits?episode=historical')
  expect(screen.getAllByText('Episode 2')).toHaveLength(1); expect(screen.getByText('Read only')).toBeTruthy()
  expect(screen.queryByRole('heading')).toBeNull()
})
