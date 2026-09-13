'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'
const Workspace = createContext({ intakeDirty: false, setIntakeDirty: (_value: boolean) => { void _value } })
export function FollowUpWorkspace({ children }: { children: ReactNode }) {
  const [intakeDirty, setIntakeDirty] = useState(false)
  return <Workspace.Provider value={{ intakeDirty, setIntakeDirty }}>{children}</Workspace.Provider>
}
export function useFollowUpWorkspace() { return useContext(Workspace) }
