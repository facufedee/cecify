// Reglas de usuario y contraseña de las cuentas de organizador. Sin dependencias: las usan el navegador,
// el servidor y el script create:admin.
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/

export const passwordProblem = (password: string): string | null => {
  if (password.length < PASSWORD_MIN) return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`
  if (password.length > PASSWORD_MAX) return 'La contraseña es demasiado larga'
  return null
}
