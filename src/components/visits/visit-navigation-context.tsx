'use client'

import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'

type VisitNavigationMemory = { expanded: Record<string, boolean>; scroll: number; visited: boolean }
type Navigation = {
  read: () => VisitNavigationMemory
  setExpanded: (expanded: Record<string, boolean>) => void
  setScroll: (scroll: number) => void
}
const Context = createContext<Navigation | null>(null)
export function VisitNavigationProvider({ children }: { children: ReactNode }) {
  const memory = useRef<VisitNavigationMemory>({ expanded: {}, scroll: 0, visited: false })
  const navigation = useMemo(() => ({
    read: () => memory.current,
    setExpanded: (expanded: Record<string, boolean>) => { memory.current.expanded = expanded },
    setScroll: (scroll: number) => { memory.current.scroll = scroll; memory.current.visited = true },
  }), [])
  return <Context.Provider value={navigation}>{children}</Context.Provider>
}
export const useVisitNavigationMemory = () => useContext(Context)
