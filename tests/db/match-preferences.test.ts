import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

// Descubrir filtra por genero y edad en los dos sentidos
let db: Db
const ids: Record<string, string> = {}

type P = { gender: string | null; interested: string | null; age: number; min?: number | null; max?: number | null }

const setPrefs = (name: string, p: P) =>
  q(
    db,
    `update profiles set gender = $2, interested_in = $3, age = $4, pref_age_min = $5, pref_age_max = $6 where user_id = $1`,
    [ids[name], p.gender, p.interested, p.age, p.min ?? null, p.max ?? null]
  )

const sees = async (name: string) =>
  (await q<{ name: string }>(db, 'select * from discover_profiles($1, 20)', [ids[name]])).map((r) => r.name).sort()

beforeAll(async () => {
  db = await createDb()
  for (const n of ['Ana', 'Bea', 'Carlos', 'Dani', 'Eze', 'Fer']) ids[n] = await createUser(db, n)
  await setPrefs('Ana', { gender: 'woman', interested: 'men', age: 30, min: 25, max: 40 })
  await setPrefs('Bea', { gender: 'woman', interested: 'women', age: 28 })
  await setPrefs('Carlos', { gender: 'man', interested: 'women', age: 35 })
  await setPrefs('Dani', { gender: 'nonbinary', interested: 'everyone', age: 27 })
  await setPrefs('Eze', { gender: 'man', interested: 'everyone', age: 50 }) // fuera del rango de Ana
  await setPrefs('Fer', { gender: null, interested: null, age: 33 }) // perfil viejo, sin datos
})
afterAll(async () => {
  await db.close()
})

describe('filtro mutuo de Descubrir', () => {
  it('Ana (mujer, busca hombres de 25 a 40) solo ve hombres en su rango que buscan mujeres', async () => {
    // Carlos si; Eze tiene 50; Dani y Fer no son hombres; Bea es mujer
    expect(await sees('Ana')).toEqual(['Carlos'])
  })

  it('Carlos ve a Ana pero no a Bea (Bea busca mujeres) ni a Dani (Carlos busca mujeres)', async () => {
    expect(await sees('Carlos')).toEqual(['Ana'])
  })

  it('quien busca a todos ve a quien tambien lo busca a el, sin importar el genero', async () => {
    // Dani (no binario) solo encaja con quien busca a todos: Eze. Fer no tiene preferencias: no filtra
    expect(await sees('Dani')).toEqual(['Eze', 'Fer'])
  })

  it('el rango de edad tambien corre para el otro lado: Eze (50) no ve a Ana porque Ana busca hasta 40', async () => {
    expect(await sees('Eze')).not.toContain('Ana')
    expect(await sees('Eze')).toEqual(expect.arrayContaining(['Dani', 'Fer']))
  })

  it('un perfil sin genero cargado solo le aparece a quien busca a todos o no tiene preferencias', async () => {
    expect(await sees('Ana')).not.toContain('Fer')
    expect(await sees('Carlos')).not.toContain('Fer')
    expect(await sees('Dani')).toContain('Fer')
  })

  it('upsert_profile guarda las preferencias y valida el rango', async () => {
    const [{ out_profile }] = await q<{ out_profile: Record<string, unknown> }>(
      db,
      `select * from upsert_profile(p_user => $1, p_name => 'Ana', p_age => 30, p_bio => '', p_main_photo_url => '/a.jpg',
         p_additional_photos => '[]'::jsonb, p_interests => '["Baile"]'::jsonb, p_contact_methods => '{}'::jsonb,
         p_visibility => true, p_wants_match => true, p_looking_for => '{meet}', p_side => 'bride',
         p_gender => 'woman', p_interested_in => 'everyone', p_pref_age_min => 20, p_pref_age_max => 45)`,
      [ids.Ana]
    )
    expect(out_profile).toMatchObject({ gender: 'woman', interested_in: 'everyone', pref_age_min: 20, pref_age_max: 45 })
    await expect(q(db, 'update profiles set pref_age_min = 50, pref_age_max = 30 where user_id = $1', [ids.Ana])).rejects.toThrow()
    await expect(q(db, `update profiles set gender = 'otro' where user_id = $1`, [ids.Ana])).rejects.toThrow()
  })
})
