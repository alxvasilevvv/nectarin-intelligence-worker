/**
 * Minimal JSON-Schema validator for tool inputs (Cloudflare Workers edition).
 *
 * We deliberately avoid a full Ajv-style dependency: the tool `inputSchema`s in
 * this server use a small, well-known subset of JSON Schema (object root,
 * typed properties, enum, required, minimum/exclusiveMinimum,
 * additionalProperties:false). This validator covers exactly that subset and
 * returns helpful, user-facing messages so the JSON-RPC layer can answer with
 * `-32602 Invalid params`.
 *
 * It is intentionally permissive about unknown keywords (ignored) and strict
 * about the keywords it does understand.
 */

import type { JsonSchema } from "./tools.js";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface PropSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  description?: string;
  default?: unknown;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v: unknown, type: PropSchema["type"]): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return typeOf(v) === "object";
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}

/**
 * Validate `input` against a tool `inputSchema`. Returns all collected errors.
 */
export function validateInput(input: unknown, schema: JsonSchema): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeOf(input) !== "object") {
    return { valid: false, errors: [{ path: "(root)", message: "Arguments must be an object." }] };
  }
  const obj = input as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, PropSchema>;
  const required = schema.required ?? [];

  // Required.
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) {
      errors.push({ path: key, message: `Missing required property '${key}'.` });
    }
  }

  // additionalProperties: false → reject unknown keys.
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        errors.push({
          path: key,
          message: `Unexpected property '${key}'. Allowed: ${Object.keys(props).join(", ") || "(none)"}.`,
        });
      }
    }
  }

  // Per-property checks (only for provided values).
  for (const [key, raw] of Object.entries(props)) {
    const value = obj[key];
    if (value === undefined || value === null) continue; // presence handled by 'required'
    const ps = raw as PropSchema;

    if (ps.type && !matchesType(value, ps.type)) {
      errors.push({
        path: key,
        message: `Property '${key}' must be of type ${ps.type}, got ${typeOf(value)}.`,
      });
      continue; // further numeric/enum checks would be noise on a type mismatch
    }

    if (ps.enum && !ps.enum.some((e) => e === value)) {
      errors.push({
        path: key,
        message: `Property '${key}' must be one of: ${ps.enum.map((e) => JSON.stringify(e)).join(", ")}.`,
      });
    }

    if (typeof value === "number") {
      if (ps.minimum !== undefined && value < ps.minimum) {
        errors.push({ path: key, message: `Property '${key}' must be >= ${ps.minimum}.` });
      }
      if (ps.exclusiveMinimum !== undefined && value <= ps.exclusiveMinimum) {
        errors.push({ path: key, message: `Property '${key}' must be > ${ps.exclusiveMinimum}.` });
      }
      if (ps.maximum !== undefined && value > ps.maximum) {
        errors.push({ path: key, message: `Property '${key}' must be <= ${ps.maximum}.` });
      }
      if (ps.exclusiveMaximum !== undefined && value >= ps.exclusiveMaximum) {
        errors.push({ path: key, message: `Property '${key}' must be < ${ps.exclusiveMaximum}.` });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Format a ValidationResult into a single helpful message string. */
export function formatErrors(result: ValidationResult): string {
  return result.errors.map((e) => e.message).join(" ");
}
