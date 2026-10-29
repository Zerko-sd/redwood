import { z } from "zod";

export const SPEC_SCHEMA_VERSION = 1;

/** Stable IDs: `<kind>:<slug>`. References use IDs, so renames never break links. */
const id = (kind: string) =>
  z.string().regex(new RegExp(`^${kind}:[a-z0-9][a-z0-9-]*$`), `expected "${kind}:<slug>"`);

export const roleId = id("role");
export const storyId = id("story");
export const entityId = id("entity");
export const fieldId = id("field");
export const screenId = id("screen");
export const endpointId = id("endpoint");
export const serviceId = id("service");

/** Where a decided value came from. Every AI/rule/human decision carries this. */
export const provenance = z.object({
  source: z.enum(["rule", "ai", "human"]),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  inputHash: z.string().optional(),
  storyRefs: z.array(storyId).default([]),
  degraded: z.boolean().default(false),
  acceptedBy: z.string().optional(),
  at: z.string().optional(),
});
export type Provenance = z.infer<typeof provenance>;

export const FIELD_TYPES = [
  "text", "longtext", "number", "money", "date", "datetime", "boolean",
  "choice", "email", "phone", "file", "image", "reference",
] as const;

export const role = z.object({
  id: roleId,
  name: z.string().min(1),
  description: z.string().default(""),
});

export const story = z.object({
  id: storyId,
  role: roleId,
  action: z.string().min(1),
  reason: z.string().default(""),
  acceptance: z.array(z.string()).default([]),
  priority: z.enum(["must", "should", "could"]).default("should"),
  status: z.enum(["draft", "accepted", "built"]).default("accepted"),
  /** "draft" origin means extracted from a free-text PRD and awaiting a person. */
  origin: z.enum(["human", "prd-draft"]).default("human"),
  tags: z.array(z.string()).default([]),
});

export const field = z.object({
  id: fieldId,
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** For type "choice": the closed set of values. */
  options: z.array(z.string()).optional(),
  /** For type "reference": the target entity. */
  references: entityId.optional(),
  provenance: provenance.optional(),
});

export const relationship = z.object({
  kind: z.enum(["one-to-many", "many-to-many"]),
  to: entityId,
  name: z.string().min(1),
});

export const entity = z.object({
  id: entityId,
  name: z.string().min(1),
  fields: z.array(field).default([]),
  relationships: z.array(relationship).default([]),
  /** Workflow: a closed set of states and the transitions allowed between them. */
  workflow: z
    .object({
      field: z.string().min(1),
      states: z.array(z.string()).min(1),
      transitions: z.array(
        z.object({ from: z.string(), to: z.string(), roles: z.array(roleId).min(1) }),
      ),
    })
    .optional(),
  /** Demo rows, keyed by field ID so renaming a field never breaks them. */
  seed: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).default([]),
  provenance: provenance.optional(),
});

export const OPERATIONS = ["list", "read", "create", "update", "delete"] as const;

export const endpoint = z.object({
  id: endpointId,
  entity: entityId,
  operation: z.enum([...OPERATIONS, "custom"]),
  /** Required when operation is "custom". */
  action: z.string().optional(),
  guards: z.array(z.string()).default([]),
  provenance: provenance.optional(),
});

export const screen = z.object({
  id: screenId,
  title: z.string().min(1),
  path: z.string().startsWith("/"),
  entity: entityId.optional(),
  stories: z.array(storyId).default([]),
  endpoints: z.array(endpointId).default([]),
  /**
   * The page shape, picked from the generator's closed list of layouts. Blank means "infer it".
   * Kept as a plain string so adding a layout never changes this schema; `checkRegistries` in the
   * generator is what refuses a name that has no implementation.
   */
  layout: z.string().optional(),
  /** Extra blocks this screen needs (`live-map`). One Redwood has no template for becomes a developer file and a placeholder. */
  blocks: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/, "block names are lowercase-kebab")).default([]),
  /** Bento answers: question id -> answer, each "yes" citing stories. */
  bento: z
    .record(z.object({ answer: z.boolean(), because: z.array(storyId).default([]), provenance: provenance.optional() }))
    .default({}),
  roles: z.array(roleId).default([]),
});

export const service = z.object({
  id: serviceId,
  name: z.string().min(1),
  kind: z.enum(["email", "notification", "job", "storage", "audit", "integration"]),
  /** Names of secrets the app expects at runtime. Values are never stored in the spec. */
  secrets: z.array(z.string()).default([]),
});

export const accessRule = z.object({
  role: roleId,
  entity: entityId,
  operations: z.array(z.enum(OPERATIONS)),
  /** Row-level: restrict to rows where this field equals the signed-in user. */
  ownerField: z.string().optional(),
  hiddenFields: z.array(z.string()).default([]),
});

export const theme = z.object({
  kit: z.string().default("shadcn"),
  kitVersion: z.string().optional(),
  preset: z.string().default("default"),
  tokens: z.record(z.string()).default({}),
});

export const spec = z.object({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  title: z.string().min(1),
  tenancy: z.enum(["single", "multi"]).default("single"),
  roles: z.array(role).default([]),
  stories: z.array(story).default([]),
  entities: z.array(entity).default([]),
  screens: z.array(screen).default([]),
  endpoints: z.array(endpoint).default([]),
  services: z.array(service).default([]),
  /** Deny by default: anything not granted here is forbidden. */
  access: z.array(accessRule).default([]),
  theme: theme.default({}),
});

export type Spec = z.infer<typeof spec>;
export type Entity = z.infer<typeof entity>;
export type Field = z.infer<typeof field>;
export type Story = z.infer<typeof story>;
export type Screen = z.infer<typeof screen>;
