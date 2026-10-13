import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import * as zh from 'blockly/msg/zh-hans';
import type { Expression } from '../shared/model';
Blockly.setLocale(Object.fromEntries(Object.entries(zh).filter(([, value]) => typeof value === 'string')) as Record<string, string>);
if (!Blockly.Blocks.mod_field) Blockly.defineBlocksWithJsonArray([
  { type: 'mod_field', message0: '读取字段 %1', args0: [{ type: 'field_input', name: 'NAME', text: 'quantity' }], output: 'Number', colour: '#5f92cc', tooltip: '从上一个模块的输出读取数字字段' },
  { type: 'mod_number', message0: '数字 %1', args0: [{ type: 'field_number', name: 'VALUE', value: 1 }], output: 'Number', colour: '#5f92cc' },
  { type: 'mod_math', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'field_dropdown', name: 'OP', options: [['×', '*'], ['+', '+'], ['−', '-'], ['÷', '/']] }, { type: 'input_value', name: 'B', check: 'Number' }], inputsInline: true, output: 'Number', colour: '#8263d2' },
  { type: 'mod_output', message0: '输出计算结果 %1', args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }], colour: '#479984', tooltip: '该值会写入模块配置的输出字段' },
]);
function serialize(e: Expression): any {
  if (e.kind === 'field') return { type: 'mod_field', fields: { NAME: e.name } };
  if (e.kind === 'number') return { type: 'mod_number', fields: { VALUE: e.value } };
  return { type: 'mod_math', fields: { OP: e.op }, inputs: { A: { block: serialize(e.left) }, B: { block: serialize(e.right) } } };
}
function read(block: Blockly.Block | null, depth = 0): Expression {
  if (!block || depth > 12) throw new Error('请连接完整的计算积木（最多 12 层）');
  if (block.type === 'mod_field') { const name = block.getFieldValue('NAME'); if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name)) throw new Error('字段名只能包含字母、数字和下划线'); return { kind: 'field', name }; }
  if (block.type === 'mod_number') return { kind: 'number', value: Number(block.getFieldValue('VALUE')) };
  if (block.type === 'mod_math') return { kind: 'math', op: block.getFieldValue('OP'), left: read(block.getInputTargetBlock('A'), depth + 1), right: read(block.getInputTargetBlock('B'), depth + 1) };
  throw new Error('不支持的积木');
}
export function BlockEditor({ expression, onChange }: { expression: Expression; onChange: (value: Expression | null, error?: string) => void }) {
  const container = useRef<HTMLDivElement>(null); const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    if (!container.current) return;
    const workspace = Blockly.inject(container.current, { toolbox: { kind: 'flyoutToolbox', contents: [{ kind: 'block', type: 'mod_field' }, { kind: 'block', type: 'mod_number' }, { kind: 'block', type: 'mod_math' }] }, grid: { spacing: 24, length: 2, colour: '#e0e3ed', snap: true }, zoom: { controls: true, startScale: 0.9 }, trashcan: true, move: { scrollbars: true, drag: true, wheel: true } });
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{ type: 'mod_output', x: 40, y: 80, deletable: false, inputs: { VALUE: { block: serialize(expression) } } }] } }, workspace);
    workspace.addChangeListener(event => { if (event.isUiEvent) return; try { const roots = workspace.getTopBlocks(false).filter(b => b.type === 'mod_output'); if (roots.length !== 1) throw new Error('需要一个输出积木'); callback.current(read(roots[0].getInputTargetBlock('VALUE'))); } catch (e) { callback.current(null, (e as Error).message); } });
    const observer = new ResizeObserver(() => Blockly.svgResize(workspace)); observer.observe(container.current);
    return () => { observer.disconnect(); workspace.dispose(); };
  }, []);
  return <div className="blockly-host" ref={container} />;
}
