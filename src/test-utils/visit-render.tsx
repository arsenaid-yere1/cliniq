import type { ReactElement, ReactNode } from 'react'
import { render as testingRender, type RenderOptions } from '@testing-library/react'
import { VisitUnsavedChangesProvider } from '@/components/visits/visit-unsaved-changes-context'
export function VisitTestProvider({ children }: { children: ReactNode }) {
  return <VisitUnsavedChangesProvider>{children}</VisitUnsavedChangesProvider>
}
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return testingRender(ui, { ...options, wrapper: VisitTestProvider })
}
