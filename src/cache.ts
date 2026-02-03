/**
 * MoltShield Cache Module
 *
 * LRU caches for text evaluations, image evaluations, and exchange classifications.
 * All caches use SHA-256 hashing for collision resistance.
 */

import * as crypto from "crypto";
import type { EvaluationResult, ImageEvaluationResult, ExchangeEvaluationResult } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const TEXT_CACHE_MAX_SIZE = 1000;
const TEXT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const IMAGE_CACHE_MAX_SIZE = 500;
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (images don't change)

const EXCHANGE_CACHE_MAX_SIZE = 500;
const EXCHANGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Shared Hashing
// ============================================================================

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ============================================================================
// Text Cache
// ============================================================================

interface TextCacheEntry {
  result: EvaluationResult;
  timestamp: number;
}

const textCache = new Map<string, TextCacheEntry>();

export function getFromCache(content: string): EvaluationResult | null {
  const key = sha256(content);
  const entry = textCache.get(key);

  if (!entry) return null;

  if (Date.now() - entry.timestamp > TEXT_CACHE_TTL_MS) {
    textCache.delete(key);
    return null;
  }

  return { ...entry.result, cached: true };
}

export function setCache(content: string, result: EvaluationResult): void {
  if (textCache.size >= TEXT_CACHE_MAX_SIZE) {
    const oldestKey = textCache.keys().next().value;
    if (oldestKey) textCache.delete(oldestKey);
  }

  textCache.set(sha256(content), {
    result,
    timestamp: Date.now(),
  });
}

export function clearCache(): void {
  textCache.clear();
}

// ============================================================================
// Image Cache
// ============================================================================

interface ImageCacheEntry {
  result: ImageEvaluationResult;
  timestamp: number;
}

const imageCache = new Map<string, ImageCacheEntry>();

export function getImageFromCache(imageData: string): ImageEvaluationResult | null {
  const key = `img_${sha256(imageData)}`;
  const entry = imageCache.get(key);

  if (!entry) return null;

  if (Date.now() - entry.timestamp > IMAGE_CACHE_TTL_MS) {
    imageCache.delete(key);
    return null;
  }

  return { ...entry.result, cached: true };
}

export function setImageCache(imageData: string, result: ImageEvaluationResult): void {
  if (imageCache.size >= IMAGE_CACHE_MAX_SIZE) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) imageCache.delete(oldestKey);
  }

  imageCache.set(`img_${sha256(imageData)}`, {
    result,
    timestamp: Date.now(),
  });
}

export function clearImageCache(): void {
  imageCache.clear();
}

// ============================================================================
// Exchange Cache
// ============================================================================

interface ExchangeCacheEntry {
  result: ExchangeEvaluationResult;
  timestamp: number;
}

const exchangeCache = new Map<string, ExchangeCacheEntry>();

export function getExchangeFromCache(context: string, response: string): ExchangeEvaluationResult | null {
  const key = `ex_${sha256(context + "|||" + response).slice(0, 32)}`;
  const cached = exchangeCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.timestamp > EXCHANGE_CACHE_TTL_MS) {
    exchangeCache.delete(key);
    return null;
  }

  return { ...cached.result, cached: true };
}

export function setExchangeCache(context: string, response: string, result: ExchangeEvaluationResult): void {
  const key = `ex_${sha256(context + "|||" + response).slice(0, 32)}`;

  if (exchangeCache.size >= EXCHANGE_CACHE_MAX_SIZE) {
    const oldestKey = exchangeCache.keys().next().value;
    if (oldestKey) exchangeCache.delete(oldestKey);
  }

  exchangeCache.set(key, { result, timestamp: Date.now() });
}

export function clearExchangeCache(): void {
  exchangeCache.clear();
}

// ============================================================================
// Clear All Caches
// ============================================================================

export function clearAllCaches(): void {
  clearCache();
  clearImageCache();
  clearExchangeCache();
}
