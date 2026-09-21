import { io, Socket } from 'socket.io-client'
import { getToken } from '@/lib/client-auth'

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001'

let socket: Socket | null = null

// Una sola conexion por sesion. La identidad la fija el servidor a partir del JWT.
export const connectSocket = (token: string) => {
  if (socket) return socket

  socket = io(SOCKET_URL, {
    // En cada (re)conexion se toma el token vigente: si se renovo, el viejo podria estar vencido
    auth: (cb) => cb({ token: getToken() ?? token }),
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  })
  return socket
}

export const getSocket = () => socket

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
