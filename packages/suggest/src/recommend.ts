import type { Command, Spec } from "@redwood/spec";
import { freshId } from "./util";

/**
 * Stories the spec is probably missing, ported from the earlier Redwood. Deterministic, no model: a closed catalog
 * of well-known stories, each offered only when the app has the trait that makes it matter and no story covers it.
 * `status` says what accepting one gets you, and is about what this generator really builds:
 *   built   the generated app already does it; the story keeps it in the spec
 *   partly  part of it is there
 *   spec    not generated yet; it goes in the spec so it is planned and not forgotten
 */
export type RecommendationStatus = "built" | "partly" | "spec";
export type RecommendationGroup = "security" | "tenancy" | "privacy" | "coverage";

export interface Recommendation {
  id: string;
  group: RecommendationGroup;
  story: string;
  role: string;
  status: RecommendationStatus;
  why: string;
  /** Accepting it needs a role the spec doesn't have yet. */
  newRole: boolean;
  commands: Command[];
}

interface Traits {
  signedIn: boolean;
  multiTenant: boolean;
  money: boolean;
  personalData: boolean;
  admin?: string;
  member?: string;
}

const PRIVILEGED = /admin|owner|manager|super|staff|operator/i;
const SIGN_IN = /\b(sign[ -]?(in|up)|log[ -]?in|register|account|password)\b/i;
const TENANT = /\b(organi[sz]ations?|orgs?|tenants?|workspaces?|compan(y|ies)|teams?|clinics?|branch(es)?|invit\w*|members?|seats?)\b/i;
const MONEY = /\b(pay\w*|price\w*|invoic\w*|bill\w*|subscri\w*|refund\w*|charg\w*|checkout|order\w*|purchas\w*)\b/i;
const PERSONAL = /\b(patient\w*|health|medical|(?<!email )address\w*|phone|birth|personal|passport|salary|ssn|national id|diagnos\w*)\b/i;

function readTraits(spec: Spec): Traits {
  const people = spec.roles.map((r) => r.name).filter((r) => !r.startsWith("_"));
  const text = spec.stories.map((s) => s.action).join(" ");
  const admin = people.find((r) => PRIVILEGED.test(r));
  const member = people.find((r) => !PRIVILEGED.test(r)) ?? people[0];
  return {
    signedIn: people.length > 1 || SIGN_IN.test(text),
    multiTenant: TENANT.test(text),
    money: MONEY.test(text),
    personalData: PERSONAL.test(text),
    ...(admin ? { admin } : {}),
    ...(member ? { member } : {}),
  };
}

interface Entry {
  id: string;
  group: RecommendationGroup;
  who: "member" | "admin" | "owner";
  story: string;
  status: RecommendationStatus;
  why: string;
  coveredBy: RegExp;
  applies: (t: Traits) => boolean;
}

const signedIn = (t: Traits) => t.signedIn;
const NOT_MULTI = "Multi-tenant apps are not generated yet; this keeps the requirement in the spec.";

