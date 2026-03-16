import { cn } from '@/lib/utils'

interface Edge {
    source_node_id: string
    target_node_id: string
    edge_type: string
}

interface Node {
    id: string
    node_type: string
    content: string
}

interface ConnectionChipsProps {
    nodeId: string
    edges: Edge[]
    nodeMap: Map<string, Node>
    onChipClick?: (nodeId: string) => void
}

const typeColors: Record<string, string> = {
    decision: 'bg-chart-3/10 text-chart-3 border-chart-3/20',
    action_item: 'bg-primary/10 text-primary border-primary/20',
    risk: 'bg-chart-5/10 text-chart-5 border-chart-5/20',
    topic: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
    person: 'bg-secondary text-secondary-foreground border-border/50',
}

const edgeLabels: Record<string, string> = {
    DECIDED: 'decided',
    RATIFIED: 'ratified',
    OWNS: 'owns',
    RAISED: 'raised',
    DISCUSSED: 'discusses',
    DEPENDS_ON: 'depends on',
    RELATES_TO: 'related',
    ATTENDED: 'attended',
    MENTIONED_IN: 'mentioned in',
}

export function ConnectionChips({ nodeId, edges, nodeMap, onChipClick }: ConnectionChipsProps) {
    // Find edges connected to this node
    const connected = edges.filter(e => e.source_node_id === nodeId || e.target_node_id === nodeId)

    if (connected.length === 0) return null

    return (
        <div className="flex flex-wrap gap-1.5 pt-2">
            {connected.map((edge, i) => {
                const otherId = edge.source_node_id === nodeId ? edge.target_node_id : edge.source_node_id
                const otherNode = nodeMap.get(otherId)
                if (!otherNode || otherNode.node_type === 'transcript_chunk' || otherNode.node_type === 'meeting') return null

                const label = edgeLabels[edge.edge_type] || edge.edge_type
                const truncated = otherNode.content.length > 40
                    ? otherNode.content.substring(0, 40) + '...'
                    : otherNode.content

                return (
                    <button
                        key={i}
                        onClick={() => onChipClick?.(otherId)}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs transition-colors hover:opacity-80',
                            typeColors[otherNode.node_type] || typeColors.person
                        )}
                    >
                        <span className="font-medium">{label}:</span>
                        <span>{truncated}</span>
                    </button>
                )
            })}
        </div>
    )
}
