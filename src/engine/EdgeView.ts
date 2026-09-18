/** 连线视图：拓扑绑定 fromSide/toSide，节点移动时自动重算 */
import Konva from 'konva';
import type { CanvasEdge } from '../core/types';
import { bezierPath, inferSides, mindmapEdgeCurve, rectCenter, sideAnchor, type Rect } from '../core/geometry';
import { cubicMidpoint } from '../core/arrowLink';
import type { Palette } from './palette';
import { resolveColor } from './palette';
import { arrowPaintShape, type ArrowPaintInput } from './arrowPaint';

export class EdgeView {
  group: Konva.Group;
  /** 线杆 + 箭头头单形状一次绘制（惰性读取：update 只改参数，无拼接接缝） */
  private arrowInput: ArrowPaintInput;
  private arrow: Konva.Shape;
  /** 关系描述（edge.label，画在曲线中点）：底牌用 destination-out 镂空线杆，
   *  完全遮住身后的线，同时保留背景点阵/方格透视（视觉上与背景无缝衔接） */
  private labelGroup: Konva.Group;
  private labelErase: Konva.Rect;
  private labelText: Konva.Text;

  constructor(private palette: Palette) {
    this.group = new Konva.Group({ listening: false });
    this.arrowInput = { pts: [], sw: 2, head: 'none', tail: 'none', color: '#000', bg: '#fff' };
    this.arrow = arrowPaintShape(() => this.arrowInput);
    this.labelGroup = new Konva.Group({ listening: false });
    this.labelErase = new Konva.Rect({
      fill: '#000',
      cornerRadius: 5,
      globalCompositeOperation: 'destination-out',
      listening: false,
    });
    this.labelText = new Konva.Text({
      fontSize: 13,
      fontFamily: 'system-ui, sans-serif',
      padding: 4,
      listening: false,
    });
    this.labelGroup.add(this.labelErase);
    this.labelGroup.add(this.labelText);
    this.group.add(this.arrow);
    this.group.add(this.labelGroup);
  }

  update(edge: CanvasEdge, from: Rect | null, to: Rect | null): void {
    if (!from || !to) {
      this.group.visible(false);
      return;
    }
    this.group.visible(true);
    const color = resolveColor(edge.color, this.palette) ?? (edge.kind === 'mindmap' ? this.palette.accent : this.palette.edge);
    this.arrowInput.color = color;
    this.arrowInput.bg = this.palette.canvasBg;

    if (edge.kind === 'mindmap') {
      // 导图分支线：三次贝塞尔（Konva Line 默认是折线模式，必须开 bezier 才把
      // 8 个数字识别为 起点/控制点1/控制点2/终点），无箭头
      const [p0, c1, c2, p1] = mindmapEdgeCurve(from, to).path;
      this.arrowInput.bezier = [p0.x, p0.y, c1.x, c1.y, c2.x, c2.y, p1.x, p1.y];
      this.arrowInput.head = 'none';
      this.arrowInput.tail = 'none';
      this.arrowInput.sw = 1.6;
      this.arrow.opacity(0.85);
      this.updateLabel(cubicMidpoint(this.arrowInput.bezier), edge.label);
      return;
    }

    const sides = inferSides(from, to);
    const fromSide = edge.fromSide ?? sides.fromSide;
    const toSide = edge.toSide ?? sides.toSide;
    const a = sideAnchor(from, fromSide);
    const b = sideAnchor(to, toSide);
    const { path } = bezierPath(a, fromSide, b, toSide);
    // 线杆与箭头头在同一个绘制里完成：头完全盖住按端点回缩的杆端
    this.arrowInput.bezier = path.flatMap((p) => [p.x, p.y]);
    this.arrowInput.pts = [a, b];
    this.arrowInput.head = 'solid';
    this.arrowInput.tail = 'none';
    this.arrowInput.sw = 2;
    this.arrow.opacity(1);
    this.updateLabel(cubicMidpoint(path.flatMap((p) => [p.x, p.y])), edge.label);
  }

  /** 关系描述：曲线中点上镂空底牌 + 文字；无 label 时隐藏 */
  private updateLabel(mid: { x: number; y: number }, label?: string): void {
    const text = (label ?? '').trim();
    this.labelGroup.visible(!!text);
    if (!text) return;
    this.labelGroup.position({ x: mid.x, y: mid.y });
    this.labelText.text(text);
    this.labelText.fill(this.palette.text);
    const w = this.labelText.width();
    const h = this.labelText.height();
    // 底牌矩形居中于文字盒（含 padding），destination-out 镂空身后的线杆
    this.labelErase.setAttrs({ x: -w / 2, y: -h / 2, width: w, height: h });
    this.labelText.position({ x: -w / 2, y: -h / 2 });
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