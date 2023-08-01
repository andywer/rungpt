import { assertEquals, assertInstanceOf } from "std/testing/asserts.ts";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "../plugins/builtin/docker/lib/docker_manager.ts";

const dockerImageName = "rungpt_actions:latest";

Deno.test("can instantiate an ActionContainer", withActionContainer((actionContainer) => {
  assertInstanceOf(actionContainer, ActionContainer);
}));

Deno.test("actions container is operational", withActionContainer(async (actionContainer, t) => {
  await t.step("can invoke an action", async () => {
    await actionContainer.actions.invokeShell(`echo "Hello world!"`, async (process) => {
      const output = await process.output();
      const outputString = new TextDecoder().decode(output);
      assertEquals(outputString, "Hello world!\n");
    });
  });
}));

function withActionContainer(fn: (actionContainer: ActionContainer, t: Deno.TestContext) => Promise<void> | void) {
  return async (t: Deno.TestContext) => {
    let actionContainer = await getExistingActionContainer();
    if (!actionContainer) {
      actionContainer = await createActionContainer(dockerImageName);
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
