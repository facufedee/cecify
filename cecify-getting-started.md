# Cecify - Getting Started Guide

**Proyecto:** Cecify (PWA Wedding App)  
**Stack:** Next.js 14 + Supabase + Socket.io + Vercel  
**Deadline:** 05/01/2027  
**Logo:** GL (Cecilia & Lucas) - Verde + Beige  

---

## 🔧 Requisitos Previos

```bash
# Instalar si no tenés:
- Node.js 18+ (https://nodejs.org)
- Git (https://git-scm.com)
- npm o pnpm (viene con Node)
- VS Code (https://code.visualstudio.com)

# Verificar instalación:
node --version    # v18.x.x o mayor
npm --version     # 9.x.x o mayor
git --version     # git version 2.x.x
```

---

## 📋 Paso 1: Crear Proyecto Next.js

```bash
# Navegar a donde quieras crear el proyecto
cd ~/Proyectos_App/cecify  

# Crear Next.js app
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-git

# Respuestas a las preguntas:
# Would you like to use ESLint? → Yes
# Would you like to use Tailwind CSS? → Yes
# Would you like your code inside a `src/` directory? → No
# Would you like to use App Router? → Yes
# Would you like to use Turbopack? → No
# Would you like to customize the import alias? → No

# Entrar a carpeta
cd cecify
```

---

## 📁 Paso 2: Estructura de Carpetas Inicial

```bash
# Crear estructura base
mkdir -p app/api/auth
mkdir -p app/api/profiles
mkdir -p app/api/swipes
mkdir -p app/api/matches
mkdir -p app/api/messages
mkdir -p app/api/photos
mkdir -p app/api/admin

mkdir -p app/onboarding
mkdir -p app/discover
mkdir -p app/matches
mkdir -p app/photos
mkdir -p app/profile
mkdir -p app/admin

mkdir -p components
mkdir -p lib
mkdir -p store
mkdir -p types
mkdir -p public/icons
mkdir -p styles

# Crear archivos base
touch lib/supabase.ts
touch lib/auth.ts
touch lib/socket.ts
touch store/useAppStore.ts
touch types/index.ts
```

**Resultado:**
```
cecify/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   ├── profiles/
│   │   ├── swipes/
│   │   ├── matches/
│   │   ├── messages/
│   │   ├── photos/
│   │   └── admin/
│   ├── onboarding/
│   ├── discover/
│   ├── matches/
│   ├── photos/
│   ├── profile/
│   ├── admin/
│   ├── layout.tsx
│   └── page.tsx
├── components/
├── lib/
├── store/
├── types/
├── public/
│   ├── icons/
│   ├── manifest.json
│   └── sw.js
├── styles/
├── .env.local (crear después)
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## ⚙️ Paso 3: Instalar Dependencias

```bash
npm install @supabase/supabase-js
npm install socket.io-client
npm install zustand
npm install framer-motion
npm install lucide-react
npm install sharp
npm install dotenv

# DevDependencies opcionales
npm install --save-dev @types/node @types/react
```

**Archivo package.json actualizado:**
```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@supabase/supabase-js": "^2.38.0",
    "socket.io-client": "^4.7.0",
    "zustand": "^4.4.0",
    "framer-motion": "^10.16.0",
    "lucide-react": "^0.292.0",
    "sharp": "^0.32.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.31",
    "autoprefixer": "^10.4.16"
  }
}
```

---

## 🔑 Paso 4: Configurar Supabase

### 4.1 - Crear Proyecto Supabase

1. Ir a https://supabase.com
2. Sign up o login
3. Click "New Project"
4. Datos:
   - **Name:** cecify
   - **Database Password:** Generar fuerte (copiar en lugar seguro)
   - **Region:** closest to Argentina (Sao Paulo o similar)
   - **Pricing:** Free
5. Esperar 2-3 minutos a que cree
6. Ir a "Settings" → "API"
7. Copiar:
   - **Project URL** (ej: https://xxxxx.supabase.co)
   - **Anon Key** (public, está bien)
   - **Service Role Key** (privada, guardar secreto)

### 4.2 - Crear `.env.local`

```bash
# En raíz de cecify/
touch .env.local
```

Contenido:
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxxxx...

# Supabase Service Role (solo para Node.js backend)
SUPABASE_SERVICE_ROLE_KEY=eyJxxxxx...

# Socket.io Server (configurar después)
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001  # local dev
# En prod: https://cecify-socket.railway.app

# Admin Password (cambiar después)
ADMIN_PASSWORD=cecify_admin_123_cambiar_esto

# JWT Secret (generar con: openssl rand -hex 32)
JWT_SECRET=tu_jwt_secret_aqui_32_caracteres_hex
```

