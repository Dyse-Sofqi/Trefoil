/** 连线视图：拓扑绑定 fromSide/toSide，节点移动时自动重算 */
import Konva from 'konva';
import type { CanvasEdge } from '../core/types';
import { bezierPath, inferSides, rectCenter, sideAnchor, type Rect } from '../core/geometry';
import type { Palette } from './palette';
import { resolveColor } from './palette';

export class EdgeView {
  group: Konva.Group;
  private line: Konva.Line;
  private head: Konva.Line;

  constructor(private palette: Palette) {
    this.group = new Konva.Group({ listening: false });
    this.line = new Konva.Line({ listening: false, lineCap: 'round' });
    this.head = new Konva.Line({ closed: true, listening: false });
    this.group.add(this.line);
    this.group.add(this.head);
  }

  update(edge: CanvasEdge, from: Rect | null, to: Rect | null): void {
    if (!from || !to) {
      this.group.visible(false);
      return;
    }
    this.group.visible(true);
    const sides = inferSides(from, to);
    const fromSide = edge.fromSide ?? sides.fromSide;
    const toSide = edge.toSide ?? sides.toSide;
    const a = sideAnchor(from, fromSide);
    const b = sideAnchor(to, toSide);
    const { path, endTangent } = bezierPath(a, fromSide, b, toSide);
    const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = path.flatMap((p) => [p.x, p.y]);

    const isMindmap = edge.kind === 'mindmap';
    const color = resolveColor(edge.color, this.palette) ?? (isMindmap ? this.palette.accent : this.palette.edge);
    const sw = isMindmap ? 1.6 : 2;

    this.line.setAttrs({
      points: [x1, y1, c1x, c1y, c2x, c2y, x2, y2],
      stroke: color,
      strokeWidth: sw,
      opacity: isMindmap ? 0.85 : 1,
    });

    if (isMindmap) {
      this.head.visible(false);
    } else {
      const ang = Math.atan2(endTangent.y, endTangent.x);
      const len = 9;
      const spread = 0.45;
      this.head.setAttrs({
        visible: true,
        points: [
          x2,
          y2,
          x2 - len * Math.cos(ang - spread),
          y2 - len * Math.sin(ang - spread),
          x2 - len * Math.cos(ang + spread),
          y2 - len * Math.sin(ang + spread),
        ],
        fill: color,
      });
    }
  }
}

export function edgeBounds(from: Rect | null, to: Rect | null): Rect | null {
  if (!from || !to) return null;
  const c1 = rectCenter(from);
  const c2 = rectCenter(to);
  return {
    x: Math.min(c1.x, c2.x),
    y: Math.min(c1.y, c2.y),
    width: Math.abs(c2.x - c1.x),
    height: Math.abs(c2.y - c1.y),
  };
}
