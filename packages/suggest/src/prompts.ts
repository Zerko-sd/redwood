/**
 * Prompt builders, ported from the earlier Redwood (backend/app/ai/prompts.py). The prompt text is the
 * contract: it is hashed into each suggestion's provenance, and it is what makes "reuse an existing thing"
 * the model's default. Changing the wording changes both.
 *
 * Every prompt gives the model only what it needs and a closed list to choose from. The resolvers in
 * steps.ts then refuse anything outside that list.
 */

const list = (xs: readonly string[], none = "(none yet)") => (xs.length ? xs.join(", ") : none);

export function servicePrompt(a: { entity: string; action: string; services: string[]; kinds: readonly string[] }): string {
  return [
    `Endpoint: custom action "${a.action}" on ${a.entity}`,
    `Known services: ${list(a.services)}`,
    `Service kinds: ${a.kinds.join(", ")}`,
    "Does handling this endpoint require calling a backend service (business logic beyond a simple CRUD read/write against the database)? If yes, respond needsService true and, if one of the known services above clearly matches, its exact name, otherwise a short name for a new service, with its kind. If no service call is needed, respond needsService false with serviceName null.",
  ].join("\n\n");
}

export function entityPrompt(a: { story: string; role?: string; entities: string[]; paths: string[] }): string {
  return [
    "You are responsible for identifying the canonical domain entity for a user story.",
    "",
    ...(a.role ? ["Current Role:", `"${a.role}"`, ""] : []),
    "Current User Story:",
    `"${a.story}"`,
    "",
    "Existing Entities:",
    list(a.entities),
    "",
    "Determine the primary entity that this user story operates on.",
    "",
    "Rules:",
    "1. First check whether the user story refers to one of the existing entities.",
    "2. Reuse an existing entity whenever it represents the same domain concept.",
    "3. Create a new entity only if the story introduces a genuinely new domain concept.",
    "4. Entity names must be meaningful, canonical, singular nouns.",
    "5. Never use actions, verbs, CRUD operations, or UI actions as entity names.",
    '6. Do not generate names like "AddUser", "ManageUsers", "Addremove", or "UserManagement".',
    "7. Return only the entity name, with no explanation.",
    "8. The entity is the record the story's verb acts on. A record that belongs to an existing entity" +
      " (a client's feeds, an order's items) is its own entity, not its owner.",
    "9. Never answer with the current role (Admin, Super Admin, Manager) unless the story manages" +
      " the accounts of people in that role.",
    "10. A different kind of record is a new entity even when an existing one is loosely related:" +
      " an audit log, a notification recipient or a model version is not the entity it mentions.",
    "",
    "Examples:",
    '"Admin can add/remove users" -> User',
    '"Admin can deactivate a user" -> User',
    '"User can create a project" -> Project',
    '"User can delete a project" -> Project',
    '"Admin can approve payments" -> Payment',
    '"Admin can add a client\'s camera feeds" -> CameraFeed',
    '"Admin can see the audit log of changes to users" -> AuditLogEntry',
    "",
    "Also determine the screen path this story's UI lives at.",
    "",
    "Existing Paths:",
    list(a.paths),
    "",
    "Path rules:",
    '1. The path must start with "/".',
    '2. Use lowercase kebab-case segments separated by "/", e.g. "/license-keys".',
    "3. Name the path after the entity or screen, never after the action.",
    '4. Use the plural list path of the entity, e.g. "/camera-feeds", not nested under the entity it' +
      ' belongs to and without ":id": a record\'s own page is opened from its list.',
    "5. Reuse an existing path exactly when the story belongs to that same screen.",
    "6. Return only the path, with no explanation.",
  ].join("\n");
}

export function fieldsPrompt(a: {
  entity: string;
  stories: string[];
  otherEntities: string[];
  types: readonly string[];
}): string {
  return [
    "You are proposing fields (database columns) for ONE entity of a specification.",
    "",
    `Entity: "${a.entity}"`,
    "",
    `User stories already assigned to ${a.entity}:`,
    ...a.stories.map((s, i) => `${i + 1}. "${s}"`),
    "",
    `Other entities that exist: ${list(a.otherEntities, "(none)")}`,
    "",
    `Propose the fields ${a.entity} needs to store what these stories describe.`,
    "",
    "Rules:",
    `1. Every story above belongs to ${a.entity}. Do not reassign, regroup or classify them, and do not propose fields for any other entity.`,
    "2. Only propose a field a story genuinely implies storing - never invent unrelated fields.",
    '3. Field names are short plain labels in sentence case, e.g. "Plate number".',
    `4. Each field's type must be one of: ${a.types.join(", ")}.`,
    "5. Never propose id, created at, created by or deleted - those are added automatically.",
    "6. If nothing is implied, return an empty fields list.",
    "7. Prefer the most specific type: choice for a fixed set of options, including a lifecycle a record moves through" +
      " (e.g. scheduled, running, done); money for prices and totals; email or phone for contact details; date or datetime for times.",
    '8. For a choice field, list its allowed values in "options", in order; for a lifecycle, the first value is where a record starts' +
      " and the last normal value is where it ends.",
    '9. A field that points at a record of another entity has type reference and names that entity in "references", chosen only' +
      " from the other entities listed above.",
  ].join("\n");
}

