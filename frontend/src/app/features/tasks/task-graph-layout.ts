import type { TaskDto } from '@robdev/shared';

export interface DagNodeLayout {
  task: TaskDto;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DagEdgeLayout {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  kind: 'dependency' | 'subtask';
  pathD: string;
}

export interface DagLayoutResult {
  nodes: DagNodeLayout[];
  edges: DagEdgeLayout[];
  width: number;
  height: number;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 76;
const COL_GAP = 84;
const ROW_GAP = 24;
const PADDING_X = 32;
const PADDING_Y = 32;

/**
 * Pure topological layering layout for tasks (parent/child + dependsOn edges).
 */
export function computeTaskGraphLayout(tasks: readonly TaskDto[]): DagLayoutResult {
  if (tasks.length === 0) {
    return { nodes: [], edges: [], width: 400, height: 240 };
  }

  const byId = new Map<string, TaskDto>(tasks.map((t) => [t.id, t]));
  const incoming = new Map<string, Set<string>>();
  const rawEdges: Array<{ from: string; to: string; kind: 'dependency' | 'subtask' }> = [];

  for (const t of tasks) {
    incoming.set(t.id, new Set<string>());
  }

  for (const t of tasks) {
    for (const depId of t.dependsOn ?? []) {
      if (byId.has(depId) && depId !== t.id) {
        incoming.get(t.id)!.add(depId);
        rawEdges.push({ from: depId, to: t.id, kind: 'dependency' });
      }
    }
    if (t.parentTaskId && byId.has(t.parentTaskId) && t.parentTaskId !== t.id) {
      if (!incoming.get(t.id)!.has(t.parentTaskId)) {
        incoming.get(t.id)!.add(t.parentTaskId);
        rawEdges.push({ from: t.parentTaskId, to: t.id, kind: 'subtask' });
      }
    }
  }

  // Compute longest-path column rank using memoized DFS with cycle guard
  const columnById = new Map<string, number>();
  const visiting = new Set<string>();

  const getColumn = (id: string): number => {
    if (columnById.has(id)) return columnById.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id);
    let maxPredCol = -1;
    if (preds) {
      for (const p of preds) {
        maxPredCol = Math.max(maxPredCol, getColumn(p));
      }
    }
    visiting.delete(id);
    const col = maxPredCol + 1;
    columnById.set(id, col);
    return col;
  };

  for (const t of tasks) {
    getColumn(t.id);
  }

  const columns = new Map<number, TaskDto[]>();
  let maxCol = 0;
  for (const t of tasks) {
    const col = columnById.get(t.id) ?? 0;
    maxCol = Math.max(maxCol, col);
    const list = columns.get(col) ?? [];
    list.push(t);
    columns.set(col, list);
  }

  const nodes: DagNodeLayout[] = [];
  const nodeById = new Map<string, DagNodeLayout>();
  let maxRows = 1;

  for (let col = 0; col <= maxCol; col++) {
    const colTasks = columns.get(col) ?? [];
    maxRows = Math.max(maxRows, colTasks.length);
    colTasks.forEach((task, row) => {
      const x = PADDING_X + col * (NODE_WIDTH + COL_GAP);
      const y = PADDING_Y + row * (NODE_HEIGHT + ROW_GAP);
      const layoutNode: DagNodeLayout = {
        task,
        column: col,
        row,
        x,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
      nodes.push(layoutNode);
      nodeById.set(task.id, layoutNode);
    });
  }

  const edges: DagEdgeLayout[] = [];
  for (const edge of rawEdges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const x1 = fromNode.x + fromNode.width;
    const y1 = fromNode.y + Math.round(fromNode.height / 2);
    const x2 = toNode.x;
    const y2 = toNode.y + Math.round(toNode.height / 2);
    const dx = Math.max(36, Math.round(Math.abs(x2 - x1) * 0.5));
    const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    edges.push({
      id: `${edge.kind}:${edge.from}->${edge.to}`,
      fromTaskId: edge.from,
      toTaskId: edge.to,
      kind: edge.kind,
      pathD,
    });
  }

  const width = Math.max(
    640,
    PADDING_X * 2 + (maxCol + 1) * NODE_WIDTH + maxCol * COL_GAP,
  );
  const height = Math.max(
    260,
    PADDING_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
  );

  return { nodes, edges, width, height };
}
