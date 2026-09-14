// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { ComplaintRadiationField } from '../complaint-radiation-field'
import { Form, FormField } from '@/components/ui/form'

describe('ComplaintRadiationField', () => {
  function renderField({ initialValue, disabled = false }: { initialValue: string; disabled?: boolean }) {
    function Harness() {
      const form = useForm<{ fieldValue: string | null }>({ defaultValues: { fieldValue: initialValue } })
      return <Form {...form}>
        <form>
          <FormField
            control={form.control}
            name="fieldValue"
            render={({ field }) => <ComplaintRadiationField
              field={{ ...field, value: field.value ?? '', onChange: next => field.onChange(next || null), onBlur: field.onBlur }}
              label="Pain Radiates To"
              examples={['Shoulder', 'Arm', 'Hand']}
              regionLabel="Neck/cervical"
              disabled={disabled} />}
          />
        </form>
      </Form>
    }
    render(<Harness />)
  }

  it('adds/removes examples and status buttons correctly', async () => {
    const user = userEvent.setup()
    renderField({ initialValue: '' })
    await user.click(screen.getByRole('button', { name: 'Shoulder' }))
    expect((screen.getByRole('textbox', { name: 'Pain Radiates To' }) as HTMLTextAreaElement).value).toBe('Shoulder')
    await user.click(screen.getByRole('button', { name: 'No radiation' }))
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy()
  })

  it('supports replace/undo while preserving typed text flow', async () => {
    const user = userEvent.setup()
    renderField({ initialValue: 'Patient reports spreading to fingertips' })
    await user.click(screen.getByRole('button', { name: 'Not assessed' }))
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect((screen.getByRole('textbox', { name: 'Pain Radiates To' }) as HTMLTextAreaElement).value).toBe('Not assessed')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByRole('textbox', { name: 'Pain Radiates To' }) as HTMLTextAreaElement).value).toBe('Patient reports spreading to fingertips')
  })
})