**Generar JWT_SECRET:**
```bash
openssl rand -hex 32
# Copiar output al .env.local
```

### 4.3 - Crear DB Schema en Supabase

En Supabase Dashboard:
1. Ir a "SQL Editor"
2. Click "New Query"
3. Copiar y ejecutar el SQL del archivo `cecify-profundidad-tecnica.md` (schema completo)
4. Click "Run"

**O directamente:**
```bash
# Más tarde, vamos a hacer SQL migrations
# Por ahora, hacer manualmente en Supabase Dashboard
```

---

## 💾 Paso 5: Crear Cliente Supabase

**`lib/supabase.ts`:**
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// Para server-side (API routes)
export const supabaseServer = () => {
  return createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
```

---

## 🔐 Paso 6: Auth Helper

**`lib/auth.ts`:**
```typescript
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET!

export const generateToken = (userId: string, role: 'guest' | 'admin' = 'guest') => {
  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: '12h' }
  )
}

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET) as {
      userId: string
      role: string
    }
  } catch (error) {
    return null
  }
}
```

**Instalar JWT:**
```bash
npm install jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

---

## 🌐 Paso 7: Socket.io Setup

**`lib/socket.ts` (Client Side):**
```typescript
import { io } from 'socket.io-client'

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001'

let socket: any = null

export const connectSocket = (userId: string, token: string) => {
  if (socket?.connected) return socket

  socket = io(SOCKET_URL, {
    auth: {
      token,
      userId,
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  })

  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id)
  })

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected')
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
```

---

## 🎯 Paso 8: Zustand Store (State Management)

**`store/useAppStore.ts`:**
```typescript
import { create } from 'zustand'

interface User {
  id: string
  email: string
  role: 'guest' | 'admin'
}

interface AppState {
  user: User | null
  token: string | null
  isLoading: boolean
  error: string | null
  
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  isLoading: false,
  error: null,
  
  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  logout: () => set({ user: null, token: null }),
}))
```

---

## 📱 Paso 9: PWA Setup

### 9.1 - manifest.json

**`public/manifest.json`:**
```json
{
  "name": "Cecify - Lucas & Cecilia",
  "short_name": "Cecify",
  "description": "Matching de invitados + fotos de boda",
  "start_url": "/",
  "display": "standalone",
  "scope": "/",
  "theme_color": "#4A7C59",
  "background_color": "#FFFFFF",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

### 9.2 - Service Worker Skeleton

**`public/sw.js`:**
```javascript
const CACHE_NAME = 'cecify-v1'
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE)
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cache = caches.open(CACHE_NAME)
          cache.then((c) => c.put(event.request, response.clone()))
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request)
      })
  )
})
```

### 9.3 - Actualizar layout.tsx

**`app/layout.tsx`:**
```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cecify - Lucas & Cecilia',
  description: 'Matching de invitados + fotos de boda',
  manifest: '/manifest.json',
  themeColor: '#4A7C59',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cecify',
  },
  icons: {
    icon: '/icons/favicon.ico',
    apple: '/icons/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Cecify" />
      </head>
      <body className={inter.className}>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js').catch(() => {})
              }
            `,
          }}
        />
        {children}
      </body>
    </html>
  )
}
```

---

## 🚀 Paso 10: Git Inicial

```bash
# Inicializar git
git init

# Crear .gitignore (ya debería existir)
cat > .gitignore << 'EOF'
node_modules/
.next/
.env.local
.env*.local
.DS_Store
*.log
.vercel
EOF

# Primer commit
git add .
git config user.email "facundo@ejemplo.com"
git config user.name "Facundo"
git commit -m "init: setup inicial Cecify - Next.js + Supabase + PWA"
```

---

## ✅ Paso 11: Verificar Setup

```bash
# Verificar que todo compila
npm run build

# Si pasa sin errores, arrancamos dev
npm run dev
```

Debería ver:
```
> ready - started server on 0.0.0.0:3000, url: http://localhost:3000
```

Ir a `http://localhost:3000` en navegador → página default de Next.js

---

