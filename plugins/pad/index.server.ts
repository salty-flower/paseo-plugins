import type { PluginServerContext } from "@getpaseo/plugin/server";
import { loadAgentAudio, loadAgentFile, loadAgentImage, sketchFontDataUrl } from "./server/data-source";
import { publishPadEvent, startPadEventStream } from "./server/pad-events";
import { clearPad, listPads, overrideBinding, removeSection } from "./server/pad-store";
import { getsPadTool, padTool } from "./server/pad-tool";
import {
  createProjectReader,
  readProjectChanges,
  readProjectCommits,
  readProjectEnvironment,
  readProjectEnvironments,
  readProjectPatches,
  readProjectPullRequest,
  readProjectThreads,
} from "./server/project";
import { createWebLookups } from "./server/web/lookups";
// Everything below ../shared/rpc is genui's, copied in at build time from the
// same pin, so pad sections render and load files exactly as chat blocks do.
import { checkSpec } from "./shared/fallback";
import { padBindRpc, padClearRpc, padInteractionRpc, padListRpc, padRemoveSectionRpc, padsInWorkspaceRpc } from "./shared/pad";
import {
  checkUiRpc,
  loadAudioRpc,
  loadDataRpc,
  loadImageRpc,
  projectChangesRpc,
  projectCommitsRpc,
  projectEnvironmentRpc,
  projectEnvironmentsRpc,
  projectPatchesRpc,
  projectPullRequestRpc,
  projectThreadsRpc,
  sketchFontRpc,
  webGeocodeRpc,
  webImageRpc,
  webSearchRpc,
  webTileRpc,
} from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  const stopEvents = startPadEventStream(listPads);
  // genui's default; its settings screen belongs to genui, not to the pad.
  const web = createWebLookups(
    async () => true,
    () => true,
  );
  const findImage = async (query: string) => {
    const found = await web.search(query);
    return found.ok ? found.image : null;
  };

  server.before("agent.session_open", ({ request }) => {
    if (!getsPadTool(request)) return;
    return { ...request, tools: [...request.tools, padTool] };
  });

  // The tool only writes this plugin's own files, so it needs no prompt.
  server.on("agent.permission_requested", async ({ agent, request }, { paseo }) => {
    if (!/^(mcp__paseo__|paseo\.)pad$/.test(request.name)) return;
    await paseo.agents.ref(agent.id).respondToPermission({ requestId: request.id, response: { behavior: "allow" } });
  });

  server.handle(padsInWorkspaceRpc, async ({ workspaceId }) => ({
    pads: (await listPads()).filter((pad) => pad.workspaceId === workspaceId).sort((a, b) => a.agentId.localeCompare(b.agentId)),
  }));
  server.handle(padListRpc, async () => ({
    pads: (await listPads()).map((pad) => ({
      agentId: pad.agentId,
      workspaceId: pad.workspaceId,
      sections: pad.sections.length,
      updatedAt: pad.updatedAt,
    })),
  }));
  server.handle(padClearRpc, async ({ agentId }) => ({ cleared: await clearPad(agentId) }));
  server.handle(padRemoveSectionRpc, async ({ agentId, sectionId }) => ({ removed: await removeSection(agentId, sectionId) }));
  server.handle(padBindRpc, async ({ agentId, sectionId, binding }) => ({ section: await overrideBinding(agentId, sectionId, binding) }));
  server.handle(padInteractionRpc, (interaction) => {
    publishPadEvent(interaction);
    return {};
  });

  // genui's renderer calls these through this plugin's own RPC namespace.
  server.handle(loadDataRpc, ({ agentId, path, raw }, { paseo }) => loadAgentFile(paseo, agentId, path, { raw }));
  server.handle(loadImageRpc, ({ agentId, path }, { paseo }) => loadAgentImage(paseo, agentId, path));
  server.handle(loadAudioRpc, ({ agentId, path }, { paseo }) => loadAgentAudio(paseo, agentId, path));
  server.handle(checkUiRpc, ({ agentId, spec }, { paseo }) => checkSpec(spec, (req) => loadAgentFile(paseo, agentId, req.path, req), findImage, createProjectReader(paseo, agentId)));
  server.handle(sketchFontRpc, async () => ({ dataUrl: await sketchFontDataUrl() }));
  server.handle(webImageRpc, ({ url }) => web.image(url));
  server.handle(webSearchRpc, ({ query }) => web.search(query));
  server.handle(webGeocodeRpc, ({ name, near }) => web.geocode(name, near));
  server.handle(webTileRpc, ({ z, x, y }) => web.tile(z, x, y));
  server.handle(projectChangesRpc, ({ agentId, target, paths }, { paseo }) => readProjectChanges(paseo, agentId, target, paths));
  server.handle(projectPatchesRpc, ({ agentId, target, paths }, { paseo }) => readProjectPatches(paseo, agentId, target, paths));
  server.handle(projectCommitsRpc, ({ agentId }, { paseo }) => readProjectCommits(paseo, agentId));
  server.handle(projectPullRequestRpc, ({ agentId }, { paseo }) => readProjectPullRequest(paseo, agentId));
  server.handle(projectThreadsRpc, ({ agentId, ids }, { paseo }) => readProjectThreads(paseo, agentId, ids));
  server.handle(projectEnvironmentsRpc, ({ agentId }, { paseo }) => readProjectEnvironments(paseo, agentId, false));
  server.handle(projectEnvironmentRpc, ({ agentId, environmentId }, { paseo }) => readProjectEnvironment(paseo, agentId, environmentId));

  return stopEvents;
}
