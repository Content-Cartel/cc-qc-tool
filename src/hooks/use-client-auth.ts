'use client'

import { useState, useEffect, useCallback } from 'react'

interface ClientAuthState {
  isAuthenticated: boolean
  clientName: string | null
  login: (name: string) => void
  logout: () => void
}

export function useClientAuth(slug: string): ClientAuthState {
  const [clientName, setClientName] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    const storedAuth = localStorage.getItem(`client_auth_${slug}`)
    const storedName = localStorage.getItem(`client_name_${slug}`)
    if (storedAuth === 'true' && storedName) {
      setClientName(storedName)
      setIsAuthenticated(true)
    }
  }, [slug])

  const login = useCallback((name: string) => {
    localStorage.setItem(`client_auth_${slug}`, 'true')
    localStorage.setItem(`client_name_${slug}`, name)
    setClientName(name)
    setIsAuthenticated(true)
  }, [slug])

  const logout = useCallback(() => {
    localStorage.removeItem(`client_auth_${slug}`)
    localStorage.removeItem(`client_name_${slug}`)
    setClientName(null)
    setIsAuthenticated(false)
  }, [slug])

  return { isAuthenticated, clientName, login, logout }
}
