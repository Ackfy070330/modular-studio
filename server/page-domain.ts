import { z } from 'zod';
const field = z.string().regex(/^(?:[a-zA-Z_][a-zA-Z0-9_]{0,63})?$/).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s));
const color = z.string().regex(/^(#[a-fA-F0-9]{6}|transparent)$/);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const pageSchema = z.object({
  projectType: z.enum(['landing', 'dashboard', 'website']), width: z.number().int().min(320).max(1920), height: z.number().int().min(400).max(4000), background: color,
  blocks: z.array(z.object({
    id, kind: z.enum(['section','heading','text','button','input','image','card','stat','table','list','nav','divider','progress']),
    x: z.number().finite().min(0).max(1920), y: z.number().finite().min(0).max(4000), width: z.number().finite().min(24).max(1920), height: z.number().finite().min(24).max(4000),
    text: z.string().max(2000), color, background: color, fontSize: z.number().min(10).max(96), radius: z.number().min(0).max(100),
    field, inputType: z.enum(['text','number']), binding: field, imageUrl: z.string().max(2000).refine(s => { if (!s) return true; try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, '图片地址必须为 HTTPS'),
    action: z.enum(['none','run','scroll','toggle']), target: z.string().max(80), animation: z.enum(['none','fade','slide','hover']), hidden: z.boolean(),
  })).max(100),
}).superRefine((page, ctx) => {
  const ids = new Set<string>(), inputs = new Set<string>();
  for (const block of page.blocks) {
    if (ids.has(block.id)) ctx.addIssue({ code: 'custom', message: '页面组件 ID 不能重复' }); ids.add(block.id);
    if (block.x + block.width > page.width + 0.1 || block.y + block.height > page.height + 0.1) ctx.addIssue({ code: 'custom', message: `组件「${block.text.slice(0, 20)}」超出画布，请调整位置或页面尺寸` });
    if (block.kind === 'input') { if (!block.field || inputs.has(block.field)) ctx.addIssue({ code: 'custom', message: '输入框字段不能为空或重复' }); inputs.add(block.field); }
    if (['scroll','toggle'].includes(block.action) && !page.blocks.some(b => b.id === block.target && b.id !== block.id)) ctx.addIssue({ code: 'custom', message: '页面事件需要选择存在的其他目标组件' });
  }
});
