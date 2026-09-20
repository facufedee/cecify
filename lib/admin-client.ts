'use client'

import { authFetch } from '@/lib/client-auth'

// fetch de la API de administracion: devuelve el JSON o lanza un Error con el mensaje del servidor
export const adminJson = async <T = Record<string, unknown>>(
  url: string,
  init: Omit<RequestInit, 'body'> & { json?: unknown } = {}
): Promise<T> => {
  const { json, ...rest } = init
  const res = await authFetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'No se pudo completar la acción')
  return data as T
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'No se pudo completar la acción')

// Baja un CSV (con BOM para que Excel respete los acentos)
export const downloadCsv = (filename: string, rows: string[][]) => {
  const cell = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const text = rows.map((r) => r.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
