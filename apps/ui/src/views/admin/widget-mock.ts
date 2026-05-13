/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Deterministic mock-data generators for the LayerDashboards admin
 * widget-editor canvas. The admin canvas previews widgets without
 * running real MQE — operators are designing the layout, not browsing
 * live data, so feeding the chart wrappers fabricated-but-plausible
 * shapes lets the canvas approximate the runtime look without a BFF
 * round-trip per keystroke.
 *
 * Seeded off widget.id so a single widget's preview stays stable as
 * the operator tweaks its config — flipping span / rowSpan shouldn't
 * jiggle the mock series under their cursor.
 */

import type { DashboardRecordItem, DashboardTopItem, DashboardWidget } from '@skywalking-horizon-ui/api-client';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth-ish random walk anchored around `center`, scaled by `amp`. */
function walk(rand: () => number, n: number, center: number, amp: number): number[] {
  const out: number[] = [];
  let v = center;
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.5) * amp * 0.4;
    // Soft pull back to center so long walks don't drift off.
    v += (center - v) * 0.08;
    out.push(Math.max(0, v));
  }
  return out;
}

export interface MockLineSeries {
  label: string;
  data: number[];
  yAxisIndex?: number;
  unit?: string;
}

/** Build N labelled series for a `line` widget preview. */
export function mockLineSeries(widget: DashboardWidget, points = 40): MockLineSeries[] {
  const rand = mulberry32(hashSeed(widget.id || widget.title || 'w'));
  const labels = widget.expressionLabels ?? widget.expressions.map((_, i) => `series ${i + 1}`);
  const units = widget.expressionUnits ?? [];
  const axes = widget.expressionAxes ?? [];
  // Pick a plausible center/amp profile from the unit hint so the
  // mock looks like a real metric. Percentage = small range,
  // latency = mid range, rpm = big range. Falls back to a generic
  // 80 ± 30 walk.
  function profile(unit: string | undefined): { center: number; amp: number } {
    if (!unit) return { center: 80 + rand() * 60, amp: 35 };
    if (unit.includes('%')) return { center: 95 + rand() * 4, amp: 5 };
    if (unit === 'ms') return { center: 80 + rand() * 220, amp: 60 };
    if (unit === 'rpm' || unit.includes('/min')) return { center: 1200 + rand() * 6000, amp: 800 };
    return { center: 80 + rand() * 60, amp: 35 };
  }
  return labels.map((label, i) => {
    const unit = units[i] ?? widget.unit;
    const { center, amp } = profile(unit);
    return {
      label,
      data: walk(rand, points, center, amp),
      yAxisIndex: axes[i] ?? 0,
      unit,
    };
  });
}

/** Build a scalar value for a `card` widget preview. */
export function mockCardValue(widget: DashboardWidget): number {
  const rand = mulberry32(hashSeed(widget.id || widget.title || 'w'));
  const unit = widget.unit;
  if (unit?.includes('%')) return 92 + rand() * 7;
  if (unit === 'ms') return 40 + rand() * 240;
  if (unit === 'rpm') return 800 + rand() * 9000;
  return 100 + rand() * 900;
}

/** Build one or more sorted lists for a `top` widget preview. Returns
 *  `groups` when the widget has multiple expressions (tabs visible). */
export function mockTopGroups(
  widget: DashboardWidget,
  rows = 8,
): Array<{ label: string; expression?: string; unit?: string; items: DashboardTopItem[] }> {
  const rand = mulberry32(hashSeed(widget.id || widget.title || 'w'));
  const labels = widget.expressionLabels ?? widget.expressions.map((_, i) => `Tab ${i + 1}`);
  const units = widget.expressionUnits ?? [];
  return widget.expressions.map((expr, gi) => {
    const unit = units[gi] ?? widget.unit;
    const baseline =
      unit?.includes('%') ? 99 :
      unit === 'ms' ? 220 :
      unit === 'rpm' ? 5000 :
      400;
    const items: DashboardTopItem[] = [];
    for (let i = 0; i < rows; i++) {
      const decay = Math.pow(0.82, i);
      const jitter = (rand() - 0.5) * 0.15;
      items.push({
        name: mockName(rand, gi, i),
        value: Math.max(0, baseline * decay * (1 + jitter)),
      });
    }
    return { label: labels[gi] ?? `Tab ${gi + 1}`, expression: expr, unit, items };
  });
}

/** Build N mock RECORD rows for a `record` widget preview. Picks
 *  statement-shaped names when the widget references a SQL-flavored
 *  MQE (top_n(top_sql_database_statement, …)); otherwise reuses the
 *  service / endpoint name pool. */
export function mockRecordRows(widget: DashboardWidget, rows = 6): DashboardRecordItem[] {
  const rand = mulberry32(hashSeed(widget.id || widget.title || 'r'));
  const looksLikeSlowSql = /sql|statement|database/i.test(widget.expressions.join(' '));
  const baseline =
    widget.unit?.includes('%') ? 99 :
    widget.unit === 'ms' ? 280 :
    widget.unit === 'rpm' ? 1200 :
    180;
  const out: DashboardRecordItem[] = [];
  for (let i = 0; i < rows; i++) {
    const decay = Math.pow(0.78, i);
    const jitter = (rand() - 0.5) * 0.2;
    out.push({
      name: looksLikeSlowSql ? mockSql(rand, i) : mockName(rand, 0, i),
      value: Math.max(0, baseline * decay * (1 + jitter)),
    });
  }
  return out;
}

const SQL_TEMPLATES = [
  'SELECT * FROM orders WHERE user_id = ? AND status = ?',
  'UPDATE inventory SET qty = qty - ? WHERE sku = ?',
  'SELECT id, name FROM users WHERE email = ?',
  "INSERT INTO audit_log (actor, action, payload) VALUES (?, ?, ?)",
  'DELETE FROM sessions WHERE expires_at < ?',
  'SELECT count(*) FROM events WHERE topic = ? AND ts > ?',
  'SELECT o.id, sum(p.amount) FROM orders o JOIN payments p ON p.order_id = o.id GROUP BY o.id',
];
function mockSql(rand: () => number, idx: number): string {
  // Cycle through a fixed set so the preview reads as recognisable SQL
  // even at small widget sizes. The pinch of randomness keeps two
  // adjacent widgets from drawing the identical first row.
  const pick = (idx + Math.floor(rand() * 2)) % SQL_TEMPLATES.length;
  return SQL_TEMPLATES[pick];
}

const NAME_PARTS_A = ['order', 'checkout', 'cart', 'payment', 'auth', 'user', 'catalog', 'search', 'inventory', 'shipping'];
const NAME_PARTS_B = ['svc', 'api', 'gateway', 'worker', 'proxy'];
function mockName(rand: () => number, group: number, idx: number): string {
  const a = NAME_PARTS_A[(group * 3 + idx) % NAME_PARTS_A.length];
  const b = NAME_PARTS_B[(idx + group) % NAME_PARTS_B.length];
  // A pinch of randomness so two widgets don't draw identical names.
  return rand() > 0.5 ? `${a}-${b}` : `${a}-${b}-${idx + 1}`;
}
