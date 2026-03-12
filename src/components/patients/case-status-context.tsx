'use client'

import { createContext, useContext } from 'react'

const CaseStatusContext = createContext<string>('intake')

export function CaseStatusProvider({
  status,
  children,
}: {
  status: string
  children: React.ReactNode
}) {
  return (
    <CaseStatusContext.Provider value={status}>
      {children}
    </CaseStatusContext.Provider>
  )
}

export function useCaseStatus() {
  return useContext(CaseStatusContext)
}