const CATALOG: Entry[] = [
  { id: "security.sign-out", group: "security", who: "member", story: "sign out, so a shared device stops being signed in as me", status: "partly", why: "Signing out ends this session. Other devices stay signed in until their 12 hours run out.", coveredBy: /sign\w*[ -]?out|log\w*[ -]?out/i, applies: signedIn },
  { id: "security.password-reset", group: "security", who: "member", story: "reset my password from a link sent to my email, so I can get back in if I forget it", status: "spec", why: "Generated apps have no password reset yet.", coveredBy: /forg[eo]t\w*\s+(my\s+)?password|reset\w*\s+(my\s+)?password|password reset/i, applies: signedIn },
  { id: "security.lockout", group: "security", who: "member", story: "have sign-in lock after repeated wrong passwords, so nobody can guess mine", status: "spec", why: "Generated apps don't limit sign-in attempts yet.", coveredBy: /lock\w*|brute|too many (attempts|tries)|rate.?limit/i, applies: signedIn },
  { id: "security.audit-log", group: "security", who: "admin", story: "see a log of every sign-in, failed attempt and password change, so I can spot misuse", status: "spec", why: "Generated apps don't record account events yet.", coveredBy: /audit|log of (every |each )?sign.?in|sign.?in (log|history)|login (log|history)|security log/i, applies: signedIn },
  { id: "security.change-password", group: "security", who: "member", story: "change my password while signed in, so I can replace one I think was seen", status: "spec", why: "Generated apps have no way to change a password yet.", coveredBy: /change\w*\s+(my\s+)?password|update\w*\s+(my\s+)?password|new password/i, applies: signedIn },
  { id: "security.two-step", group: "security", who: "admin", story: "use a second step when I sign in (a code from an app), so a leaked password alone is not enough", status: "spec", why: "Most worth having on accounts that can change other people's access or data.", coveredBy: /two[- ]?(step|factor)|second (step|factor)|2fa|mfa|multi[- ]?factor|one[- ]?time (code|password)|authenticator/i, applies: (t) => t.signedIn && (!!t.admin || t.money || t.personalData) },
  { id: "security.verify-email", group: "security", who: "member", story: "confirm my email address when I sign up, so nobody can register an account in my name", status: "spec", why: "Generated apps have no email confirmation yet.", coveredBy: /verif\w*\s+(my\s+)?email|confirm\w*\s+(my\s+)?email|email (verification|confirmation)/i, applies: signedIn },
  { id: "security.deactivate-account", group: "security", who: "admin", story: "deactivate a person's account, so someone who leaves loses access at once", status: "spec", why: "Accounts can't be switched off from the app yet.", coveredBy: /deactivat\w*|disabl\w*\s+(an?\s+|their\s+)?account|suspend\w*\s+(an?\s+|their\s+)?(user|account)|revok\w*\s+access/i, applies: signedIn },
  { id: "tenancy.create-organisation", group: "tenancy", who: "owner", story: "create an organisation for my team, so our records are kept apart from every other organisation's", status: "spec", why: NOT_MULTI, coveredBy: /(create|set ?up|start|register)\w*\s+(an?\s+|my\s+|our\s+)?(organi[sz]ation|org|workspace|company|tenant|team)/i, applies: (t) => t.multiTenant },
  { id: "tenancy.isolation", group: "tenancy", who: "member", story: "see only my own organisation's records, so no other customer can ever see ours", status: "spec", why: "The most important multi-tenant rule: every record belongs to one organisation, and every query is limited to it.", coveredBy: /(see|view|access)\w* only (my|our) own|only (see|view|access)\w*.*(own|our|my) (organi[sz]ation|org|workspace|company|tenant|team)|isolat\w*|other (organi[sz]ations|tenants|customers)/i, applies: (t) => t.multiTenant },
  { id: "tenancy.invite", group: "tenancy", who: "owner", story: "invite people to my organisation by email with a role, so they join with the right access", status: "spec", why: "Invitations should expire, be single-use, and only ever grant a role the inviter holds.", coveredBy: /invit\w*/i, applies: (t) => t.multiTenant },
  { id: "tenancy.accept-invite", group: "tenancy", who: "member", story: "accept an invitation and join the organisation, so I can start working with my team", status: "spec", why: NOT_MULTI, coveredBy: /accept\w*\s+(an?\s+|the\s+|my\s+)?invit\w*|join\w*\s+(an?\s+|the\s+|my\s+)?(organi[sz]ation|team|workspace)/i, applies: (t) => t.multiTenant },
  { id: "tenancy.manage-members", group: "tenancy", who: "owner", story: "change a member's role or remove them, so access matches what each person does now", status: "spec", why: "An organisation must always keep at least one owner.", coveredBy: /(remove|change|manage|edit)\w*\s+(a\s+)?(member|user|people|teammate)\w*|member'?s role/i, applies: (t) => t.multiTenant },
  { id: "tenancy.switch", group: "tenancy", who: "member", story: "switch between the organisations I belong to, so I can work for more than one without signing out", status: "spec", why: NOT_MULTI, coveredBy: /switch\w*\s+(between\s+)?(the\s+|my\s+)?(organi[sz]ations|orgs|workspaces|teams|companies)/i, applies: (t) => t.multiTenant },
  { id: "tenancy.offboard", group: "tenancy", who: "owner", story: "close my organisation and delete its data, so we can leave and take nothing of ours behind", status: "spec", why: "Closing should ask for confirmation, and keep an export available until the data is gone.", coveredBy: /(close|delete|remove|cancel)\w*\s+(my\s+|our\s+|the\s+)?(organi[sz]ation|workspace|company|tenant|account)/i, applies: (t) => t.multiTenant },
  { id: "privacy.export-delete", group: "privacy", who: "member", story: "download or delete the personal data held about me, so I stay in control of it", status: "spec", why: "Often a legal requirement wherever personal data is kept (GDPR and similar).", coveredBy: /(download|export|delete|erase)\w*.{0,20}\b(my|personal) data|personal data held about me|right to (be forgotten|erasure)/i, applies: (t) => t.personalData },
  { id: "privacy.access-log", group: "privacy", who: "admin", story: "see who opened or changed a person's record, so access to sensitive data can be checked", status: "spec", why: "Generated apps don't record who read a record yet.", coveredBy: /who (opened|viewed|accessed|changed)|access (log|history|trail)|audit trail/i, applies: (t) => t.personalData },
  { id: "security.payment-trail", group: "security", who: "admin", story: "see a record of every payment and refund, so money can always be traced", status: "spec", why: "Payments should be recorded, never edited: a refund is a new entry, not a change.", coveredBy: /refund\w*|payment (history|record|log)|transaction (history|log)/i, applies: (t) => t.money },
];

const NEW_ROLE: Record<string, string> = { admin: "Admin", owner: "Owner" };

const OPERATIONS: { op: string; verbs: RegExp; want: string }[] = [
  { op: "add", verbs: /\b(add|create|register|submit|place|book|post|upload|new|record|log)\w*/i, want: "add a new {entity}" },
  { op: "view", verbs: /\b(see|view|list|browse|find|search|track|check|read|show|look)\w*/i, want: "see the {plural} I can work with" },
  { op: "edit", verbs: /\b(edit|update|change|modify|rename|correct|fix|amend|reschedul\w*)\w*/i, want: "correct a {entity} after it is saved" },
  { op: "remove", verbs: /\b(delete|remove|cancel|archive|withdraw|close)\w*/i, want: "remove a {entity} I no longer need" },
];

function words(name: string): { one: string; many: string } {
  const one = name.replace(/(?<!^)(?=[A-Z])/g, " ").replace(/_/g, " ").toLowerCase();
  if (/(s|x|ch|sh)$/.test(one)) return { one, many: `${one}es` };
  if (/[^aeiou]y$/.test(one)) return { one, many: `${one.slice(0, -1)}ies` };
  return { one, many: `${one}s` };
}

function storyCommands(spec: Spec, roleName: string, action: string, reason: string): { commands: Command[]; newRole: boolean } {
  const known = spec.roles.find((r) => r.name === roleName);
  const role = known?.id ?? freshId("role", roleName, spec.roles.map((r) => r.id));
  const id = freshId("story", action, spec.stories.map((s) => s.id));
  return {
    newRole: !known,
    commands: [
      ...(known ? [] : [{ type: "addRole", role: { id: role, name: roleName, description: "" } } as Command]),
      { type: "addStory", story: { id, role, action, reason, acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } },
    ],
  };
}

function coverage(spec: Spec): Recommendation[] {
  const found: Recommendation[] = [];
  for (const entity of spec.entities) {
    const ids = new Set(spec.screens.filter((s) => s.entity === entity.id).flatMap((s) => s.stories));
    const own = spec.stories.filter((s) => ids.has(s.id));
    // Only a table people actually add to: one only ever looked at is reference data.
    const asked = new Set(OPERATIONS.filter((o) => own.some((s) => o.verbs.test(s.action))).map((o) => o.op));
    if (!asked.has("add")) continue;
    const counts = new Map<string, number>();
    for (const s of own) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const role = spec.roles.find((r) => r.id === top)?.name ?? top;
    const { one, many } = words(entity.name);
    for (const o of OPERATIONS) {
      if (asked.has(o.op)) continue;
      const action = o.want.replace("{entity}", one).replace("{plural}", many);
      const reason = "mistakes and changes are easy to handle";
      const made = storyCommands(spec, role, action, reason);
      found.push({
        id: `coverage.${o.op}.${entity.id}`, group: "coverage", story: `I want to ${action}, so ${reason}`, role, status: "built",
        why: `Your stories add ${many} but never ${o.op} one. The generated app can; this story makes it part of the spec.`, ...made,
      });
    }
  }
  return found;
}

export function recommendStories(spec: Spec): Recommendation[] {
  const t = readTraits(spec);
  const texts = spec.stories.map((s) => s.action);
  const out: Recommendation[] = [];
  for (const e of CATALOG) {
    if (!e.applies(t) || texts.some((x) => e.coveredBy.test(x))) continue;
    const role = (e.who === "member" ? t.member : t.admin) ?? NEW_ROLE[e.who] ?? "Member";
    const [action, reason = ""] = e.story.split(/, so /);
    const made = storyCommands(spec, role, action!, reason);
    out.push({ id: e.id, group: e.group, story: `I want to ${e.story}`, role, status: e.status, why: e.why, ...made });
  }
  return [...out, ...coverage(spec)];
}
