// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { CptCodeCombobox } from '../cpt-code-combobox'
afterEach(() => { cleanup(); document.body.style.pointerEvents = '' })
const catalogItems = [{ id: 'one', cpt_code: '99214', description: 'Office visit', default_price: 250 }]
it('forwards the label, ref, blur, name and error description to the input, preserving free entry and selection', () => {
  const ref = createRef<HTMLInputElement>(); const blur = vi.fn(); const select = vi.fn()
  function Harness() {
    const [value, setValue] = useState('')
    return <><label htmlFor="cpt">Item 1 CPT</label><p id="error">Select a code</p><CptCodeCombobox ref={ref} id="cpt" name="line_items.0.cpt_code" aria-invalid aria-describedby="error" onBlur={blur} value={value} onChange={setValue} onSelect={item => { select(item); setValue(item.cpt_code) }} catalogItems={catalogItems} /></>
  }
  render(<Harness />)
  const input = screen.getByLabelText('Item 1 CPT')
  expect(ref.current).toBe(input); expect(input.getAttribute('aria-describedby')).toBe('error')
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(input.getAttribute('name')).toBe('line_items.0.cpt_code')
  fireEvent.change(input, { target: { value: 'CUSTOM' } }); expect(ref.current?.value).toBe('CUSTOM')
  fireEvent.change(input, { target: { value: 'office' } })
  fireEvent.click(screen.getByRole('button', { name: /99214/ }))
  expect(select).toHaveBeenCalledExactlyOnceWith(catalogItems[0]); expect(ref.current?.value).toBe('99214')
  expect(document.activeElement).toBe(input)
  fireEvent.blur(input); expect(blur).toHaveBeenCalled()
})
it('closes an open catalog and rejects selection/input while disabled', () => {
  const select = vi.fn(); const change = vi.fn()
  const props = { value: '', onChange: change, onSelect: select, catalogItems }
  const view = render(<CptCodeCombobox {...props} />)
  fireEvent.click(screen.getByRole('textbox'))
  const option = screen.getByRole('button', { name: /99214/ })
  view.rerender(<CptCodeCombobox {...props} disabled />)
  expect(screen.queryByRole('button', { name: /99214/ })).toBeNull()
  fireEvent.click(option)
  fireEvent.change(view.container.querySelector('input')!, { target: { value: '99214' } })
  expect(select).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
})

it('lets the keyboard enter the catalog with ArrowDown and select with Enter', async () => {
  const user = (await import('@testing-library/user-event')).default.setup()
  const select = vi.fn()
  render(<CptCodeCombobox value="" onChange={vi.fn()} onSelect={select} catalogItems={catalogItems} />)
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /99214/ }))
  await user.keyboard('{Enter}')
  expect(select).toHaveBeenCalledExactlyOnceWith(catalogItems[0])
})
