/** 连线视图：拓扑绑定 fromSide/toSide，节点移动时自动重算 */
import Konva from 'konva';
import type { CanvasEdge } from '../core/types';
import { bezierPath, inferSides, mindmapEdgeCurve, rectCenter, sideAnchor, type Rect } from '../core/geometry';
import { cubicMidpoint, trimCubicEnd } from '../core/arrowLink';
import type { Palette } from './palette';
import { resolveColor } from './palette';

const EDGE_HEAD_LEN = 9;

export class EdgeView {
  group: Konva.Group;
  private line: Konva.Line;
  private head: Konva.Line;
  /** 关系描述文本（edge.label，画在曲线中点，垫底色牌保证可读） */
  private labelNode: Konva.Label;

  constructor(private palette: Palette) {
    this.group = new Konva.Group({ listening: false });
    this.line = new Konva.Line({ listening: false, lineCap: 'round' });
    this.head = new Konva.Line({ closed: true, listening: false });
    this.labelNode = new Konva.Label({ listening: false });
    this.group.add(this.line);
    this.group.add(this.head);
    this.group.add(this.labelNode);
  }

  update(edge: CanvasEdge, from: Rect | null, to: Rect | null): void {
    if (!from || !to) {
      this.group.visible(false);
      return;
    }
    this.group.visible(true);
    const color = resolveColor(edge.color, this.palette) ?? (edge.kind === 'mindmap' ? this.palette.accent : this.palette.edge);

    if (edge.kind === 'mindmap') {
      // 导图分支线：三次贝塞尔（Konva Line 默认是折线模式，必须开 bezier 才把
      // 8 个数字识别为 起点/控制点1/控制点2/终点），无箭头
      const [p0, c1, c2, p1] = mindmapEdgeCurve(from, to).path;
      this.line.setAttrs({
        points: [p0.x, p0.y, c1.x, c1.y, c2.x, c2.y, p1.x, p1.y],
        bezier: true,
        stroke: color,
        strokeWidth: 1.6,
        opacity: 0.85,
      });
      this.head.visible(false);
      this.updateLabel(cubicMidpoint([p0.x, p0.y, c1.x, c1.y, c2.x, c2.y, p1.x, p1.y]), edge.label);
      return;
    }

    const sides = inferSides(from, to);
    const fromSide = edge.fromSide ?? sides.fromSide;
    const toSide = edge.toSide ?? sides.toSide;
    const a = sideAnchor(from, fromSide);
    const b = sideAnchor(to, toSide);
    const { path, endTangent } = bezierPath(a, fromSide, b, toSide);
    const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = path.flatMap((p) => [p.x, p.y]);

    // 杆末端沿曲线回缩一段（de Casteljau 截断，形状不变），圆头线帽藏进箭头内部 ——
    // 否则圆帽从三角尖端冒出，箭头看着像圆头
    const trimmed = trimCubicEnd(path.flatMap((p) => [p.x, p.y]), EDGE_HEAD_LEN * 0.7);
    const [tx1, ty1, tc1x, tc1y, tc2x, tc2y, tx2, ty2] = trimmed;

    this.line.setAttrs({
      points: trimmed,
      bezier: true, // 8 个数字按 起点/控制点1/控制点2/终点 的三次贝塞尔渲染；默认折线模式会把控制点画成拐点
      stroke: color,
      strokeWidth: 2,
    });

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
    this.updateLabel(cubicMidpoint([x1, y1, c1x, c1y, c2x, c2y, x2, y2]), edge.label);
  }

  /** 关系描述：曲线中点上垫底色小牌的文字；无 label 时隐藏 */
  private updateLabel(mid: { x: number; y: number }, label?: string): void {
    const text = (label ?? '').trim();
    this.labelNode.visible(!!text);
    if (!text) return;
    this.labelNode.position({ x: mid.x, y: mid.y });
    const kids = this.labelNode.getChildren();
    if (kids.length < 2) {
      const tag = new Konva.Tag({ cornerRadius: 4, opacity: 0.92, listening: false });
      const textEl = new Konva.Text({ fontSize: 13, fontFamily: 'system-ui, sans-serif', padding: 4, listening: false });
      this.labelNode.add(tag);
      this.labelNode.add(textEl);
    }
    const tag = kids[0] as Konva.Tag;
    const textEl = kids[1] as Konva.Text;
    textEl.text(text);
    textEl.fill(this.palette.text);
    tag.fill(this.palette.canvasBg);
    // Label 以自身宽高居中锚定到中点
    this.labelNode.offsetX(this.labelNode.width() / 2);
    this.labelNode.offsetY(this.labelNode.height() / 2);
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
