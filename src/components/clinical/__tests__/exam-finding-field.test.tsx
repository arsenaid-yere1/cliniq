// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { Form, FormField } from '@/components/ui/form'
import { ExamFindingField } from '../exam-finding-field'
function Harness({ region = 'Knee', disabled = false, isSaving = false }: { region?: string; disabled?: boolean; isSaving?: boolean }) {
  const form = useForm({ defaultValues: { text: '' } })
  return <Form {...form}><FormField control={form.control} name="text" render={({ field }) => <ExamFindingField field={field}
    label="Findings" kind="palpation_findings" region={region} disabled={disabled} isSaving={isSaving} />} />
    <button onClick={() => form.setValue('text', 'External text')}>External update</button>
    <p>{form.formState.isDirty ? 'Dirty' : 'Clean'}</p>
  </Form>
}
const text = () => screen.getByRole('textbox', { name: 'Findings' }) as HTMLTextAreaElement
async function compose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Localized tenderness/ }))
  await user.selectOptions(screen.getByLabelText('Side'), 'Left')
  fireEvent.change(screen.getByLabelText('Examined location'), { target: { value: 'knee' } })
}
afterEach(cleanup)
describe('ExamFindingField lifecycle', () => {
  it('keeps browsing, filtering, incomplete details and Cancel out of saved text', async () => {
    const user = userEvent.setup(); render(<Harness />)
    await user.click(screen.getByRole('button', { name: /More examples/ }))
    fireEvent.change(screen.getByLabelText('Search findings examples'), { target: { value: 'unmatched' } })
    expect(screen.getByText('No matching examples. Enter your own finding below.')).toBeTruthy()
    expect(screen.getByText('Clean')).toBeTruthy()
    await compose(user)
    expect(screen.getByText('Clean')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(text().value).toBe('')
  })
  it('does not replace Undo with a no-op duplicate insertion', async () => {
    const user = userEvent.setup(); render(<Harness />)
    await compose(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    await compose(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    expect(text().value).toBe('Tenderness at Left knee')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(text().value).toBe('')
  })
  it.each(['region', 'disabled', 'isSaving', 'external', 'typing'])('invalidates stale Undo at the %s boundary', async boundary => {
    const user = userEvent.setup(); const view = render(<Harness />)
    await compose(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    if (boundary === 'external') await user.click(screen.getByRole('button', { name: 'External update' }))
    else if (boundary === 'typing') fireEvent.change(text(), { target: { value: 'New text' } })
    else view.rerender(<Harness {...(boundary === 'region' ? { region: 'Left knee' } : boundary === 'disabled' ? { disabled: true } : { isSaving: true })} />)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(text().value).toBe(boundary === 'external' ? 'External text' : boundary === 'typing' ? 'New text' : 'Tenderness at Left knee')
  })
  it('cancels a conflict without changing custom prose, and clears it on external edits', async () => {
    const user = userEvent.setup(); render(<Harness />)
    const previous = 'Custom notes; No focal tenderness in Left knee'
    fireEvent.change(text(), { target: { value: previous } })
    await compose(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(text().value).toBe(previous)
    await compose(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    await user.click(screen.getByRole('button', { name: 'External update' }))
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
  })
  it('supports keyboard insertion and prevents mutation while saving', async () => {
    const user = userEvent.setup(); const view = render(<Harness />)
    const button = screen.getByRole('button', { name: /Localized tenderness/ })
    button.focus(); await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByLabelText('Side'))
    view.rerender(<Harness disabled isSaving />)
    expect(screen.queryByRole('button', { name: 'Insert finding' })).toBeNull()
    expect(text().disabled).toBe(true)
    await user.click(button); expect(text().value).toBe('')
  })
})
