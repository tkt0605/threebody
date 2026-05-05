import { ref } from 'vue'

export type FeatureId = 'chat' | 'mcp' | 'ctx'

export interface FeatureDef {
  id: FeatureId
  label: string
  color: string
  iconPath: string
}

export interface PlacedNode extends FeatureDef {
  x: number
  y: number
}

export const FEATURES: FeatureDef[] = [
  {
    id: 'chat',
    label: 'Chat',
    color: '#f87171',
    iconPath: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  },
  {
    id: 'mcp',
    label: 'MCP',
    color: '#4ade80',
    iconPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  },
  {
    id: 'ctx',
    label: 'Context',
    color: '#60a5fa',
    iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8',
  },
]

// Module-level singleton — all components share the same triangle state
const placedNodes = ref<PlacedNode[]>([])

export function useTriangleNodes() {
  function isPlaced(id: FeatureId) {
    return placedNodes.value.some(n => n.id === id)
  }

  function addNode(id: FeatureId, x: number, y: number) {
    if (isPlaced(id)) return
    const def = FEATURES.find(f => f.id === id)
    if (!def) return
    placedNodes.value.push({ ...def, x, y })
  }

  function removeNode(id: FeatureId) {
    placedNodes.value = placedNodes.value.filter(n => n.id !== id)
  }

  function updatePos(id: FeatureId, x: number, y: number) {
    const node = placedNodes.value.find(n => n.id === id)
    if (node) { node.x = x; node.y = y }
  }

  return { placedNodes, isPlaced, addNode, removeNode, updatePos }
}