export function operationsPrompt(a: {
  path: string;
  title: string;
  stories: { role: string; story: string }[];
  entity: string;
  fields: string[];
  operations: readonly string[];
}): string {
  return [
    `Screen: "${a.path}" - ${a.title}`,
    `User stories for this screen:\n${a.stories.map((s) => `- ${s.role || "someone"}: ${s.story}`).join("\n")}`,
    `Primary entity: "${a.entity}", fields: ${list(a.fields)}`,
    `Which operations on ${a.entity} does this screen need? Choose only from: ${a.operations.join(", ")}.`,
    "Decide from what the stories DO, not only what they show: if any story creates, takes, books, adds, edits, updates," +
      " removes, cancels, or marks records, the operations must include the ones that write. A screen is read-only only when" +
      " every story just views. Only propose operations genuinely implied by the stories.",
    "If a story needs an action that is not create, update or delete (assign, approve, send, import), list it in" +
      ' "customActions" as a short verb phrase, e.g. "Assign driver". Otherwise leave customActions empty.',
  ].join("\n\n");
}

export function rulesPrompt(a: {
  roles: string[];
  stories: { role: string; story: string }[];
  entities: { name: string; fields: { name: string; type: string; options?: string[] }[] }[];
}): string {
  const data = a.entities
    .map((e) => `- ${e.name}\n${e.fields.map((f) => `    - ${f.name} (${f.type})${f.options?.length ? ": " + f.options.join(", ") : ""}`).join("\n") || "    - (no fields)"}`)
    .join("\n");
  return [
    "You are deciding who may change what in an app, from its user stories. You never write code.",
    `Roles: ${a.roles.join(", ")}`,
    `User stories:\n${a.stories.map((s) => `- ${s.role || "someone"}: ${s.story}`).join("\n") || "- (no stories)"}`,
    `Data:\n${data}`,
    [
      "For each entity decide:",
      "1. actions, per choice field: the buttons that move a record to one of its values, named with the verb from the stories" +
        ' ("disqualify a participant" -> label Disqualify, value disqualified), each for the roles whose stories do it. Use only the' +
        " listed values. Labels are one or two words and a verb (Approve, Reject), never the value itself; no button for the first" +
        " value, where records start.",
      "2. own_records: the roles that should only see and change the records that belong to them, such as people registering or" +
        ' submitting for themselves ("register myself", "my trips"), and the text field that holds that person\'s username.' +
        " Roles that review or manage everyone's records are never listed.",
      "Only list what has a rule. Use only the roles, entities, fields and values given.",
    ].join("\n"),
  ].join("\n\n");
}

export function themePrompt(a: {
  title: string;
  roles: string[];
  stories: { role: string; story: string }[];
  screens: string[];
  themes: { id: string; description: string }[];
}): string {
  return [
    "You are choosing how a generated app looks, from a fixed set of themes. You never write CSS.",
    `App: "${a.title}"`,
    ...(a.roles.length ? [`Roles: ${a.roles.join(", ")}`] : []),
    ...(a.screens.length ? [`Pages: ${a.screens.join(", ")}`] : []),
    `User stories:\n${a.stories.map((s) => `- ${s.role || "someone"}: ${s.story}`).join("\n") || "- (no stories)"}`,
    `Themes:\n${a.themes.map((t) => `- ${t.id}: ${t.description}`).join("\n")}`,
    "Choose the theme that fits who uses the app and where: staff at a desk all day, customers on their own devices," +
      " people at a counter or on a tablet, careful record-keeping, or watching numbers.",
    "Give a one-sentence reason a person would understand, about who uses the app and where; do not name the theme," +
      " it is shown beside the reason.",
  ].join("\n\n");
}
