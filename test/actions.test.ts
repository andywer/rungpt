import { assertEquals, assertInstanceOf } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "../lib/docker_manager.ts";

const dockerImageName = "rungpt_actions:latest";

const testUrl = new URL(import.meta.url);
const testPath = await Deno.realPath(new URL(".", testUrl).pathname);
const actionsDir = `${testPath}/fixtures/actions`;

Deno.test("can instantiate an ActionContainer", withActionContainer((actionContainer) => {
  assertInstanceOf(actionContainer, ActionContainer);
}));

Deno.test("actions container is operational", withActionContainer(async (actionContainer, t) => {
  await t.step("can list actions", async () => {
    const actions = await actionContainer.actions.listActions();
    assertEquals(actions, ["hello"]);
  });

  await t.step("can return action metadata", async () => {
    const meta = await actionContainer.actions.actionMetadata("hello");
    assertEquals(meta, {
      schema_version: "0.0.0",
      name_for_human: "Hello action",
      name_for_model: "hello",
      description_for_human: "Some random test action",
      description_for_model: "Some random test action",
      logo_url: "https://example.com/logo.png"
    });
  });

  await t.step("can invoke an action", async () => {
    await actionContainer.actions.invokeAction("hello", {}, async (process) => {
      const output = await process.output();
      const outputString = new TextDecoder().decode(output);
      assertEquals(outputString, "Hello world from rungpt-actions!\n");
    });
  });
}));

function withActionContainer(fn: (actionContainer: ActionContainer, t: Deno.TestContext) => Promise<void> | void) {
  return async (t: Deno.TestContext) => {
    let actionContainer = await getExistingActionContainer();
    if (!actionContainer) {
      actionContainer = await createActionContainer(dockerImageName, actionsDir);
    }
    if (!await actionContainer.running()) {
      await actionContainer.start();
    }

    try {
      await fn(actionContainer, t);
    } finally {
      await actionContainer.stop();
    }
  };
}