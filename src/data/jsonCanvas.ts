/**
 * JSON Canvas 规范（https://jsoncanvas.org）序列化/反序列化。
 * - 标准字段原样保留；Trefoil 扩展字段使用 `trefoil:` 命名空间前缀。
 * - 容器内部节点在文件中以相对坐标存储（相对容器左上角），内存中统一为绝对坐标。
 * - 未知节点类型按规范要求原样保留。
 */
import type { CanvasDoc, CanvasEdge, CanvasNode } from '../core/types';
import { isContainerNode } from '../core/types';

type JcRecord = Record<string, unknown>;

export function createEmptyDocJson(): string {
  return JSON.stringify({ nodes: [], edges: [] } satisfies CanvasDoc, null, 2);
}

// ---------- 序列化 ----------

const NODE_EXT_FIELDS = [
  'shape',
  'fill',
  'stroke',
  'strokeSize',
  'opacity',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'hAlign',
  'vAlign',
  'flipX',
  'flipY',
  'points',
  'fileSize',
  'containerId',
  'treeParent',
  'collapsed',
  'layout',
  'groupId',
] as const;

const EDGE_EXT_FIELDS = ['kind'] as const;

export function serializeDoc(doc: CanvasDoc): string {
  const nodes = doc.nodes.map((n) => {
    const out: JcRecord = {
      id: n.id,
      type: n.type,
      x: round(n.x),
      y: round(n.y),
      width: round(n.width),
      height: round(n.height),
    };
    if (n.text !== undefined) out.text = n.text;
    // file 节点（图片等附件）：标准字段，原样写库内路径
    if (n.file !== undefined && n.file !== '') out.file = n.file;
    if (n.color !== undefined) out.color = n.color;
    for (const f of NODE_EXT_FIELDS) {
      const v = (n as unknown as Record<string, unknown>)[f];
      if (v !== undefined && v !== null && v !== false && v !== '') out[`trefoil:${f}`] = v;
    }
    // 容器子节点 → 相对坐标
    if (n.containerId) {
      const parent = doc.nodes.find((p) => p.id === n.containerId);
      if (parent) {
        out.x = round(n.x - parent.x);
        out.y = round(n.y - parent.y);
      }
    }
    return out;
  });

  const edges = doc.edges.map((e) => {
    const out: JcRecord = {
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
    };
    if (e.fromSide) out.fromSide = e.fromSide;
    if (e.toSide) out.toSide = e.toSide;
    if (e.color !== undefined) out.color = e.color;
    if (e.label) out.label = e.label;
    for (const f of EDGE_EXT_FIELDS) {
      const v = (e as unknown as Record<string, unknown>)[f];
      if (v !== undefined && v !== null) out[`trefoil:${f}`] = v;
    }
    return out;
  });

  return JSON.stringify({ nodes, edges }, null, 2);
}

// ---------- 反序列化 ----------

export function parseDoc(json: string): CanvasDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { nodes: [], edges: [] };
  }
  const obj = (raw ?? {}) as { nodes?: JcRecord[]; edges?: JcRecord[] };
  const nodes: CanvasNode[] = [];
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];

  for (const rn of rawNodes) {
    if (!rn || typeof rn !== 'object') continue;
    const n: CanvasNode = {
      id: String(rn.id ?? ''),
      type: String(rn.type ?? 'text'),
      x: num(rn.x),
      y: num(rn.y),
      width: Math.max(1, num(rn.width)),
      height: Math.max(1, num(rn.height)),
    };
    if (typeof rn.text === 'string') n.text = rn.text;
    if (typeof rn.file === 'string' && rn.file) n.file = rn.file;
    if (typeof rn.color === 'string') n.color = rn.color;
    for (const f of NODE_EXT_FIELDS) {
      const v = rn[`trefoil:${f}`];
      if (v !== undefined) (n as unknown as Record<string, unknown>)[f] = v;
    }
    if (n.containerId === '') n.containerId = null;
    if (n.treeParent === '') n.treeParent = null;
    if (n.groupId === '') n.groupId = null;
    nodes.push(n);
  }

  // 相对坐标 → 绝对坐标；孤儿子节点还原为自由节点
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!n.containerId) continue;
    const parent = byId.get(n.containerId);
    if (parent && isContainerNode(parent)) {
      n.x += parent.x;
      n.y += parent.y;
    } else {
      n.containerId = null;
    }
  }

  const edges: CanvasEdge[] = [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  for (const re of rawEdges) {
    if (!re || typeof re !== 'object') continue;
    const id = String(re.id ?? '');
    const fromNode = String(re.fromNode ?? '');
    const toNode = String(re.toNode ?? '');
    if (!id || !fromNode || !toNode) continue;
    const e: CanvasEdge = { id, fromNode, toNode };
    if (typeof re.fromSide === 'string') e.fromSide = re.fromSide as CanvasEdge['fromSide'];
    if (typeof re.toSide === 'string') e.toSide = re.toSide as CanvasEdge['toSide'];
    if (typeof re.color === 'string') e.color = re.color;
    if (typeof re.label === 'string') e.label = re.label;
    for (const f of EDGE_EXT_FIELDS) {
      const v = re[`trefoil:${f}`];
      if (v !== undefined) (e as unknown as Record<string, unknown>)[f] = v;
    }
    edges.push(e);
  }

  return { nodes, edges };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
