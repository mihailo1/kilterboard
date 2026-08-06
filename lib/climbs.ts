import routes from '@/data/routes.json'
import type { Climb } from '@/types'

export function getClimbs(): Climb[] {
  return routes as Climb[]
}

export function getClimbById(id: string): Climb | undefined {
  return getClimbs().find((c) => c.id === id)
}
