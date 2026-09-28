// PIN de los invitados: 4 numeros. Sin dependencias (lo usan el navegador y el servidor).
export const PIN_LENGTH = 4
export const PIN_RE = /^\d{4}$/

// Solo digitos y como mucho 4 (para el campo de texto)
export const cleanPin = (raw: string) => raw.replace(/\D/g, '').slice(0, PIN_LENGTH)
