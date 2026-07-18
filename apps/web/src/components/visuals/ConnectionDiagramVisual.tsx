import { memo, useMemo } from "react";
import type { ConnectionDiagramSpec, DiagramEnd, DiagramNode, VisualTone } from "../../visual-spec";

type NodePosition = { x: number; y: number; width: number; height: number };
type DiagramLayout = { width: number; height: number; positions: Map<string, NodePosition> };

const NODE_WIDTH = 190;
const NODE_HEIGHT = 104;
const RANK_GAP = 130;
const CROSS_GAP = 34;
const PADDING = 52;

function buildLayout(spec: ConnectionDiagramSpec): DiagramLayout {
  const nodeIds = new Set(spec.nodes.map((node) => node.id));
  const indegree = new Map(spec.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  const ranks = new Map(spec.nodes.map((node) => [node.id, 0]));

  for (const connection of spec.connections) {
    if (!nodeIds.has(connection.from.node) || !nodeIds.has(connection.to.node)) continue;
    outgoing.get(connection.from.node)?.push(connection.to.node);
    indegree.set(connection.to.node, (indegree.get(connection.to.node) ?? 0) + 1);
  }

  const queue = spec.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    if (!nodeId) continue;
    for (const target of outgoing.get(nodeId) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(nodeId) ?? 0) + 1));
      const nextIndegree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) queue.push(target);
    }
  }

  const groups = new Map<number, DiagramNode[]>();
  for (const node of spec.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  const orderedRanks = [...groups.keys()].sort((left, right) => left - right);
  const rankIndex = new Map(orderedRanks.map((rank, index) => [rank, index]));
  const maxCrossCount = Math.max(...[...groups.values()].map((group) => group.length));
  const horizontal = spec.layout.direction === "left-to-right";
  const rankCount = Math.max(orderedRanks.length, 1);
  const width = horizontal
    ? PADDING * 2 + rankCount * NODE_WIDTH + Math.max(0, rankCount - 1) * RANK_GAP
    : PADDING * 2 + maxCrossCount * NODE_WIDTH + Math.max(0, maxCrossCount - 1) * CROSS_GAP;
  const height = horizontal
    ? PADDING * 2 + maxCrossCount * NODE_HEIGHT + Math.max(0, maxCrossCount - 1) * CROSS_GAP
    : PADDING * 2 + rankCount * NODE_HEIGHT + Math.max(0, rankCount - 1) * RANK_GAP;
  const positions = new Map<string, NodePosition>();

  for (const [rank, group] of groups) {
    const groupCrossSize = horizontal
      ? group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * CROSS_GAP
      : group.length * NODE_WIDTH + Math.max(0, group.length - 1) * CROSS_GAP;
    const crossOffset = (horizontal ? height : width) / 2 - groupCrossSize / 2;
    const primaryIndex = rankIndex.get(rank) ?? 0;
    group.forEach((node, crossIndex) => {
      positions.set(node.id, horizontal ? {
        x: PADDING + primaryIndex * (NODE_WIDTH + RANK_GAP),
        y: crossOffset + crossIndex * (NODE_HEIGHT + CROSS_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      } : {
        x: crossOffset + crossIndex * (NODE_WIDTH + CROSS_GAP),
        y: PADDING + primaryIndex * (NODE_HEIGHT + RANK_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      });
    });
  }

  return { width, height, positions };
}

function endpointPosition(spec: ConnectionDiagramSpec, layout: DiagramLayout, end: DiagramEnd, from: boolean): { x: number; y: number } {
  const node = spec.nodes.find((candidate) => candidate.id === end.node);
  const position = layout.positions.get(end.node);
  if (!node || !position) return { x: 0, y: 0 };
  const defaultSide = spec.layout.direction === "left-to-right" ? (from ? "right" : "left") : (from ? "bottom" : "top");
  const port = end.port ? node.ports?.find((candidate) => candidate.id === end.port) : undefined;
  const side = port?.side ?? defaultSide;
  const portsOnSide = (node.ports ?? []).filter((candidate) => (candidate.side ?? defaultSide) === side);
  const portIndex = port ? Math.max(0, portsOnSide.findIndex((candidate) => candidate.id === port.id)) : 0;
  const fraction = port ? (portIndex + 1) / (portsOnSide.length + 1) : 0.5;
  if (side === "left") return { x: position.x, y: position.y + position.height * fraction };
  if (side === "right") return { x: position.x + position.width, y: position.y + position.height * fraction };
  if (side === "top") return { x: position.x + position.width * fraction, y: position.y };
  return { x: position.x + position.width * fraction, y: position.y + position.height };
}

function endpointSide(spec: ConnectionDiagramSpec, end: DiagramEnd, from: boolean): "top" | "right" | "bottom" | "left" {
  const node = spec.nodes.find((candidate) => candidate.id === end.node);
  const defaultSide = spec.layout.direction === "left-to-right" ? (from ? "right" : "left") : (from ? "bottom" : "top");
  return (end.port ? node?.ports?.find((candidate) => candidate.id === end.port)?.side : undefined) ?? defaultSide;
}

function arrowGeometry(
  tip: { x: number; y: number },
  side: "top" | "right" | "bottom" | "left",
  emphasis: "normal" | "primary" | "muted" = "normal"
): { base: { x: number; y: number }; points: string } {
  const length = emphasis === "primary" ? 14 : 11;
  const halfWidth = emphasis === "primary" ? 8 : 6;
  const direction = side === "left" ? { x: 1, y: 0 }
    : side === "right" ? { x: -1, y: 0 }
      : side === "top" ? { x: 0, y: 1 }
        : { x: 0, y: -1 };
  const base = { x: tip.x - direction.x * length, y: tip.y - direction.y * length };
  const perpendicular = { x: -direction.y * halfWidth, y: direction.x * halfWidth };
  return {
    base,
    points: `${tip.x},${tip.y} ${base.x + perpendicular.x},${base.y + perpendicular.y} ${base.x - perpendicular.x},${base.y - perpendicular.y}`
  };
}

function connectionPath(spec: ConnectionDiagramSpec, from: { x: number; y: number }, to: { x: number; y: number }): string {
  if (spec.layout.direction === "left-to-right") {
    const middle = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`;
  }
  const middle = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${middle}, ${to.x} ${middle}, ${to.x} ${to.y}`;
}

function tone(toneValue: VisualTone | undefined): string {
  return toneValue ?? "neutral";
}

function endpointLabel(spec: ConnectionDiagramSpec, end: DiagramEnd): string {
  const node = spec.nodes.find((candidate) => candidate.id === end.node);
  const port = end.port ? node?.ports?.find((candidate) => candidate.id === end.port) : undefined;
  return port ? `${node?.label ?? end.node} — ${port.label}` : node?.label ?? end.node;
}

export const ConnectionDiagramVisual = memo(function ConnectionDiagramVisual({ spec, visualId }: { spec: ConnectionDiagramSpec; visualId: string }) {
  const layout = useMemo(() => buildLayout(spec), [spec]);
  const connections = useMemo(() => spec.connections.map((connection) => {
    const from = endpointPosition(spec, layout, connection.from, true);
    const to = endpointPosition(spec, layout, connection.to, false);
    const emphasis = connection.emphasis ?? "normal";
    const arrow = arrowGeometry(to, endpointSide(spec, connection.to, false), emphasis);
    return {
      connection,
      emphasis,
      arrow,
      path: connectionPath(spec, from, arrow.base),
      labelPosition: { x: (from.x + arrow.base.x) / 2, y: (from.y + arrow.base.y) / 2 },
      labelWidth: connection.label ? Math.max(42, connection.label.length * 6.4 + 14) : 0,
      toneName: tone(connection.tone)
    };
  }), [layout, spec]);

  return (
    <div className="connection-diagram-wrap">
      <div className="connection-diagram-scroll">
        <svg className="connection-diagram" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-labelledby={`visual-title-${visualId} diagram-desc-${visualId}`}>
          <desc id={`diagram-desc-${visualId}`}>{spec.description ?? `${spec.nodes.length} items connected by ${spec.connections.length} labeled relationships.`}</desc>
          <g className="diagram-connections">
            {connections.map(({ connection, emphasis, arrow, path, toneName }) => (
              <g key={connection.id} className={`diagram-connection tone-${toneName} emphasis-${emphasis}`}>
                <path d={path} />
                <polygon points={arrow.points} />
              </g>
            ))}
          </g>

          <g className="diagram-nodes">
            {spec.nodes.map((node) => {
              const position = layout.positions.get(node.id);
              if (!position) return null;
              return (
                <g key={node.id} className={`diagram-node role-${node.role} tone-${tone(node.tone)}`} transform={`translate(${position.x} ${position.y})`}>
                  <rect width={position.width} height={position.height} rx={node.role === "junction" ? 48 : 14} />
                  <foreignObject x="10" y="10" width={position.width - 20} height={position.height - 20}>
                    <div className="diagram-node-content">
                      <span>{node.role}</span>
                      <strong>{node.label}</strong>
                      {node.detail ? <small>{node.detail}</small> : null}
                      {node.ports?.length ? <em>{node.ports.map((port) => port.label).join(" · ")}</em> : null}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>

          <g className="diagram-connection-labels">
            {connections.map(({ connection, emphasis, labelPosition, labelWidth, toneName }) => connection.label ? (
              <g key={connection.id} className={`diagram-connection tone-${toneName} emphasis-${emphasis}`}>
                <g className="diagram-connection-label" transform={`translate(${labelPosition.x} ${labelPosition.y})`}>
                  <rect x={-labelWidth / 2} y="-9" width={labelWidth} height="18" rx="5" />
                  <text y="3.5" textAnchor="middle">{connection.label}</text>
                </g>
              </g>
            ) : null)}
          </g>
        </svg>
      </div>

      {spec.callouts?.length ? (
        <ul className="diagram-callouts">
          {spec.callouts.map((callout, index) => <li key={`${callout.target.node}:${callout.target.port ?? "node"}:${index}`} className={`tone-${tone(callout.tone)}`}><strong>{endpointLabel(spec, callout.target)}</strong><span>{callout.text}</span></li>)}
        </ul>
      ) : null}

      <details className="diagram-text-alternative">
        <summary>Connection list</summary>
        <ul>{spec.connections.map((connection) => <li key={connection.id}><strong>{endpointLabel(spec, connection.from)}</strong><span> connects to </span><strong>{endpointLabel(spec, connection.to)}</strong>{connection.label ? <span> — {connection.label}</span> : null}</li>)}</ul>
      </details>
    </div>
  );
});
