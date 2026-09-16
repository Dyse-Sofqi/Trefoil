import { describe, expect, it } from 'vitest';
import { createEmptyDocJson, parseDoc, serializeDoc } from '../src/data/jsonCanvas';
import type { CanvasDoc } from '../src/core/types';

describe('JSON Canvas 序列化', () => {
  it('空文档 roundtrip', () => {
    const json = createEmptyDocJson();
    const doc = parseDoc(json);
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(JSON.parse(serializeDoc(doc))).toEqual({ nodes: [], edges: [] });
  });

  it('标准 text 节点 roundtrip 保留字段', () => {
    const doc: CanvasDoc = {
      nodes: [{ id: 'n1', type: 'text', x: 10, y: 20, width: 200, height: 60, text: 'hello **world**', color: '1' }],
      edges: [],
    };
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes[0]).toMatchObject({ id: 'n1', type: 'text', x: 10, y: 20, text: 'hello **world**', color: '1' });
  });

  it('扩展字段使用 trefoil: 前缀', () => {
    const doc: CanvasDoc = {
      nodes: [{ id: 's1', type: 'trefoil/shape', x: 0, y: 0, width: 50, height: 50, shape: 'rect', fill: '#ff0000', strokeSize: 3 }],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0]['trefoil:shape']).toBe('rect');
    expect(raw.nodes[0]['trefoil:fill']).toBe('#ff0000');
    expect(raw.nodes[0]['trefoil:strokeSize']).toBe(3);
    expect(raw.nodes[0].shape).toBeUndefined();
  });

  it('容器子节点存储为相对坐标，解析还原为绝对坐标', () => {
    const doc: CanvasDoc = {
      nodes: [
        { id: 'c1', type: 'trefoil/container', x: 100, y: 100, width: 400, height: 300 },
        { id: 'k1', type: 'text', x: 150, y: 160, width: 100, height: 36, text: '子', containerId: 'c1' },
      ],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    const k = raw.nodes.find((n: Record<string, unknown>) => n.id === 'k1');
    expect(k.x).toBe(50); // 150 - 100
    expect(k.y).toBe(60);
    expect(k['trefoil:containerId']).toBe('c1');

    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes.find((n) => n.id === 'k1')).toMatchObject({ x: 150, y: 160 });
  });

  it('孤儿子节点（容器缺失）还原为自由节点', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'k', type: 'text', x: 5, y: 5, width: 10, height: 10, 'trefoil:containerId': 'missing' },
      ],
      edges: [],
    });
    const parsed = parseDoc(json);
    expect(parsed.nodes[0].containerId).toBeNull();
  });

  it('未知节点类型按规范保留', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'x', type: 'some/unknown', x: 1, y: 2, width: 3, height: 4, 'custom:field': 1 }],
      edges: [],
    });
    const parsed = parseDoc(json);
    expect(parsed.nodes[0].type).toBe('some/unknown');
    const raw = JSON.parse(serializeDoc(parsed));
    expect(raw.nodes[0].type).toBe('some/unknown');
  });

  it('file 节点 roundtrip（标准 file 字段 + trefoil:fileSize 扩展）', () => {
    const doc: CanvasDoc = {
      nodes: [
        {
          id: 'f1',
          type: 'file',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
          file: 'attachments/Pasted image 20250101120000.png',
          fileSize: [640, 480],
        },
      ],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0].file).toBe('attachments/Pasted image 20250101120000.png');
    expect(raw.nodes[0]['trefoil:fileSize']).toEqual([640, 480]);

    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes[0]).toMatchObject({
      type: 'file',
      file: 'attachments/Pasted image 20250101120000.png',
      fileSize: [640, 480],
    });
  });

  it('缺失 file 字段的 file 节点不写 file', () => {
    const doc: CanvasDoc = {
      nodes: [{ id: 'f1', type: 'file', x: 0, y: 0, width: 10, height: 10 }],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0].file).toBeUndefined();
  });

  it('损坏 JSON 容错', () => {
    expect(parseDoc('not json')).toEqual({ nodes: [], edges: [] });
    expect(parseDoc('null')).toEqual({ nodes: [], edges: [] });
  });

  it('文本框实体边框字段经 trefoil: 前缀往返保留', () => {
    const doc: CanvasDoc = {
      nodes: [
        {
          id: 't1',
          type: 'text',
          x: 10,
          y: 20,
          width: 120,
          height: 40,
          text: '带边框',
          border: true,
          borderStyle: 'dashed',
          stroke: '#ff0000',
          strokeSize: 3,
          borderRadius: 8,
          fill: '#ffffff',
        },
        { id: 't2', type: 'text', x: 0, y: 0, width: 100, height: 30, text: '无边框', border: false },
      ],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0]['trefoil:border']).toBe(true);
    expect(raw.nodes[0]['trefoil:borderStyle']).toBe('dashed');
    expect(raw.nodes[0]['trefoil:borderRadius']).toBe(8);
    expect(raw.nodes[0]['trefoil:fill']).toBe('#ffffff');

    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes[0]).toMatchObject({
      border: true,
      borderStyle: 'dashed',
      stroke: '#ff0000',
      strokeSize: 3,
      borderRadius: 8,
      fill: '#ffffff',
    });
    // border: false 不落盘（序列化跳过 falsy），读回即为关闭
    expect(parsed.nodes[1]?.border).toBeFalsy();
    expect(parsed.nodes[1]?.stroke).toBeUndefined();
  });

  it('文本框无填充时 fill 不落盘（borderStyle 关边框后保留）', () => {
    const doc: CanvasDoc = {
      nodes: [
        { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 'x', fill: null },
        { id: 't2', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 'y', border: true, borderStyle: 'solid', fill: '3' },
      ],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0]['trefoil:fill']).toBeUndefined();
    // 预设色编号原样写出；线型为合法字符串照常落盘（关边框后参数保留，重开即还原）
    expect(raw.nodes[1]['trefoil:fill']).toBe('3');
    expect(raw.nodes[1]['trefoil:borderStyle']).toBe('solid');
  });

  it('文本框预设色边框原样写出', () => {
    const doc: CanvasDoc = {
      nodes: [{ id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 'x', border: true, stroke: '5' }],
      edges: [],
    };
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes[0]?.stroke).toBe('5');
  });

  it('容器背景色 / 背景透明度 / 圆角往返保留（fillOpacity = 0 也要落盘）', () => {
    const doc: CanvasDoc = {
      nodes: [
        { id: 'c1', type: 'trefoil/container', x: 0, y: 0, width: 300, height: 200, text: '组', fill: '#4c8dff', fillOpacity: 0.35, borderRadius: 24 },
        // 0 是「全透明」这一合法取值，不能被序列化的 falsy 过滤吃掉
        { id: 'c2', type: 'trefoil/container', x: 0, y: 0, width: 100, height: 100, fill: '3', fillOpacity: 0 },
      ],
      edges: [],
    };
    const raw = JSON.parse(serializeDoc(doc));
    expect(raw.nodes[0]['trefoil:fill']).toBe('#4c8dff');
    expect(raw.nodes[0]['trefoil:fillOpacity']).toBe(0.35);
    expect(raw.nodes[0]['trefoil:borderRadius']).toBe(24);
    expect(raw.nodes[1]['trefoil:fillOpacity']).toBe(0);

    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes[0]).toMatchObject({ fill: '#4c8dff', fillOpacity: 0.35, borderRadius: 24 });
    expect(parsed.nodes[1]).toMatchObject({ fill: '3', fillOpacity: 0 });
  });
});
