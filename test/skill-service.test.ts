import assert from "node:assert/strict";
import test from "node:test";
import {
  composeExplicitSkillRuntimeMessage,
  getSkill,
  listSkills,
  parseExplicitSkillInvocation,
} from "../src/skill-service.js";

const skillName = "diagnose-infrastructure-alert";

test("discovers the infrastructure alert skill and its UI metadata", () => {
  const skill = listSkills().find((item) => item.name === skillName);

  assert.ok(skill);
  assert.equal(skill.display_name, "基础设施告警处置");
  assert.equal(skill.allow_implicit_invocation, true);
  assert.match(skill.short_description, /维保联系人/);
});

test("loads the complete workflow only after the skill is selected", () => {
  const skill = getSkill(skillName);

  assert.ok(skill);
  assert.match(skill.instructions, /get_machine_status/);
  assert.match(skill.instructions, /get_maintenance_vendor_contacts/);
  assert.match(skill.instructions, /处置建议/);
});

test("parses and rewrites explicit slash invocations", () => {
  assert.deepEqual(
    parseExplicitSkillInvocation(
      "/diagnose-infrastructure-alert 10.20.1.14 CPU 连续告警",
    ),
    {
      name: skillName,
      prompt: "10.20.1.14 CPU 连续告警",
    },
  );

  const runtimeMessage = composeExplicitSkillRuntimeMessage(
    "/diagnose-infrastructure-alert 10.20.1.14 CPU 连续告警",
  );
  assert.match(runtimeMessage, /explicitly invoked/);
  assert.match(runtimeMessage, /load_skill/);
  assert.match(runtimeMessage, /10\.20\.1\.14/);
});

test("keeps unknown slash commands unchanged", () => {
  const message = "/unknown-command example";
  assert.equal(composeExplicitSkillRuntimeMessage(message), message);
});
