---
name: invoice-extractor
description: Extract structured line items, totals, and tax from PDF or image invoices into JSON. Use when the user uploads an invoice, receipt, or bill, asks to "parse this invoice", "pull the totals", "数字化发票", or needs invoice data turned into a spreadsheet or accounting entry. Triggers on keywords invoice, receipt, bill, 发票, 报销, line items, VAT, tax total.
---

# Invoice Extractor

把发票/收据从 PDF 或图片转成结构化 JSON，覆盖逐行明细、税额、总计。

## 使用场景 (When to use)

- 用户上传一张发票/收据图片或 PDF，想要结构化数据。
- 用户说「parse this invoice」「把这张发票转成表格」「提取报销金额」。
- 下游需要把发票数据写入 Excel、记账系统或对账流程。

## 步骤

1. 识别文档类型（发票 / 收据 / 形式发票）。
2. 抽取字段：`vendor`、`date`、`currency`、`line_items[]`、`subtotal`、`tax`、`total`。
3. 对每个 `line_item` 抽取 `description`、`qty`、`unit_price`、`amount`。
4. 校验：`sum(line_items.amount) + tax == total`，不一致时标记 `"verified": false`。
5. 输出严格 JSON，金额保留 2 位小数。

## 输出格式

```json
{
  "vendor": "Acme Corp",
  "date": "2026-05-01",
  "currency": "USD",
  "line_items": [
    { "description": "Widget", "qty": 2, "unit_price": 9.99, "amount": 19.98 }
  ],
  "subtotal": 19.98,
  "tax": 1.60,
  "total": 21.58,
  "verified": true
}
```

## 反例 (Anti-patterns)

```text
✗ 把金额输出成字符串 "21.58 USD"（破坏下游计算）
✗ 漏掉 verified 字段（无法判断抽取是否可信）
✗ 把多页发票当成多张独立发票（应合并为一张）
```

## 边界情况

- 手写收据无法可靠抽取 → 返回 `"confidence": "low"` 并提示人工复核。
- 多币种发票 → 按行保留原始币种，不做汇率换算。
