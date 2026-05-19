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
 * Read a CSS custom property off `<html>` at runtime — used by chart
 * libraries (ECharts canvas-rendered series, etc.) that can't consume
 * `var(--…)` strings directly and need a resolved hex/color string.
 *
 * Examples:
 *   readCssVar('--sw-accent')         // active theme's accent hex
 *   readCssVar('--sw-fg-2', '#888')   // muted fg, with fallback
 *
 * Resolved at call time, so callers that need to track theme changes
 * should re-read on every render (or wire a reactive `useThemeStore`
 * subscription if updates need to be reactive across an ECharts
 * instance — that's a per-call decision).
 */
export function readCssVar(name: string, fallback = ''): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  if (!name.startsWith('--')) name = `--${name}`;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Convenience: the current theme's accent color, with a safe hex
 *  fallback so chart-init paths that race ahead of the stylesheet
 *  load don't get an empty string. */
export function readAccent(fallback = '#f97316'): string {
  return readCssVar('--sw-accent', fallback);
}