## 🔌 Paso 12: Configurar Railway (Socket.io Server)

### 12.1 - Crear carpeta Socket Server

```bash
# En la misma carpeta de cecify/
cd ..
mkdir cecify-socket
cd cecify-socket

npm init -y
npm install express socket.io cors dotenv

# Crear estructura
mkdir -p src
touch src/server.ts
touch .env
touch .env.example
touch .gitignore
```

### 12.2 - Server Básico (Semana 1 skeleton)

**`src/server.ts`:**
```typescript
import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import * as dotenv from 'dotenv'

dotenv.config()

const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
})

app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Socket.io namespaces
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`)

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 3001

httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.io server listening on port ${PORT}`)
})
```

**`package.json`:**
```json
{
  "name": "cecify-socket",
  "version": "1.0.0",
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.0"
  },
  "devDependencies": {
    "tsx": "^4.5.0",
    "typescript": "^5.2.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/cors": "^2.8.0"
  }
}
```

**`.env`:**
```
PORT=3001
CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
```

### 12.3 - Deploy a Railway

1. Crear cuenta en https://railway.app
2. Click "New Project" → "Deploy from GitHub" o "Create from Template"
3. Seleccionar Node.js
4. Conectar repo `cecify-socket`
5. Railway auto detecta `package.json`
6. En "Variables", agregar:
   ```
   PORT=3001
   CORS_ORIGIN=https://cecify.vercel.app
   NODE_ENV=production
   ```
7. Deploy
8. Copiar URL de Railway (ej: https://cecify-socket.railway.app)
9. Actualizar `.env.local` de cecify:
   ```
   NEXT_PUBLIC_SOCKET_URL=https://cecify-socket.railway.app
   ```

---

## 🎨 Paso 13: Copiar Logo GL

Descargar los archivos PNG de logo GL:
- `icon-192.png` (beige fondo)
- `icon-512.png` (beige fondo)
- `icon-maskable-192.png` (transparente)
- `favicon.ico` (pequeño)
- `apple-touch-icon.png` (192x192)

Copiar a `public/icons/`

---

## 📅 Semana 1: Tareas

```
SEMANA 1 (20/09 - 26/09):
┌─────────────────────────────────────┐
│ ✅ Setup Next.js + Supabase         │
│ ✅ PWA manifest + Service Worker    │
│ ✅ Socket.io server básico          │
│ ✅ Auth helpers + JWT               │
│ ✅ Zustand store                    │
│ ✅ Deploy skeleton a Vercel         │
│ ✅ Deploy skeleton a Railway        │
│ ✅ Verificar conexión DB            │
│ ✅ GitHub repo privado              │
│                                     │
│ SEMANA 1 HITO:                      │
│ - App desplegada en vercel.app      │
│ - Socket server en railway.app      │
│ - Todo compilando sin errores       │
│ - DB schema creado                  │
└─────────────────────────────────────┘
```

---

## 🚀 Paso 14: Deployment Skeleton

### Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Responder:
# - "Set up and deploy "cecify"?" → yes
# - Link to existing project? → no
# - Project name? → cecify
# - Which directory? → ./
# - Modify settings? → no
```

Copiar URL (ej: https://cecify.vercel.app)

### Railway (Socket)

Ya hecho en Paso 12

---

## 📋 Checklist Completar Antes de Semana 2

- [ ] Next.js app creado y funcionando
- [ ] Supabase proyecto creado
- [ ] .env.local con credentials
- [ ] DB schema ejecutado en Supabase
- [ ] Socket.io server en Railway
- [ ] Logo GL en `/public/icons/`
- [ ] App desplegada en Vercel
- [ ] Socket URL actualizado en .env
- [ ] Service Worker funcionando (DevTools → Application)
- [ ] PWA installable (banner en mobile)
- [ ] GitHub repo creado
- [ ] Primer commit pusheado

---

## 🎯 Cuando Tengas Todo Listo

Me avisas y pasamos a **Semana 1 Code:**

1. **API Route: POST /api/auth/login** (código mágico)
2. **Página de Login** (formulario + validación)
3. **Onboarding básico** (crear perfil)
4. **Primera API call** (guardar en Supabase)
5. **Testing en mobile real**

---

**¿Empezamos o tenés dudas en algún paso?**

Una vez que tengas todo esto listo (debería tomar ~1-2 horas), me avisas y hacemos el primer API route 🚀
